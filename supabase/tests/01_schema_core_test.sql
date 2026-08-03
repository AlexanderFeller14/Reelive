create extension if not exists pgtap with schema extensions;
begin;
select plan(12);

select has_table('public', 'profiles', 'profiles existiert');
select has_column('public', 'profiles', 'username', 'profiles.username');

select has_table('public', 'trips', 'trips existiert');
select has_column('public', 'trips', 'status', 'trips.status');
select has_column('public', 'trips', 'invite_code', 'trips.invite_code');
select has_column('public', 'trips', 'revealed_at', 'trips.revealed_at');
select has_column('public', 'trips', 'plan', 'trips.plan');

select has_table('public', 'trip_members', 'trip_members existiert');
select col_is_pk('public', 'trip_members', array['trip_id','user_id'], 'PK (trip_id, user_id)');

-- Constraints
select throws_ok(
  $$insert into public.trips (name, start_date, end_date, owner_id)
    values ('Test', '2026-08-10', '2026-08-01', '00000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'end_date >= start_date wird erzwungen');

select throws_ok(
  $$insert into public.profiles (id, username, display_name)
    values ('00000000-0000-0000-0000-000000000001', 'AB', 'Zu kurz')$$,
  '23514', null, 'Username-Format wird erzwungen');

select throws_ok(
  $$insert into public.trips (name, start_date, end_date, owner_id, status)
    values ('Test', '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-000000000001', 'geheim')$$,
  '22P02', null, 'Nur gültige Status-Werte');

select * from finish();
rollback;
