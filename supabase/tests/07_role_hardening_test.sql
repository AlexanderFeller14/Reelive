create extension if not exists pgtap with schema extensions;
begin;
select plan(10);

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

-- Simuliert eine Edge Function (Phasen 3–6): echtes service_role-Privileg
-- statt des Superuser-Bypasses von pg_temp.logout().
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

-- Trip mit Anna (Owner) + Ben
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('11111111-1111-1111-1111-111111111111', 'Lissabon',
          '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-00000000000a');
select pg_temp.logout();
insert into public.trip_members (trip_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b');

-- Post während aktiver Reise
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.posts (id, trip_id, author_id, type, storage_key, captured_at, captured_tz)
  values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
          '00000000-0000-0000-0000-00000000000a', 'photo', 'trips/x/1.jpg',
          '2026-08-02 10:00+00', 'Europe/Lisbon');

-- === service_role fährt den Reveal (echtes Grant, kein Superuser-Bypass) ===
select pg_temp.as_service();
update public.trips set status = 'revealed', revealed_at = '2026-08-10 18:00+00'
  where id = '11111111-1111-1111-1111-111111111111';
select pass('service_role kann den Reveal fahren (update trips)');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(count(*)::int, 1, 'Nach service_role-Reveal: Mitglied sieht den Post')
  from public.posts where trip_id = '11111111-1111-1111-1111-111111111111';

-- service_role bestätigt den Upload (Edge Function, Phase 4)
select pg_temp.as_service();
update public.posts set upload_status = 'uploaded'
  where id = '22222222-2222-2222-2222-222222222222';
select pass('service_role kann upload_status setzen');

-- === Spalten-Grants: created_at/upload_status sind für authenticated tabu ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz, created_at)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
            'photo', 'k', '2026-08-05 09:00+00', 'Europe/Lisbon', '2026-08-05 09:00+00')$$,
  '42501', null, 'authenticated kann created_at beim Insert nicht setzen');

select throws_ok(
  $$insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz, upload_status)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
            'photo', 'k', '2026-08-05 09:00+00', 'Europe/Lisbon', 'uploaded')$$,
  '42501', null, 'authenticated kann upload_status beim Insert nicht setzen');

-- === Video-Dauer-Pflicht ===
select throws_ok(
  $$insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
            'video', 'k', '2026-08-05 09:00+00', 'Europe/Lisbon')$$,
  '23514', null, 'Video ohne duration_s wird abgelehnt');

insert into public.posts (trip_id, author_id, type, storage_key, duration_s, captured_at, captured_tz)
  values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
          'video', 'k', 20, '2026-08-05 09:00+00', 'Europe/Lisbon');
select pass('Video mit 20s Dauer wird angenommen');

-- === Mitgliedschafts-Orakel geschlossen: anon darf is_trip_member nicht rufen ===
select pg_temp.as_anon();
select throws_ok(
  $$select public.is_trip_member('11111111-1111-1111-1111-111111111111'::uuid,
                                  '00000000-0000-0000-0000-00000000000a'::uuid)$$,
  '42501', null, 'anon kann is_trip_member nicht ausführen');

-- === TRUNCATE bleibt authenticated verwehrt ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$truncate public.posts$$,
  '42501', null, 'authenticated kann posts nicht truncaten');

-- === invite_code-Rotation nach Mitglieds-Entfernung ===
select set_config('test.invite_code_before',
  (select invite_code from public.trips where id = '11111111-1111-1111-1111-111111111111'), true);

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
delete from public.trip_members
  where trip_id = '11111111-1111-1111-1111-111111111111'
    and user_id = '00000000-0000-0000-0000-00000000000b';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select isnt(
  (select invite_code from public.trips where id = '11111111-1111-1111-1111-111111111111'),
  current_setting('test.invite_code_before'),
  'invite_code rotiert nach Mitglieds-Entfernung');

select * from finish();
rollback;
