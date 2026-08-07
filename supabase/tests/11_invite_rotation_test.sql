create extension if not exists pgtap with schema extensions;
begin;
select plan(4);

-- Belegt den Vertrag aus 20260807090000_invite_rotation_on_removal.sql:
-- Rauswurf rotiert den invite_code, freiwilliges Verlassen nicht.

insert into auth.users (id, email) values
  ('eeee0000-0000-4000-8000-000000000001', 'owner11@test.local'),
  ('eeee0000-0000-4000-8000-000000000002', 'geht11@test.local'),
  ('eeee0000-0000-4000-8000-000000000003', 'raus11@test.local'),
  ('eeee0000-0000-4000-8000-000000000004', 'extern11@test.local');

insert into public.profiles (id, username, display_name) values
  ('eeee0000-0000-4000-8000-000000000001', 'owner_t11', 'Owner'),
  ('eeee0000-0000-4000-8000-000000000002', 'geht_t11',  'Geht Freiwillig'),
  ('eeee0000-0000-4000-8000-000000000003', 'raus_t11',  'Wird Entfernt'),
  ('eeee0000-0000-4000-8000-000000000004', 'extern_t11','Von Aussen');

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
  perform set_config('request.jwt.claims', null, true);
  perform set_config('role', 'postgres', true);
end $$;

-- Simuliert eine Edge Function / einen Seed: echte Rolle, aber kein `sub` im
-- Claim — genau der Fall auth.uid() is null.
create or replace function pg_temp.as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;

-- Reise anlegen (der Owner-Trigger aus Phase 1 macht den Owner zum Mitglied),
-- danach drei weitere Mitglieder direkt einsetzen: trip_members hat bewusst
-- keine Insert-Policy für authenticated.
select pg_temp.login_as('eeee0000-0000-4000-8000-000000000001');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('ffff0000-0000-4000-8000-000000000001', 'Rotationsreise',
          '2026-08-01', '2026-08-14', 'eeee0000-0000-4000-8000-000000000001');
select pg_temp.logout();

insert into public.trip_members (trip_id, user_id) values
  ('ffff0000-0000-4000-8000-000000000001', 'eeee0000-0000-4000-8000-000000000002'),
  ('ffff0000-0000-4000-8000-000000000001', 'eeee0000-0000-4000-8000-000000000003'),
  ('ffff0000-0000-4000-8000-000000000001', 'eeee0000-0000-4000-8000-000000000004');

-- === 1. Freiwilliges Verlassen: der Code bleibt ===
select set_config('test.code_vor_austritt',
  (select invite_code from public.trips where id = 'ffff0000-0000-4000-8000-000000000001'), true);

select pg_temp.login_as('eeee0000-0000-4000-8000-000000000002');
delete from public.trip_members
  where trip_id = 'ffff0000-0000-4000-8000-000000000001'
    and user_id = 'eeee0000-0000-4000-8000-000000000002';
select pg_temp.logout();

select is(
  (select invite_code from public.trips where id = 'ffff0000-0000-4000-8000-000000000001'),
  current_setting('test.code_vor_austritt'),
  'freiwilliges Verlassen laesst den invite_code unveraendert');

-- Das ist der Punkt der ganzen Änderung: der bereits geteilte Link muss nach
-- einem Austritt für alle anderen weiter funktionieren.
select is(
  (select count(*)::int from public.peek_invite(current_setting('test.code_vor_austritt'))), 1,
  'der vor dem Austritt geteilte Link loest danach weiter auf');

-- === 2. Rauswurf durch den Owner: der Code rotiert ===
select set_config('test.code_vor_rauswurf',
  (select invite_code from public.trips where id = 'ffff0000-0000-4000-8000-000000000001'), true);

select pg_temp.login_as('eeee0000-0000-4000-8000-000000000001');
delete from public.trip_members
  where trip_id = 'ffff0000-0000-4000-8000-000000000001'
    and user_id = 'eeee0000-0000-4000-8000-000000000003';
select pg_temp.logout();

select isnt(
  (select invite_code from public.trips where id = 'ffff0000-0000-4000-8000-000000000001'),
  current_setting('test.code_vor_rauswurf'),
  'Rauswurf durch den Owner rotiert den invite_code');

-- === 3. Ohne Client-Identität (service_role) rotiert der Code ebenfalls ===
select set_config('test.code_vor_service',
  (select invite_code from public.trips where id = 'ffff0000-0000-4000-8000-000000000001'), true);

select pg_temp.as_service();
delete from public.trip_members
  where trip_id = 'ffff0000-0000-4000-8000-000000000001'
    and user_id = 'eeee0000-0000-4000-8000-000000000004';
select pg_temp.logout();

select isnt(
  (select invite_code from public.trips where id = 'ffff0000-0000-4000-8000-000000000001'),
  current_setting('test.code_vor_service'),
  'ohne auth.uid() (service_role, Seed, Migration) rotiert der invite_code');

select * from finish();
rollback;
