-- share_links_all_owner (20260803090500_social_rls.sql): seit Phase 1 da,
-- nie benutzt. Belegt hier zum ersten Mal: Owner darf für eine revealed
-- Reise anlegen, für eine active Reise nicht; ein Mitglied ohne Owner-Rolle
-- darf weder anlegen noch fremde Zeilen sehen; anon kommt gar nicht heran;
-- ein Update auf revoked durch die Owner-Person gelingt — UND (Kern dieser
-- Datei): with check gilt für UPDATE genauso wie für INSERT, using dagegen
-- kennt gar keine Status-Bedingung. Das eine erlaubt/verbietet, das andere
-- lässt lesen/löschen unabhängig vom Reise-Status.

create extension if not exists pgtap with schema extensions;
begin;
select plan(11);

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

-- Simuliert eine Edge Function (Phasen 3–6): echtes service_role-Privileg
-- statt Superuser-Bypass.
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

-- Trip mit Anna (Owner) + Ben, noch active (Default).
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('11111111-1111-1111-1111-111111111111', 'Lissabon',
          '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-00000000000a');
select pg_temp.as_service();
insert into public.trip_members (trip_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b');

-- === 1. Für eine active Reise legt auch der Owner keinen Link an ===
-- with check verlangt status = 'revealed' — bei INSERT unstrittig zuständig.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$insert into public.share_links (trip_id)
    values ('11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'Für eine active Reise legt der Owner keinen Share-Link an');

-- Reveal
select pg_temp.as_service();
update public.trips set status = 'revealed', revealed_at = '2026-08-10 18:00+00'
  where id = '11111111-1111-1111-1111-111111111111';

-- === 2. Owner darf für eine revealed Reise anlegen ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.share_links (token, trip_id)
  values ('link-eins', '11111111-1111-1111-1111-111111111111');
select pass('Owner legt für eine revealed Reise einen Share-Link an');

-- === 3. Ein Mitglied ohne Owner-Rolle darf weder anlegen ... ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$insert into public.share_links (token, trip_id)
    values ('link-ben', '11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'Ein Mitglied ohne Owner-Rolle legt keinen Share-Link an');

-- === ... noch fremde Zeilen sehen ===
select is(
  (select count(*)::int from public.share_links where trip_id = '11111111-1111-1111-1111-111111111111'),
  0, 'Ein Mitglied ohne Owner-Rolle sieht fremde Share-Links nicht');

-- === 4. anon kommt gar nicht heran (weder lesen noch schreiben) ===
select pg_temp.as_anon();
select throws_ok(
  $$select * from public.share_links$$,
  '42501', null, 'anon darf share_links nicht lesen');
select throws_ok(
  $$insert into public.share_links (token, trip_id)
    values ('link-anon', '11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'anon darf share_links nicht beschreiben');

-- === 5. Ein Update auf revoked durch die Owner-Person gelingt ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
update public.share_links set revoked = true where token = 'link-eins';
select is(
  (select revoked from public.share_links where token = 'link-eins'),
  true, 'Owner kann den eigenen Share-Link widerrufen (revoked = true)');

-- === 6. with check gilt auch für UPDATE, nicht nur für INSERT ===
-- Ein zweiter Link auf der (noch) revealed Reise, danach wird die Reise
-- archiviert. using prüft nur die Eigentümerschaft (kein Status-Kriterium) —
-- with check verlangt weiterhin status = 'revealed'. Für UPDATE wird with
-- check gegen die NEUE Zeile ausgewertet (trip_id ändert sich hier nicht,
-- also gegen denselben, jetzt archivierten Trip) — die Erwartung ist darum:
-- lesen/löschen bleiben möglich (using), aber revoked setzen (with check)
-- schlägt fehl, sobald die Reise nicht mehr 'revealed' ist.
insert into public.share_links (token, trip_id)
  values ('link-zwei', '11111111-1111-1111-1111-111111111111');
select pg_temp.as_service();
update public.trips set status = 'archived' where id = '11111111-1111-1111-1111-111111111111';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$update public.share_links set revoked = true where token = 'link-zwei'$$,
  '42501', null,
  'Owner kann einen Share-Link auf einer archivierten Reise nicht widerrufen (with check verlangt weiterhin status = revealed)');
select is(
  (select revoked from public.share_links where token = 'link-zwei'),
  false, 'link-zwei blieb nach dem verweigerten Update unverändert (revoked = false)');

-- === 7. using kennt keine Status-Bedingung: lesen bleibt möglich ===
select is(
  (select count(*)::int from public.share_links where trip_id = '11111111-1111-1111-1111-111111111111'),
  2, 'Owner sieht beide Share-Links weiterhin, obwohl die Reise archiviert ist (using prüft nur Eigentümerschaft)');

-- === 8. ... und löschen ebenfalls (using ohne Status-Bedingung, für DELETE
-- gibt es kein with check) ===
delete from public.share_links where token = 'link-zwei';
select is(
  (select count(*)::int from public.share_links where trip_id = '11111111-1111-1111-1111-111111111111'),
  1, 'Owner kann einen Share-Link auf einer archivierten Reise weiterhin löschen (using ohne Status-Bedingung)');

select * from finish();
rollback;
