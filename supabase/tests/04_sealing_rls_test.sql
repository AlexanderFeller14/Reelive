create extension if not exists pgtap with schema extensions;
begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'anna@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@test.local');

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
  ('00000000-0000-0000-0000-00000000000b', 'ben', 'Ben'),
  ('00000000-0000-0000-0000-00000000000c', 'carla', 'Carla');

-- Trip mit Anna (Owner) + Ben; Carla ist aussen vor
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('11111111-1111-1111-1111-111111111111', 'Lissabon',
          '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-00000000000a');
select pg_temp.logout();
insert into public.trip_members (trip_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b');

-- === Phase AKTIV ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.posts (id, trip_id, author_id, type, storage_key, captured_at, captured_tz)
  values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
          '00000000-0000-0000-0000-00000000000a', 'photo', 'trips/x/1.jpg',
          '2026-08-02 10:00+00', 'Europe/Lisbon');
select pass('Mitglied kann während aktiver Reise einsenden');

select is(count(*)::int, 0, 'VERSIEGELT: Autorin liest den eigenen Post vor Reveal NICHT')
  from public.posts where trip_id = '11111111-1111-1111-1111-111111111111';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(count(*)::int, 0, 'VERSIEGELT: Mitglied liest fremde Posts vor Reveal nicht')
  from public.posts where trip_id = '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
            'photo', 'k', now(), 'Europe/Lisbon')$$,
  '42501', null, 'Niemand kann Posts im Namen anderer einsenden');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  $$insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000c',
            'photo', 'k', now(), 'Europe/Lisbon')$$,
  '42501', null, 'Nicht-Mitglieder können nicht einsenden');

-- === REVEAL === (Superuser simuliert die Edge Function aus Phase 5)
select pg_temp.logout();
update public.trips set status = 'revealed', revealed_at = '2026-08-10 18:00+00'
  where id = '11111111-1111-1111-1111-111111111111';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(count(*)::int, 1, 'Nach Reveal: Mitglied sieht alle Posts')
  from public.posts where trip_id = '11111111-1111-1111-1111-111111111111';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000c');
select is(count(*)::int, 0, 'Nach Reveal: Nicht-Mitglied sieht weiterhin nichts')
  from public.posts where trip_id = '11111111-1111-1111-1111-111111111111';

-- Nachzügler: vor dem Reveal aufgenommen → erlaubt
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz)
  values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b',
          'photo', 'trips/x/2.jpg', '2026-08-09 12:00+00', 'Europe/Lisbon');
select pass('Nachzügler-Upload (captured_at vor Reveal) wird angenommen');

-- Neue Aufnahme nach dem Reveal → abgelehnt
select throws_ok(
  $$insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b',
            'photo', 'k', '2026-08-11 09:00+00', 'Europe/Lisbon')$$,
  '42501', null, 'Neue Aufnahmen nach Reveal werden abgelehnt');

select * from finish();
rollback;
