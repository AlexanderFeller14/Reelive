create extension if not exists pgtap with schema extensions;
begin;
select plan(4);

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

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('11111111-1111-1111-1111-111111111111', 'Lissabon',
          '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-00000000000a');

insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
   'photo', 'a1', '2026-08-02 10:00+00', 'Europe/Lisbon'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
   'photo', 'a2', '2026-08-02 11:00+00', 'Europe/Lisbon');

select is(public.my_post_count('11111111-1111-1111-1111-111111111111'), 2::bigint,
  'Autorin sieht die eigene Anzahl trotz Versiegelung');

select is(count(*)::int, 0, 'Gegenprobe: direkte Post-Abfrage bleibt leer')
  from public.posts where trip_id = '11111111-1111-1111-1111-111111111111';

select pg_temp.logout();
insert into public.trip_members (trip_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b');
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(public.my_post_count('11111111-1111-1111-1111-111111111111'), 0::bigint,
  'Mitglied ohne Posts hat Zähler 0, sieht NICHT die Anzahl der anderen');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  $$select public.my_post_count('11111111-1111-1111-1111-111111111111')$$,
  'P0001', 'not a trip member', 'Nicht-Mitglieder erhalten einen Fehler');

select * from finish();
rollback;
