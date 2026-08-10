create extension if not exists pgtap with schema extensions;
begin;
select plan(18);

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

create or replace function pg_temp.logout() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end $$;

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-0000-0000-00000000000a', 'anna', 'Anna'),
  ('00000000-0000-0000-0000-00000000000b', 'ben', 'Ben');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('11111111-1111-1111-1111-111111111111', 'Lissabon',
          '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-00000000000a');
insert into public.posts (id, trip_id, author_id, type, storage_key, captured_at, captured_tz)
  values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
          '00000000-0000-0000-0000-00000000000a', 'photo', 'k1',
          '2026-08-02 10:00+00', 'Europe/Lisbon');
select pg_temp.logout();
insert into public.trip_members (trip_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b');

-- Vor dem Reveal: keine Reaktionen möglich (Post ist unsichtbar)
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$insert into public.reactions (post_id, user_id, emoji)
    values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000b', '🔥')$$,
  '42501', null, 'Vor Reveal keine Reaktionen möglich');

-- Autorisierte Erweiterung (Task-5-Review): Testabdeckung für
-- posts_delete_after_reveal VOR dem Reveal, auch die Autorin selbst darf
-- ihren eigenen Post nicht löschen. Kein Fehler erwartet: RLS filtert das
-- DELETE still (0 betroffene Zeilen), weil vor dem Reveal keine
-- posts-Delete-Policy zutrifft.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
delete from public.posts where id = '22222222-2222-2222-2222-222222222222';
select is(public.my_post_count('11111111-1111-1111-1111-111111111111'), 1::bigint,
  'Vor Reveal kann auch die Autorin nicht löschen');

-- Reveal
select pg_temp.logout();
update public.trips set status = 'revealed', revealed_at = '2026-08-10 18:00+00'
  where id = '11111111-1111-1111-1111-111111111111';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
insert into public.reactions (post_id, user_id, emoji)
  values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000b', '🔥');
select pass('Nach Reveal: Mitglied reagiert');

insert into public.comments (post_id, user_id, text)
  values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000b', 'Bestes Foto!');
select pass('Nach Reveal: Mitglied kommentiert');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select is(count(*)::int, 1, 'Reaktionen sind für Mitglieder sichtbar')
  from public.reactions where post_id = '22222222-2222-2222-2222-222222222222';
select is(count(*)::int, 1, 'Kommentare sind für Mitglieder sichtbar')
  from public.comments where post_id = '22222222-2222-2222-2222-222222222222';

-- === reactions_delete_own: nur der Verfasser löscht, keine Fremdrechte
-- (Finding 2, finaler Whole-Branch-Review, bisher 0 Assertions). Anna ist
-- Owner, aber nicht Verfasserin der Reaktion.
delete from public.reactions
  where post_id = '22222222-2222-2222-2222-222222222222'
    and user_id = '00000000-0000-0000-0000-00000000000b';
select is(count(*)::int, 1, 'reactions_delete_own: Owner kann fremde Reaktion nicht löschen')
  from public.reactions where post_id = '22222222-2222-2222-2222-222222222222';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
delete from public.reactions
  where post_id = '22222222-2222-2222-2222-222222222222'
    and user_id = '00000000-0000-0000-0000-00000000000b';
select is(count(*)::int, 0, 'reactions_delete_own: eigene Reaktion löschen erlaubt')
  from public.reactions where post_id = '22222222-2222-2222-2222-222222222222';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');

-- === comments_delete_own: nur der Verfasser löscht, keine Fremdrechte
-- (bisher 0 Assertions)
delete from public.comments
  where post_id = '22222222-2222-2222-2222-222222222222'
    and user_id = '00000000-0000-0000-0000-00000000000b';
select is(count(*)::int, 1, 'comments_delete_own: Owner kann fremden Kommentar nicht löschen')
  from public.comments where post_id = '22222222-2222-2222-2222-222222222222';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
delete from public.comments
  where post_id = '22222222-2222-2222-2222-222222222222'
    and user_id = '00000000-0000-0000-0000-00000000000b';
select is(count(*)::int, 0, 'comments_delete_own: eigenen Kommentar löschen erlaubt')
  from public.comments where post_id = '22222222-2222-2222-2222-222222222222';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');

select throws_ok(
  $$insert into public.comments (post_id, user_id, text)
    values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000b', 'Fälschung')$$,
  '42501', null, 'Kommentare nur im eigenen Namen');

insert into public.reports (post_id, reporter_id, reason)
  values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000a', 'Unangebracht');
select pass('Mitglied kann Post melden');

-- === reports_select_owner: nur der Trip-Owner liest Meldungen (Moderation),
-- Finding 2, finaler Whole-Branch-Review, bisher 0 Assertions.
select is(count(*)::int, 1, 'reports_select_owner: Owner sieht die Meldung')
  from public.reports where post_id = '22222222-2222-2222-2222-222222222222';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(count(*)::int, 0, 'reports_select_owner: Nicht-Owner sieht die Meldung nicht')
  from public.reports where post_id = '22222222-2222-2222-2222-222222222222';

-- share_links: kein angemeldeter Client schreibt hier mehr direkt.
--
-- Bis 20260808140000_share_links_nur_edge_function.sql standen hier zwei
-- Assertions: Ben (Mitglied, nicht Owner) wird abgewiesen, Anna (Owner) darf
-- anlegen. Der Positivpfad ist entfallen, nicht weil die Zusicherung
-- weggefallen wäre, sondern weil sie umgezogen ist: Angelegt wird
-- ausschliesslich über die Edge Function `share-link` (Aktion `erstellen`, mit
-- Service-Role), und `authenticated` hat auf share_links nur noch `select`.
-- Der Grund steht ausführlich in jener Migration; kurz: `token` ist `text` mit
-- Default, ein Default greift nur bei fehlender Spalte, und damit konnte sich
-- ein Client seinen eigenen, beliebig kurzen, Token aussuchen.
--
-- Wo die Zusicherungen jetzt liegen:
--   * «nur der Owner, nur eine aufgedeckte Reise»
--     -> supabase/functions/share-link/verwaltung.ts (beurteileErstellen),
--        geprüft in verwaltung_test.ts ohne Docker
--   * «authenticated schreibt gar nicht»
--     -> supabase/tests/15_share_links_test.sql, Abschnitt A
--   * «die Policies halten trotzdem, falls je wieder ein Grant kommt»
--     -> dieselbe Datei, Abschnitt B (Grant innerhalb der Transaktion)
--
-- Bens Ablehnung bleibt hier stehen. Sie schlägt jetzt schon am fehlenden
-- Tabellen-Privileg fehl statt an der Policy, derselbe SQLSTATE, ein anderer
-- Mechanismus, und in beiden Fällen die richtige Antwort.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$insert into public.share_links (trip_id)
    values ('11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'Kein angemeldeter Client legt Share-Links direkt an');

-- Autorisierte Erweiterung (Task-5-Review): Testabdeckung für
-- posts_delete_after_reveal NACH dem Reveal, Fremde löschen nicht,
-- der Owner darf moderierend löschen, die Autorin ihren eigenen Post.
-- Reihenfolge ist wichtig: Das Löschen von Annas Post kaskadiert auch die
-- Reaktionen/Kommentare aus den Tests oben, darum steht dieser Block ganz
-- am Ende der Datei.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
insert into public.posts (id, trip_id, author_id, type, storage_key, captured_at, captured_tz)
  values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
          '00000000-0000-0000-0000-00000000000b', 'photo', 'k2',
          '2026-08-09 12:00+00', 'Europe/Lisbon');

delete from public.posts where id = '22222222-2222-2222-2222-222222222222';
select is(count(*)::int, 1, 'Weder-Autor-noch-Owner löscht fremde Posts nicht')
  from public.posts where id = '22222222-2222-2222-2222-222222222222';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
delete from public.posts where id = '33333333-3333-3333-3333-333333333333';
select is(count(*)::int, 0, 'Owner darf moderierend löschen')
  from public.posts where id = '33333333-3333-3333-3333-333333333333';

delete from public.posts where id = '22222222-2222-2222-2222-222222222222';
select is(count(*)::int, 0, 'Autorin löscht eigenen Post nach Reveal')
  from public.posts where id = '22222222-2222-2222-2222-222222222222';

select * from finish();
rollback;
