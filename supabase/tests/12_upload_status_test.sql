-- Phase 4 (Kamera & Upload) rührt an der DB nur, was hier belegt wird — die
-- Versiegelung selbst bleibt unverändert. Zwei der vier Brief-Punkte sind
-- bereits an anderer Stelle abgedeckt, deshalb NICHT hier dupliziert:
--   - "Insert mit fremdem author_id scheitert": 04_sealing_rls_test.sql,
--     Zeilen 53-64 (Mitglied versucht Insert im Namen eines anderen Mitglieds
--     UND Nicht-Mitglied versucht Insert im eigenen Namen).
--   - "authenticated kann upload_status nicht setzen / service_role kann es":
--     07_role_hardening_test.sql, Zeilen 74-77 (service_role setzt es per
--     UPDATE) und Zeilen 87-91 (authenticated darf es beim INSERT nicht
--     setzen, Spalten-Grant).
-- Was dort fehlt und hier ergänzt wird:
--   1. authenticated bleibt jedes UPDATE auf posts verwehrt, auch ein reines
--      "upload_status setzen" auf den eigenen Post nach dem Reveal (nicht nur
--      beim Insert) — das ist der ganze Grund, warum die Edge Function
--      `confirm` mit Service-Role laufen muss.
--   2. Nachzügler-Grenzfall exakt AUF der Grenze: captured_at = revealed_at
--      (04 testet nur strikt davor/danach).
--   3. Insert in eine archivierte Reise scheitert (weder "active" noch
--      "revealed mit captured_at <= revealed_at" trifft zu).
--   4. posts.media_ext (Final-Review, Important 5): Default, Spalten-Grant für
--      authenticated und die Check-Constraint, die die Endung auf eine
--      geschlossene, zur Aufnahmeart passende Liste festnagelt.

create extension if not exists pgtap with schema extensions;
begin;
select plan(8);

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

-- Simuliert eine Edge Function (Phasen 3–6): echtes service_role-Privileg,
-- analog zu pg_temp.as_service() in 07_role_hardening_test.sql.
create or replace function pg_temp.as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-0000-0000-00000000000a', 'anna', 'Anna'),
  ('00000000-0000-0000-0000-00000000000b', 'ben', 'Ben');

-- Trip mit Anna (Owner) + Ben
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('11111111-1111-1111-1111-111111111111', 'Lissabon',
          '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-00000000000a');

insert into public.posts (id, trip_id, author_id, type, storage_key, captured_at, captured_tz)
  values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
          '00000000-0000-0000-0000-00000000000a', 'photo', 'trips/x/1.jpg',
          '2026-08-02 10:00+00', 'Europe/Lisbon');

-- === 4. media_ext (Final-Review, Important 5) ===
-- Die Edge Function leitet den Speicherschlüssel aus der posts-Zeile ab und
-- traut dem Client keinen Pfad. Damit sie die richtige Container-Endung
-- ableiten kann (iOS nimmt QuickTime auf, Android mp4), steht sie als Spalte
-- in der Zeile — beschränkt auf eine geschlossene Liste, die zur Aufnahmeart
-- passen muss. Diese Grenze ist der ganze Grund, warum der Client die Endung
-- überhaupt bestimmen darf.
insert into public.posts (id, trip_id, author_id, type, media_ext, storage_key, duration_s, captured_at, captured_tz)
  values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
          '00000000-0000-0000-0000-00000000000a', 'video', 'mov', 'trips/x/4.mov', 12,
          '2026-08-02 11:00+00', 'Europe/Lisbon');

-- Ein Video ohne ausdrückliche Endung liefe in den Default 'jpg' — das muss
-- LAUT scheitern statt still falsch etikettiert im Speicher zu landen.
select throws_ok(
  $$insert into public.posts (trip_id, author_id, type, storage_key, duration_s, captured_at, captured_tz)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
            'video', 'trips/x/5.mp4', 8, '2026-08-02 12:00+00', 'Europe/Lisbon')$$,
  '23514', null, 'ein Video ohne ausdrückliche media_ext scheitert an der Check-Constraint statt still als jpg durchzugehen');

select throws_ok(
  $$insert into public.posts (trip_id, author_id, type, media_ext, storage_key, captured_at, captured_tz)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
            'photo', 'exe', 'trips/x/6.exe', '2026-08-02 13:00+00', 'Europe/Lisbon')$$,
  '23514', null, 'eine Endung ausserhalb der erlaubten Liste wird abgelehnt (kein frei wählbarer Pfadbestandteil)');

select pg_temp.as_service();

-- Gelesen wird als service_role: die Reise ist noch versiegelt, authenticated
-- sähe seine eigenen Momente vor dem Reveal gar nicht (Phase 1) und die
-- Prüfung liefe ins Leere statt zu greifen.
select is(media_ext, 'jpg',
    'ein Foto ohne ausdrückliche Endung bekommt jpg (Default)')
  from public.posts where id = '22222222-2222-2222-2222-222222222222';
select is(media_ext, 'mov',
    'authenticated darf media_ext beim Insert setzen (Spalten-Grant vorhanden) — sonst scheiterte JEDER Client-Insert')
  from public.posts where id = '44444444-4444-4444-4444-444444444444';
insert into public.trip_members (trip_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b');

-- === REVEAL (service_role, wie in 07_role_hardening_test.sql) ===
update public.trips set status = 'revealed', revealed_at = '2026-08-10 18:00+00'
  where id = '11111111-1111-1111-1111-111111111111';

-- === 1. authenticated kann upload_status NICHT per UPDATE ändern ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$update public.posts set upload_status = 'uploaded'
    where id = '22222222-2222-2222-2222-222222222222'$$,
  '42501', null, 'authenticated kann upload_status nicht per UPDATE ändern (kein Update-Recht auf posts seit Phase 1)');

select pg_temp.as_service();
select is(upload_status::text, 'pending',
    'upload_status blieb nach dem verweigerten Update unverändert (pending)')
  from public.posts where id = '22222222-2222-2222-2222-222222222222';

-- === 2. Nachzügler-Grenzfall: captured_at exakt = revealed_at ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
insert into public.posts (id, trip_id, author_id, type, storage_key, captured_at, captured_tz)
  values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
          '00000000-0000-0000-0000-00000000000b', 'photo', 'trips/x/2.jpg',
          '2026-08-10 18:00+00', 'Europe/Lisbon');
select is(count(*)::int, 1,
    'Nachzügler-Grenzfall: captured_at exakt = revealed_at wird angenommen (inklusive Grenze)')
  from public.posts where id = '33333333-3333-3333-3333-333333333333';

-- === 3. Insert in eine archivierte Reise scheitert ===
select pg_temp.as_service();
update public.trips set status = 'archived'
  where id = '11111111-1111-1111-1111-111111111111';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
            'photo', 'trips/x/3.jpg', '2026-08-05 09:00+00', 'Europe/Lisbon')$$,
  '42501', null, 'Insert in eine archivierte Reise scheitert (weder active noch revealed+captured_at<=revealed_at)');

select * from finish();
rollback;
