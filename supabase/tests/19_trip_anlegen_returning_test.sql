-- Eine Reise anlegen, so wie die App es tut: mit RETURNING.
--
-- `createTrip` (mobile/src/features/trips/tripsApi.ts) hängt ein
-- `.select('id').single()` an, weil es die neue id für die Navigation zum
-- Einladen-Screen braucht. Daraus wird ein INSERT ... RETURNING, und dabei
-- prüft Postgres NICHT NUR die WITH-CHECK-Bedingung der Insert-Policy, sondern
-- zusätzlich die SELECT-Policy auf der neuen Zeile. Schlägt die fehl, meldet
-- Postgres das mit demselben Text wie eine WITH-CHECK-Verletzung:
-- «new row violates row-level security policy».
--
-- Die Select-Policy verlangte `is_trip_member(id, auth.uid())`, also eine Zeile
-- in trip_members. Die legt aber `add_owner_membership` als AFTER-INSERT-Trigger
-- an, mithin NACH der Prüfung. Der Owner konnte seine eigene, gerade angelegte
-- Reise im selben Statement nicht lesen, und das Anlegen scheiterte in der App
-- mit «Die Reise konnte nicht angelegt werden.».
--
-- 03_membership_rls_test.sql prüft das Anlegen ohne RETURNING und lief deshalb
-- grün, obwohl der Weg der App verschlossen war.
create extension if not exists pgtap with schema extensions;
begin;
select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'erik@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'eva@test.local');

create or replace function pg_temp.login_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-0000-0000-0000000000e1', 'erik', 'Erik'),
  ('00000000-0000-0000-0000-0000000000e2', 'eva', 'Eva');

select pg_temp.login_as('00000000-0000-0000-0000-0000000000e1');

-- Der eigentliche Fall: derselbe Aufruf, den die App macht.
select lives_ok(
  $$insert into public.trips (id, name, start_date, end_date, owner_id)
    values ('e1111111-1111-4111-8111-111111111111', 'Norwegen mit dem Camper',
            '2026-08-01', '2026-08-14', '00000000-0000-0000-0000-0000000000e1')
    returning id$$,
  'Der Owner legt eine Reise mit RETURNING an, so wie createTrip es tut'
);

select is(count(*)::int, 1, 'Die Owner-Mitgliedschaft steht danach trotzdem')
  from public.trip_members
  where trip_id = 'e1111111-1111-4111-8111-111111111111'
    and user_id = '00000000-0000-0000-0000-0000000000e1' and role = 'owner';

-- Die Erweiterung der Select-Policy darf nichts aufmachen: Eva ist weder Owner
-- noch Mitglied und sieht die Reise weiterhin nicht.
select pg_temp.login_as('00000000-0000-0000-0000-0000000000e2');
select is(count(*)::int, 0, 'Eine Fremde sieht die Reise weiterhin nicht')
  from public.trips where id = 'e1111111-1111-4111-8111-111111111111';

-- Und sie kann sich auch keine Reise auf fremden Namen anlegen: die
-- WITH-CHECK-Bedingung der Insert-Policy gilt unverändert.
select throws_ok(
  $$insert into public.trips (id, name, start_date, end_date, owner_id)
    values ('e2222222-2222-4222-8222-222222222222', 'Fremde Reise',
            '2026-08-01', '2026-08-14', '00000000-0000-0000-0000-0000000000e1')
    returning id$$,
  '42501',
  'new row violates row-level security policy for table "trips"',
  'Eine Reise auf fremden Namen bleibt verwehrt'
);

select * from finish();
rollback;
