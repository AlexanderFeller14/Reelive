-- Reveal-Regeln: trips.status/revealed_at bleiben für authenticated
-- unschreibbar (fehlender Spalten-Grant), und can_see_post gilt jetzt für
-- 'revealed' UND 'archived' (20260808090100_can_see_post_archived.sql) —
-- reactions, comments UND reports hängen alle drei an can_see_post
-- (20260803090500_social_rls.sql). Geprüft wird hier mit reactions und
-- comments; reports_insert nutzt dieselbe Funktion und ist damit durch
-- denselben Codepfad gedeckt, reports_select_owner ist unabhängig davon
-- owner-gebunden und bleibt unberührt.

create extension if not exists pgtap with schema extensions;
begin;
select plan(17);

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
-- statt Superuser-Bypass, u.a. für den eigentlichen Statuswechsel.
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

-- Trip mit Anna (Owner) + Ben; Carla ist NICHT Mitglied.
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

-- === 1+2: authenticated kann trips.status/revealed_at nicht schreiben ===
-- SQLSTATE am laufenden Stack ermittelt (nicht geraten): 42501 - derselbe
-- Fehlercode wie für jede andere fehlende Spalten-/Tabellenberechtigung in
-- diesem Schema (vgl. posts.created_at/upload_status in
-- 07_role_hardening_test.sql). Geprüft per psql gegen den lokalen Stack:
-- "GRANT UPDATE ON public.trips TO authenticated" fehlt für diese Spalten,
-- Postgres meldet insufficient_privilege (42501).
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$update public.trips set status = 'revealed'
    where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', null, 'authenticated kann trips.status nicht schreiben');
select throws_ok(
  $$update public.trips set revealed_at = now()
    where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', null, 'authenticated kann trips.revealed_at nicht schreiben');

-- Die stärkere Form (vgl. 12_upload_status_test.sql:116-119): nicht nur der
-- Fehlercode, sondern der Zustand danach. authenticated hat volles SELECT auf
-- trips (20260803090200_membership_rls.sql) - Anna liest hier als Owner ihre
-- eigene Reise, kein Rollenwechsel nötig.
select is(
  (select status::text from public.trips where id = '11111111-1111-1111-1111-111111111111'),
  'active', 'trips.status blieb nach dem verweigerten Update unverändert (active)');
select is(
  (select revealed_at from public.trips where id = '11111111-1111-1111-1111-111111111111'),
  null, 'trips.revealed_at blieb nach dem verweigerten Update unverändert (NULL)');

-- Fixture: vorab (per service_role) je eine Reaktion und ein Kommentar von
-- Ben anlegen, damit die Sichtbarkeits-Assertionen unten nicht vakuos sind -
-- es gibt tatsächlich eine Zeile, die verborgen bleiben muss.
select pg_temp.as_service();
insert into public.reactions (post_id, user_id, emoji) values
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000b', '🔥');
insert into public.comments (post_id, user_id, text) values
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000b', 'Schönes Foto!');

-- === 3. Vor dem Reveal: Mitglied sieht weder Reaktionen noch Kommentare ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.reactions where post_id = '22222222-2222-2222-2222-222222222222'),
  0, 'vor dem Reveal sieht ein Mitglied keine Reaktionen');
select is(
  (select count(*)::int from public.comments where post_id = '22222222-2222-2222-2222-222222222222'),
  0, 'vor dem Reveal sieht ein Mitglied keine Kommentare');

-- === Reveal (service_role, wie in 07_role_hardening_test.sql) ===
select pg_temp.as_service();
update public.trips set status = 'revealed', revealed_at = '2026-08-10 18:00+00'
  where id = '11111111-1111-1111-1111-111111111111';

-- === 4. Nach dem Reveal: Mitglied sieht sie und schreibt im eigenen Namen ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.reactions where post_id = '22222222-2222-2222-2222-222222222222'),
  1, 'nach dem Reveal sieht ein Mitglied die Reaktion');
select is(
  (select count(*)::int from public.comments where post_id = '22222222-2222-2222-2222-222222222222'),
  1, 'nach dem Reveal sieht ein Mitglied den Kommentar');

insert into public.reactions (post_id, user_id, emoji) values
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000b', '❤️');
select pass('nach dem Reveal kann ein Mitglied im eigenen Namen reagieren');
insert into public.comments (post_id, user_id, text) values
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000b', 'Noch ein Kommentar');
select pass('nach dem Reveal kann ein Mitglied im eigenen Namen kommentieren');

-- === 5. Nach dem Reveal: Nicht-Mitglied sieht nichts ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000c');
select is(
  (select count(*)::int from public.reactions where post_id = '22222222-2222-2222-2222-222222222222'),
  0, 'ein Nicht-Mitglied sieht auch nach dem Reveal keine Reaktionen');
select is(
  (select count(*)::int from public.comments where post_id = '22222222-2222-2222-2222-222222222222'),
  0, 'ein Nicht-Mitglied sieht auch nach dem Reveal keine Kommentare');

-- === 6. status='archived': Mitglied sieht weiterhin - der Test, der ohne
-- 20260808090100_can_see_post_archived.sql fehlschlägt ===
select pg_temp.as_service();
update public.trips set status = 'archived'
  where id = '11111111-1111-1111-1111-111111111111';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.reactions where post_id = '22222222-2222-2222-2222-222222222222'),
  2, 'im Archiv sieht ein Mitglied die Reaktionen weiterhin');
select is(
  (select count(*)::int from public.comments where post_id = '22222222-2222-2222-2222-222222222222'),
  2, 'im Archiv sieht ein Mitglied die Kommentare weiterhin');

-- === 7. can_see_post bleibt nach dem CREATE OR REPLACE (Archiv-Erweiterung,
-- 20260808090100_can_see_post_archived.sql) vor anon verschlossen ===
-- Ein CREATE OR REPLACE ersetzt nur den Funktionskörper und erhält laut
-- Migrationskommentar die bestehende ACL aus 20260803090600_role_hardening.sql
-- unangetastet - diese Zeile ist der Beleg dafür, nicht nur die Behauptung.
-- Vorlage: 10_counts_archived_test.sql (my_post_counts-Grant-Assertion).
reset role;
select ok(
  not has_function_privilege('anon','public.can_see_post(uuid)','execute'),
  'anon darf can_see_post nicht ausführen');

-- Re-Review-Ergänzung: der Migrationskommentar in
-- 20260808090100_can_see_post_archived.sql verspricht vier unveränderte
-- Eigenschaften ("Signatur, security definer, set search_path und Grants
-- bleiben unverändert") - bisher war nur der Grant belegt (Assertion oben).
-- Gerade `set search_path = public` auf einer SECURITY DEFINER-Funktion ist
-- die klassische Eskalationslücke: fehlte es, könnte eine Session mit
-- manipuliertem `search_path` can_see_post dazu bringen, eine eigene
-- gleichnamige Funktion/Tabelle statt der echten `public.*`-Objekte
-- aufzulösen - mit den Rechten des Funktionsbesitzers. pg_proc trägt beides
-- direkt: prosecdef (SECURITY DEFINER ja/nein) und proconfig (die GUC-Liste,
-- der Eintrag "search_path=public" darunter). Werte am laufenden Stack per
-- psql erhoben, nicht geraten.
select is(
  (select prosecdef from pg_proc where oid = 'public.can_see_post(uuid)'::regprocedure),
  true,
  'can_see_post bleibt SECURITY DEFINER');
select is(
  (select proconfig from pg_proc where oid = 'public.can_see_post(uuid)'::regprocedure),
  array['search_path=public'],
  'can_see_post behält search_path=public - sonst könnte eine Session mit manipuliertem search_path die Auflösung von public.* umlenken');

select * from finish();
rollback;
