-- share_links: seit Phase 1 da, nie benutzt. Belegt hier: Owner darf für eine
-- revealed Reise anlegen, für eine active Reise nicht; ein Mitglied ohne
-- Owner-Rolle darf weder anlegen noch fremde Zeilen sehen; anon kommt gar
-- nicht heran; ein Update auf revoked durch die Owner-Person gelingt.
--
-- Seit 20260808130000_share_links_widerruf_archiviert.sql ist die frühere
-- `for all`-Policy `share_links_all_owner` in vier Policies aufgeteilt
-- (select/insert/update/delete). Grund: eine `for all`-Policy kann INSERT und
-- UPDATE nicht unterscheiden, ihre `with check` galt für beide — und damit
-- scheiterte ausgerechnet der WIDERRUF eines Links auf einer archivierten
-- Reise, während Lesen und Löschen unberührt blieben. Ein Widerruf macht einen
-- Link schwächer, nie stärker; er darf an keinem Status scheitern, an dem das
-- Anlegen scheitert.
--
-- Diese Datei nagelt darum jetzt die aufgeteilte Fassung fest, und zwar
-- getrennt nach Operation:
--   * INSERT bleibt revealed-only (Abschnitte 1, 2, 9)
--   * UPDATE lässt 'revealed' UND 'archived' zu (Abschnitte 5, 8)
--   * UPDATE sperrt weiterhin den Weg auf eine AKTIVE Reise — sowohl für einen
--     dort liegenden Link als auch für ein Umhängen per trip_id
--     (Abschnitte 10, 11); sonst liesse sich das INSERT-Verbot per UPDATE
--     umgehen und ein öffentlicher Link auf eine versiegelte Reise zeigen
--   * SELECT und DELETE kennen unverändert keine Status-Bedingung
--     (Abschnitte 6, 7)

create extension if not exists pgtap with schema extensions;
begin;
select plan(15);

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

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-0000-0000-00000000000a', 'anna', 'Anna'),
  ('00000000-0000-0000-0000-00000000000b', 'ben', 'Ben');

-- Trip mit Anna (Owner) + Ben, noch active (Default).
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('11111111-1111-1111-1111-111111111111', 'Lissabon',
          '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-00000000000a');
-- Zweite Reise derselben Owner-Person, die dauerhaft AKTIV bleibt. Sie wird
-- erst in den Abschnitten 10/11 gebraucht: dort ist sie das Ziel, auf das ein
-- UPDATE nicht zeigen darf.
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('22222222-2222-2222-2222-222222222222', 'Noch versiegelt',
          '2026-09-01', '2026-09-10', '00000000-0000-0000-0000-00000000000a');
select pg_temp.as_service();
insert into public.trip_members (trip_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b');

-- === 1. Für eine active Reise legt auch der Owner keinen Link an ===
-- with check verlangt status = 'revealed' — bei INSERT unstrittig zuständig.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$insert into public.share_links (trip_id)
    values ('11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'Für eine active Reise legt der Owner keinen Share-Link an');

-- Reveal
select pg_temp.as_service();
update public.trips set status = 'revealed', revealed_at = '2026-08-10 18:00+00'
  where id = '11111111-1111-1111-1111-111111111111';

-- === 2. Owner darf für eine revealed Reise anlegen ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.share_links (token, trip_id)
  values ('link-eins', '11111111-1111-1111-1111-111111111111');
select pass('Owner legt für eine revealed Reise einen Share-Link an');

-- === 3. Ein Mitglied ohne Owner-Rolle darf weder anlegen ... ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$insert into public.share_links (token, trip_id)
    values ('link-ben', '11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'Ein Mitglied ohne Owner-Rolle legt keinen Share-Link an');

-- === ... noch fremde Zeilen sehen ===
select is(
  (select count(*)::int from public.share_links where trip_id = '11111111-1111-1111-1111-111111111111'),
  0, 'Ein Mitglied ohne Owner-Rolle sieht fremde Share-Links nicht');

-- === 4. anon kommt gar nicht heran (weder lesen noch schreiben) ===
select pg_temp.as_anon();
select throws_ok(
  $$select * from public.share_links$$,
  '42501', null, 'anon darf share_links nicht lesen');
select throws_ok(
  $$insert into public.share_links (token, trip_id)
    values ('link-anon', '11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'anon darf share_links nicht beschreiben');

-- === 5. Ein Update auf revoked durch die Owner-Person gelingt ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
update public.share_links set revoked = true where token = 'link-eins';
select is(
  (select revoked from public.share_links where token = 'link-eins'),
  true, 'Owner kann den eigenen Share-Link widerrufen (revoked = true)');

-- === 6. Widerrufen gelingt auch auf einer ARCHIVIERTEN Reise ===
-- Der Kern der Migration 20260808130000. Vorher galt hier `with check` der
-- gemeinsamen for-all-Policy und verlangte status = 'revealed' — der Widerruf
-- scheiterte mit 42501, während Lesen und Löschen (using, ohne
-- Status-Bedingung) weiterlief. Ein Link auf einer archivierten Reise blieb
-- damit dauerhaft öffentlich, weil die Owner-Person ihn nur noch löschen und
-- nicht mehr widerrufen konnte.
insert into public.share_links (token, trip_id)
  values ('link-zwei', '11111111-1111-1111-1111-111111111111');
select pg_temp.as_service();
update public.trips set status = 'archived' where id = '11111111-1111-1111-1111-111111111111';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
update public.share_links set revoked = true where token = 'link-zwei';
select is(
  (select revoked from public.share_links where token = 'link-zwei'),
  true, 'Owner widerruft einen Share-Link auch auf einer archivierten Reise');

-- === 7. Anlegen bleibt revealed-only, auch nach dem Archivieren ===
-- Die Gegenprobe zu Abschnitt 6: gelockert wurde ausschliesslich das UPDATE.
select throws_ok(
  $$insert into public.share_links (token, trip_id)
    values ('link-drei', '11111111-1111-1111-1111-111111111111')$$,
  '42501', null,
  'Für eine archivierte Reise legt auch der Owner keinen neuen Share-Link an');

-- === 8. using kennt keine Status-Bedingung: lesen bleibt möglich ===
select is(
  (select count(*)::int from public.share_links where trip_id = '11111111-1111-1111-1111-111111111111'),
  2, 'Owner sieht beide Share-Links weiterhin, obwohl die Reise archiviert ist (using prüft nur Eigentümerschaft)');

-- === 9. ... und löschen ebenfalls (using ohne Status-Bedingung, für DELETE
-- gibt es kein with check) ===
delete from public.share_links where token = 'link-zwei';
select is(
  (select count(*)::int from public.share_links where trip_id = '11111111-1111-1111-1111-111111111111'),
  1, 'Owner kann einen Share-Link auf einer archivierten Reise weiterhin löschen (using ohne Status-Bedingung)');

-- === 10. Ein Link auf einer AKTIVEN Reise bleibt gesperrt ===
-- Das bewusst in Kauf genommene Residuum der Migration (siehe deren
-- Kopfkommentar): `with check` beim UPDATE lässt 'revealed' und 'archived' zu,
-- 'active' nicht. Eine solche Zeile kann über keinen legitimen Weg entstehen
-- (INSERT verlangt 'revealed', trips.status wechselt nur vorwärts) — hier legt
-- sie deshalb die service_role an, wie es eine Edge Function täte. Der Test
-- steht da, damit die Grenze der Lockerung benannt und nicht bloss vermutet
-- ist: die Edge Function `share-link` widerruft mit Service-Role an RLS vorbei
-- und ist davon nicht betroffen, ein direkter Client-Update wäre es.
select pg_temp.as_service();
insert into public.share_links (token, trip_id)
  values ('link-aktiv', '22222222-2222-2222-2222-222222222222');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$update public.share_links set revoked = true where token = 'link-aktiv'$$,
  '42501', null,
  'Ein Share-Link auf einer noch aktiven Reise lässt sich per Client-Update nicht widerrufen');
select is(
  (select revoked from public.share_links where token = 'link-aktiv'),
  false, 'link-aktiv blieb nach dem verweigerten Update unverändert (revoked = false)');

-- === 11. Umhängen auf eine aktive Reise scheitert ===
-- Der eigentliche Grund, warum die Status-Bedingung im UPDATE nicht ganz
-- entfallen darf. `with check` wird gegen die NEUE Zeile ausgewertet: ohne
-- Status-Bedingung liesse sich ein bestehender, gültiger Link per trip_id auf
-- eine noch versiegelte eigene Reise umhängen — und damit genau das erzeugen,
-- was das INSERT-Verbot verhindert (Spec §4, W3: ein Share-Link auf eine nicht
-- aufgedeckte Reise existiert nicht und funktioniert nicht).
select throws_ok(
  $$update public.share_links set trip_id = '22222222-2222-2222-2222-222222222222'
    where token = 'link-eins'$$,
  '42501', null,
  'Ein bestehender Share-Link lässt sich nicht auf eine noch aktive Reise umhängen');
select is(
  (select trip_id from public.share_links where token = 'link-eins'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'link-eins zeigt nach dem verweigerten Umhängen unverändert auf die alte Reise');

select * from finish();
rollback;
