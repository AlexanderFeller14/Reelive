-- share_links: seit Phase 1 da, seit Phase 6 benutzt, und seit
-- 20260808140000_share_links_nur_edge_function.sql schreibt `authenticated`
-- hier gar nicht mehr direkt.
--
-- Diese Datei hat deshalb drei Abschnitte, und die Reihenfolge ist Absicht:
--
--   A. DER IST-ZUSTAND. Was ein angemeldeter Client heute darf: lesen, und
--      zwar nur die eigenen Reisen. Anlegen, ändern, löschen scheitern schon
--      am Tabellen-Privileg (42501), noch bevor RLS ausgewertet wird, auch
--      für die Owner-Person, auch auf einer aufgedeckten Reise. `anon` kommt
--      an gar nichts.
--
--   B. DIE ZWEITE SCHICHT. Die vier Policies aus
--      20260808130000_share_links_widerruf_archiviert.sql sind ohne Grant
--      unerreichbar, und blieben damit eine ungeprüfte Behauptung. Abschnitt B
--      stellt die Schreibrechte INNERHALB dieser Transaktion kurz wieder her
--      (das `rollback` am Ende nimmt sie mit) und prüft die Policies genau in
--      dem Zustand, für den sie gedacht sind: Wer in einer späteren Phase ein
--      Schreibrecht zurückgibt, soll damit nicht die Tabelle öffnen, sondern
--      weiterhin auf «nur die Owner-Person, nur eine aufgedeckte Reise»
--      treffen. Zwei Schlösser, von denen jedes allein hält, und beide
--      geprüft.
--
--      Inhaltlich sind das die Zusicherungen, die vorher der Kern dieser Datei
--      waren: INSERT bleibt revealed-only, UPDATE lässt 'revealed' UND
--      'archived' zu (ein Widerruf macht einen Link schwächer, nie stärker,
--      er darf an keinem Status scheitern, an dem das Anlegen scheitert),
--      UPDATE sperrt weiterhin den Weg auf eine AKTIVE Reise (sonst liesse
--      sich das INSERT-Verbot per trip_id-Umhängen umgehen, Spec §4/W3),
--      SELECT und DELETE kennen keine Status-Bedingung.
--
--   C. DIE EDGE FUNCTION. `service_role` trägt `rolbypassrls`, für sie wird
--      keine dieser Policies je ausgewertet. Genau deshalb prüft
--      supabase/functions/share-link/verwaltung.ts Eigentümerschaft und Status
--      selbst, mit eigenen Tests ohne Docker.

create extension if not exists pgtap with schema extensions;
begin;
select plan(23);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'anna@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@test.local');

create or replace function pg_temp.login_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Simuliert eine Edge Function (Phasen 3–6): echtes service_role-Privileg
-- statt Superuser-Bypass.
create or replace function pg_temp.as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;

create or replace function pg_temp.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end $$;

-- Zurück zum Eigentümer des Schemas, nur er darf GRANT aussprechen. Wird
-- ausschliesslich in Abschnitt B gebraucht; die Grants dort rollen mit der
-- Transaktion zurück.
create or replace function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end $$;

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-0000-0000-00000000000a', 'anna', 'Anna'),
  ('00000000-0000-0000-0000-00000000000b', 'ben', 'Ben');

-- Trip mit Anna (Owner) + Ben, noch active (Default).
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('11111111-1111-1111-1111-111111111111', 'Lissabon',
          '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-00000000000a');
-- Zweite Reise derselben Owner-Person, die dauerhaft AKTIV bleibt. Sie wird
-- erst in Abschnitt B gebraucht: dort ist sie das Ziel, auf das ein UPDATE
-- nicht zeigen darf.
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('22222222-2222-2222-2222-222222222222', 'Noch versiegelt',
          '2026-09-01', '2026-09-10', '00000000-0000-0000-0000-00000000000a');
select pg_temp.as_service();
insert into public.trip_members (trip_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b');
update public.trips set status = 'revealed', revealed_at = '2026-08-10 18:00+00'
  where id = '11111111-1111-1111-1111-111111111111';

-- Zwei Zeilen, angelegt wie die Edge Function sie anlegt: als service_role,
-- ohne Token-Vorgabe (der Default aus 20260803090100_content_tables.sql,
-- encode(gen_random_bytes(16),'hex'), ist ab jetzt die EINZIGE Quelle für
-- Tokens, dass ein Client sich einen aussuchen konnte, war der Befund, der zu
-- 20260808140000 geführt hat). Feste Tokens hier nur, weil die Assertions
-- unten sie brauchen; über die Function ist das nicht mehr möglich.
insert into public.share_links (token, trip_id) values
  ('link-eins', '11111111-1111-1111-1111-111111111111'),
  ('link-zwei', '11111111-1111-1111-1111-111111111111');

-- ===========================================================================
-- A. Der Ist-Zustand: `authenticated` schreibt nicht mehr
-- ===========================================================================

-- === 1. Auch die Owner-Person legt keinen Link mehr direkt an ===
-- Vorher scheiterte das nur für eine ACTIVE Reise (Policy). Jetzt scheitert es
-- immer, schon am fehlenden Tabellen-Privileg, die Reise hier ist revealed.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$insert into public.share_links (trip_id)
    values ('11111111-1111-1111-1111-111111111111')$$,
  '42501', null,
  'Owner legt auch auf einer revealed Reise keinen Share-Link mehr direkt an');

-- === 2. ... und schon gar keinen mit selbstgewähltem Token ===
-- Das war der schwerste Teil des Befunds: `token` ist `text` mit Default, und
-- ein Default greift nur, wenn die Spalte fehlt. Ein Client konnte sich also
-- einen Token der Länge 1 aussuchen, und damit die 2^128, auf denen der ganze
-- öffentliche Leseweg ruht, zu einer Client-Konvention machen.
select throws_ok(
  $$insert into public.share_links (token, trip_id)
    values ('a', '11111111-1111-1111-1111-111111111111')$$,
  '42501', null,
  'Owner bestimmt den Token eines Share-Links nicht mehr selbst');

-- === 3. Kein direkter Widerruf mehr (der läuft über die Edge Function) ===
select throws_ok(
  $$update public.share_links set revoked = true where token = 'link-eins'$$,
  '42501', null, 'Owner widerruft einen Share-Link nicht mehr direkt');

-- === 4. ... und vor allem kein Zurückschalten ===
-- Spec §5.1 begründet das revoked-Flag statt eines Delete damit, dass ein
-- widerrufener Link unterscheidbar bleiben soll von einem, den es nie gab.
-- Wäre revoked in beide Richtungen schaltbar, wäre «dieser Link wurde
-- widerrufen» keine haltbare Aussage. Die Function kennt nur true.
select pg_temp.as_service();
update public.share_links set revoked = true where token = 'link-eins';
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$update public.share_links set revoked = false where token = 'link-eins'$$,
  '42501', null, 'Ein widerrufener Share-Link lässt sich nicht wiederbeleben');
select is(
  (select revoked from public.share_links where token = 'link-eins'),
  true, 'link-eins ist nach dem verweigerten Zurückschalten weiterhin widerrufen');

-- === 5. Kein direktes Löschen (Spec §5.1: «Kein Löschen») ===
select throws_ok(
  $$delete from public.share_links where token = 'link-zwei'$$,
  '42501', null, 'Owner löscht einen Share-Link nicht mehr direkt');

-- === 6. Lesen bleibt, die App muss anzeigen, ob es einen Link gibt ===
select is(
  (select count(*)::int from public.share_links where trip_id = '11111111-1111-1111-1111-111111111111'),
  2, 'Owner sieht die Share-Links der eigenen Reise weiterhin');

-- === 7. ... aber nur die eigenen ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.share_links),
  0, 'Ein Mitglied ohne Owner-Rolle sieht fremde Share-Links nicht');
select throws_ok(
  $$insert into public.share_links (trip_id)
    values ('11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'Ein Mitglied ohne Owner-Rolle legt keinen Share-Link an');

-- === 8. anon kommt gar nicht heran ===
select pg_temp.as_anon();
select throws_ok(
  $$select * from public.share_links$$,
  '42501', null, 'anon darf share_links nicht lesen');
select throws_ok(
  $$insert into public.share_links (token, trip_id)
    values ('link-anon', '11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'anon darf share_links nicht beschreiben');

-- ===========================================================================
-- B. Die zweite Schicht: die Policies halten auch OHNE das fehlende Privileg
-- ===========================================================================
-- Ab hier werden die Schreibrechte innerhalb dieser Transaktion wieder
-- erteilt. Das `rollback` am Dateiende nimmt sie mit, in der Datenbank bleibt
-- der Zustand aus Abschnitt A. Was hier geprüft wird, ist die Frage: Wenn
-- jemand in einer späteren Phase ein Schreibrecht zurückgibt, öffnet er damit
-- die Tabelle, oder trifft er weiterhin auf die Policies?
select pg_temp.as_owner();
grant insert, update, delete on public.share_links to authenticated;

-- === 9. INSERT bleibt revealed-only ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.share_links (token, trip_id)
  values ('link-drei', '11111111-1111-1111-1111-111111111111');
select pass('share_links_insert_owner: Owner legt für eine revealed Reise einen Link an');
select throws_ok(
  $$insert into public.share_links (token, trip_id)
    values ('link-aktiv', '22222222-2222-2222-2222-222222222222')$$,
  '42501', null,
  'share_links_insert_owner: für eine active Reise legt auch der Owner keinen Link an');

-- === 10. Ein Mitglied ohne Owner-Rolle auch mit Privileg nicht ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$insert into public.share_links (token, trip_id)
    values ('link-ben', '11111111-1111-1111-1111-111111111111')$$,
  '42501', null,
  'share_links_insert_owner: ein Mitglied ohne Owner-Rolle legt keinen Link an');

-- === 11. UPDATE: Widerruf auf einer revealed Reise gelingt ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
update public.share_links set revoked = true where token = 'link-drei';
select is(
  (select revoked from public.share_links where token = 'link-drei'),
  true, 'share_links_update_owner: Owner widerruft einen Link auf einer revealed Reise');

-- === 12. UPDATE: Widerruf gelingt auch auf einer ARCHIVIERTEN Reise ===
-- Der Kern von 20260808130000. Vorher galt die gemeinsame `with check` der
-- for-all-Policy auch für UPDATE und verlangte status = 'revealed', der
-- Widerruf scheiterte, während Lesen und Löschen (using, ohne
-- Status-Bedingung) weiterliefen. Ein Link auf einer archivierten Reise blieb
-- damit dauerhaft öffentlich, weil die Owner-Person ihn nur noch löschen und
-- nicht mehr widerrufen konnte.
select pg_temp.as_service();
update public.trips set status = 'archived' where id = '11111111-1111-1111-1111-111111111111';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
update public.share_links set revoked = true where token = 'link-zwei';
select is(
  (select revoked from public.share_links where token = 'link-zwei'),
  true, 'share_links_update_owner: Owner widerruft einen Link auch auf einer archivierten Reise');

-- === 13. Anlegen bleibt revealed-only, auch nach dem Archivieren ===
-- Die Gegenprobe zu 12: gelockert wurde ausschliesslich das UPDATE.
select throws_ok(
  $$insert into public.share_links (token, trip_id)
    values ('link-vier', '11111111-1111-1111-1111-111111111111')$$,
  '42501', null,
  'share_links_insert_owner: für eine archivierte Reise entsteht kein neuer Link');

-- === 14. Umhängen auf eine aktive Reise scheitert ===
-- Der Grund, warum die Status-Bedingung im UPDATE nicht ganz entfallen darf.
-- `with check` wird gegen die NEUE Zeile ausgewertet: ohne Status-Bedingung
-- liesse sich ein bestehender, gültiger Link per trip_id auf eine noch
-- versiegelte eigene Reise umhängen, und damit genau das erzeugen, was das
-- INSERT-Verbot verhindert (Spec §4, W3).
select throws_ok(
  $$update public.share_links set trip_id = '22222222-2222-2222-2222-222222222222'
    where token = 'link-eins'$$,
  '42501', null,
  'share_links_update_owner: ein Link lässt sich nicht auf eine noch aktive Reise umhängen');
select is(
  (select trip_id from public.share_links where token = 'link-eins'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'link-eins zeigt nach dem verweigerten Umhängen unverändert auf die alte Reise');

-- === 15. SELECT und DELETE kennen keine Status-Bedingung ===
select is(
  (select count(*)::int from public.share_links where trip_id = '11111111-1111-1111-1111-111111111111'),
  3, 'share_links_select_owner: Owner sieht alle drei Links, obwohl die Reise archiviert ist');
delete from public.share_links where token = 'link-drei';
select is(
  (select count(*)::int from public.share_links where trip_id = '11111111-1111-1111-1111-111111111111'),
  2, 'share_links_delete_owner: Löschen bleibt vom Reise-Status unabhängig');

-- ===========================================================================
-- C. Die Edge Function umgeht das alles, und muss deshalb selbst prüfen
-- ===========================================================================

-- === 16. service_role trägt rolbypassrls ===
-- Nicht als Randnotiz, sondern als Begründung: WEIL für service_role keine
-- dieser Policies je ausgewertet wird, sind sie kein Schutz für den Weg über
-- die Edge Function. Die Prüfungen «gehört die Reise der anfragenden Person?»
-- und «ist sie aufgedeckt?» liegen darum in
-- supabase/functions/share-link/verwaltung.ts (beurteileErstellen), mit
-- eigenen Tests, die ohne Docker laufen.
select pg_temp.as_owner();
select is(
  (select rolbypassrls from pg_roles where rolname = 'service_role'),
  true, 'service_role umgeht RLS, die Edge Function muss Owner und Status selbst prüfen');

-- === 17. Und tut es an der Tabelle vorbei: Insert auf eine AKTIVE Reise ===
-- Genau der Fall, den beurteileErstellen abfängt. Hier gelingt er, weil nichts
-- in der Datenbank ihn aufhält, der Beleg dafür, dass die Function die
-- einzige Schranke ist und nicht die zweite.
select pg_temp.as_service();
insert into public.share_links (token, trip_id)
  values ('link-service-aktiv', '22222222-2222-2222-2222-222222222222');
select is(
  (select count(*)::int from public.share_links where trip_id = '22222222-2222-2222-2222-222222222222'),
  1, 'service_role legt auch auf einer aktiven Reise an, nur die Function verhindert das');

select * from finish();
rollback;
