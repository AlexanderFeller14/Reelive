-- reports: melden (reports_insert, 20260803090500_social_rls.sql) und
-- Moderation (reports_select_owner, reports_update_owner + erledigt_am,
-- 20260808120000_reports_erledigt.sql). Kern dieser Datei ist der
-- Spalten-Grant: dass die Owner-Person erledigt_am setzen KANN, ist die
-- halbe Geschichte — die andere Hälfte ist, dass dieselbe Owner-Person
-- reason/post_id NICHT ändern kann, auch mit einem sonst gültigen
-- Update-Statement. Ein Test, der nur den Erfolgsfall zeigt, würde die
-- Spalten-Einschränkung nicht beweisen.

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

-- Simuliert eine Edge Function (Phasen 3–6): echtes service_role-Privileg
-- statt Superuser-Bypass.
create or replace function pg_temp.as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-0000-0000-00000000000a', 'anna', 'Anna'),
  ('00000000-0000-0000-0000-00000000000b', 'ben', 'Ben'),
  ('00000000-0000-0000-0000-00000000000c', 'carla', 'Carla');

-- Trip 1: Anna (Owner) + Ben (Mitglied), ein Post von Anna.
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

-- Trip 2: Carla (Owner), bereits revealed, ein Post — Ben ist HIER kein
-- Mitglied. Dient unten dem can_see_post-Grenztest.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000c');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('33333333-3333-3333-3333-333333333333', 'Porto',
          '2026-03-01', '2026-03-05', '00000000-0000-0000-0000-00000000000c');
insert into public.posts (id, trip_id, author_id, type, storage_key, captured_at, captured_tz)
  values ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333',
          '00000000-0000-0000-0000-00000000000c', 'photo', 'trips/y/1.jpg',
          '2026-03-02 09:00+00', 'Europe/Lisbon');
select pg_temp.as_service();
update public.trips set status = 'revealed', revealed_at = '2026-03-06 12:00+00'
  where id = '33333333-3333-3333-3333-333333333333';

-- === 1. Vor dem Reveal (Trip 1) geht Melden nicht — can_see_post ist false ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$insert into public.reports (post_id, reporter_id, reason)
    values ('22222222-2222-2222-2222-222222222222',
            '00000000-0000-0000-0000-00000000000b', 'Unpassend')$$,
  '42501', null, 'Vor dem Reveal kann ein Mitglied nicht melden');

-- Reveal Trip 1
select pg_temp.as_service();
update public.trips set status = 'revealed', revealed_at = '2026-08-10 18:00+00'
  where id = '11111111-1111-1111-1111-111111111111';

-- === 2. Melden nur im eigenen Namen — Ben kann nicht als Anna melden ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$insert into public.reports (post_id, reporter_id, reason)
    values ('22222222-2222-2222-2222-222222222222',
            '00000000-0000-0000-0000-00000000000a', 'Fremder Name')$$,
  '42501', null, 'Melden geht nur im eigenen Namen, nicht für eine andere Person');

-- === 3. Mitglied kann melden (eigener Name, sichtbarer Post) ===
insert into public.reports (id, post_id, reporter_id, reason) values
  ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222',
   '00000000-0000-0000-0000-00000000000b', 'Unpassend');
select pass('Ein Mitglied kann einen sichtbaren Post im eigenen Namen melden');

-- === 4. can_see_post-Grenze: Ben ist in Trip 2 kein Mitglied, meldet dort
-- trotz Reveal nicht ===
select throws_ok(
  $$insert into public.reports (post_id, reporter_id, reason)
    values ('44444444-4444-4444-4444-444444444444',
            '00000000-0000-0000-0000-00000000000b', 'Nicht mein Trip')$$,
  '42501', null, 'Ohne Mitgliedschaft kann Ben auch einen revealed Post nicht melden');

-- === 5. Nur die Owner-Person liest ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.reports where post_id = '22222222-2222-2222-2222-222222222222'),
  1, 'Die Owner-Person liest die Meldung');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.reports where post_id = '22222222-2222-2222-2222-222222222222'),
  0, 'Ein Nicht-Owner-Mitglied liest die Meldung nicht');

-- === 6. Nur die Owner-Person setzt erledigt_am ===
-- Ben ist Mitglied, aber nicht Owner: reports_update_owner (using) trifft
-- auf seine Zeile nicht zu — kein Fehler, die Zeile wird beim Update still
-- gefiltert (0 betroffene Zeilen), wie reactions_delete_own in
-- 06_social_rls_test.sql.
update public.reports set erledigt_am = now() where id = '55555555-5555-5555-5555-555555555555';
select is(
  (select erledigt_am from public.reports where id = '55555555-5555-5555-5555-555555555555'),
  null, 'Ein Nicht-Owner-Mitglied kann erledigt_am nicht setzen (RLS filtert still)');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
update public.reports set erledigt_am = '2026-08-11 09:00+00'
  where id = '55555555-5555-5555-5555-555555555555';
select is(
  (select erledigt_am from public.reports where id = '55555555-5555-5555-5555-555555555555'),
  '2026-08-11 09:00+00'::timestamptz, 'Die Owner-Person kann erledigt_am setzen');

-- === 7. Der Spalten-Grant: selbst die Owner-Person ändert reason/post_id
-- nicht — grant update (erledigt_am) deckt NUR diese eine Spalte ===
select throws_ok(
  $$update public.reports set reason = 'Nachträglich verfälscht'
    where id = '55555555-5555-5555-5555-555555555555'$$,
  '42501', null, 'Die Owner-Person kann reason nicht ändern (kein Spalten-Grant)');

select throws_ok(
  $$update public.reports set post_id = '44444444-4444-4444-4444-444444444444'
    where id = '55555555-5555-5555-5555-555555555555'$$,
  '42501', null, 'Die Owner-Person kann post_id nicht ändern (kein Spalten-Grant)');

-- Ein Statement, das eine erlaubte UND eine verbotene Spalte gleichzeitig
-- setzt, scheitert als Ganzes — der Spalten-Grant lässt kein Teil-Update zu.
select throws_ok(
  $$update public.reports set erledigt_am = now(), reason = 'Verfälscht'
    where id = '55555555-5555-5555-5555-555555555555'$$,
  '42501', null,
  'Ein Update, das erledigt_am UND reason setzt, scheitert vollständig (keine Teilwirkung)');

-- === 8. Zustand nach allen verweigerten Versuchen: reason/post_id
-- unverändert, erledigt_am bleibt beim zuvor gesetzten Wert ===
select is(
  (select reason from public.reports where id = '55555555-5555-5555-5555-555555555555'),
  'Unpassend', 'reason blieb nach den verweigerten Updates unverändert');
select is(
  (select post_id from public.reports where id = '55555555-5555-5555-5555-555555555555'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'post_id blieb nach den verweigerten Updates unverändert');
select is(
  (select erledigt_am from public.reports where id = '55555555-5555-5555-5555-555555555555'),
  '2026-08-11 09:00+00'::timestamptz,
  'erledigt_am blieb beim zuvor gesetzten Wert (kein Seiteneffekt der gescheiterten Updates)');

select * from finish();
rollback;
