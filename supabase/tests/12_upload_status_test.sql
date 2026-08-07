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

create extension if not exists pgtap with schema extensions;
begin;
select plan(4);

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

select pg_temp.as_service();
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
