create extension if not exists pgtap with schema extensions;
begin;
select plan(14);

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

select is(rowsecurity, true, 'RLS aktiv auf trips')
  from pg_tables where schemaname = 'public' and tablename = 'trips';

-- Anna erstellt einen Trip → wird automatisch Owner-Mitglied
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('11111111-1111-1111-1111-111111111111', 'Lissabon',
          '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-00000000000a');

select is(count(*)::int, 1, 'Owner-Mitgliedschaft wurde per Trigger angelegt')
  from public.trip_members
  where trip_id = '11111111-1111-1111-1111-111111111111'
    and user_id = '00000000-0000-0000-0000-00000000000a' and role = 'owner';

select is(count(*)::int, 1, 'Anna sieht ihren Trip')
  from public.trips where id = '11111111-1111-1111-1111-111111111111';

-- Ben ist kein Mitglied → sieht nichts
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(count(*)::int, 0, 'Nicht-Mitglied sieht den Trip nicht')
  from public.trips where id = '11111111-1111-1111-1111-111111111111';

-- Ben wird Mitglied (Superuser simuliert die Invite-Edge-Function aus Phase 3)
select pg_temp.logout();
insert into public.trip_members (trip_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(count(*)::int, 1, 'Mitglied sieht den Trip')
  from public.trips where id = '11111111-1111-1111-1111-111111111111';
select is(count(*)::int, 2, 'Mitglied sieht die Mitgliederliste')
  from public.trip_members where trip_id = '11111111-1111-1111-1111-111111111111';
select is(count(*)::int, 1, 'Mitglied sieht Profil des Mitreisenden')
  from public.profiles where id = '00000000-0000-0000-0000-00000000000a';
select is(count(*)::int, 0, 'Kein Zugriff auf Profile Fremder')
  from public.profiles where id = '00000000-0000-0000-0000-00000000000c';

-- Beitreten NUR via Edge Function/Owner-Trigger: kein direkter Insert durch Clients
select throws_ok(
  $$insert into public.trip_members (trip_id, user_id)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000c')$$,
  '42501', null, 'Client kann nicht direkt in trip_members inserten');

-- Geschützte Trip-Spalten (status/revealed_at/invite_code/plan) sind auch beim
-- Insert für Clients tabu, nicht nur beim Update.
select throws_ok(
  $$insert into public.trips (id, name, start_date, end_date, owner_id, status)
    values ('33333333-3333-3333-3333-333333333333', 'Verboten',
            '2026-09-01', '2026-09-10', '00000000-0000-0000-0000-00000000000b', 'revealed')$$,
  '42501', null, 'Client kann geschützte Trip-Spalten (status) beim Insert nicht setzen');

-- Status-Manipulation durch Client ist verboten (Spec: nur Edge Function)
select throws_ok(
  $$update public.trips set status = 'revealed'
    where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', null, 'Client kann trips.status nicht direkt setzen');

-- === Mitgliedschafts-Orakel geschlossen (Finding 1, finaler Whole-Branch-
-- Review): ein authenticated Nicht-Mitglied darf über is_trip_member() keine
-- fremden Mitgliedschaften erfragen — auch wenn die Zielperson tatsächlich
-- Mitglied ist. Carla ist Mitglied von nichts.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000c');
select is(
  public.is_trip_member('11111111-1111-1111-1111-111111111111'::uuid,
                         '00000000-0000-0000-0000-00000000000a'::uuid),
  false,
  'Orakel geschlossen: Fremde(r) erfährt nicht, ob Anna Mitglied ist');
select is(
  public.is_trip_member('11111111-1111-1111-1111-111111111111'::uuid,
                         '00000000-0000-0000-0000-00000000000c'::uuid),
  false,
  'Fremde(r) bekommt auch für die eigene Nicht-Mitgliedschaft nur false');

-- Guard bricht die legitime Selbstauskunft nicht: ein tatsächliches Mitglied
-- bekommt für die eigene UUID weiterhin das korrekte Ergebnis.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(
  public.is_trip_member('11111111-1111-1111-1111-111111111111'::uuid,
                         '00000000-0000-0000-0000-00000000000b'::uuid),
  true,
  'Guard bricht die legitime Selbstauskunft nicht: Mitglied bekommt weiterhin true');

select * from finish();
rollback;
