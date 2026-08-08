-- push_tokens: eigene Zeile anlegen/lesen/löschen, fremde Zeilen unsichtbar
-- und unantastbar, anon aussen vor, und der Kern des Task-1-Kontexts: ein
-- Geräte-/Account-Wechsel übernimmt die Zeile per Upsert, statt sie zu
-- duplizieren (siehe Tabellen-/Trigger-Kommentare in
-- 20260808090000_push_tokens.sql).

create extension if not exists pgtap with schema extensions;
begin;
select plan(12);

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
-- statt Superuser-Bypass, um Zeilen unabhängig von RLS zu prüfen.
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

-- === 1. Angemeldet: eigene Zeile anlegen gelingt ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.push_tokens (token, user_id, platform)
  values ('tok-anna-1', '00000000-0000-0000-0000-00000000000a', 'ios');
select pass('Angemeldet kann eine eigene push_tokens-Zeile anlegen');

-- === 2. Angemeldet: die eigene Zeile löschen gelingt ===
-- Genau darauf baut die App: deregistrierePushToken() beim Abmelden löscht die
-- eigene Zeile. Eigener Scratch-Token statt tok-anna-1: der wird weiter unten
-- (Schritt 6) noch für den Upsert-Übernahme-Test gebraucht.
insert into public.push_tokens (token, user_id, platform)
  values ('tok-anna-scratch', '00000000-0000-0000-0000-00000000000a', 'ios');
delete from public.push_tokens where token = 'tok-anna-scratch';
select is(
  (select count(*)::int from public.push_tokens where token = 'tok-anna-scratch'), 0,
  'Angemeldet kann die eigene push_tokens-Zeile löschen (push_tokens_delete_own)');

-- === 3. Angemeldet: eine Zeile mit fremder user_id anlegen scheitert ===
select throws_ok(
  $$insert into public.push_tokens (token, user_id, platform)
    values ('tok-anna-2', '00000000-0000-0000-0000-00000000000b', 'ios')$$,
  '42501', null, 'eine Zeile mit fremder user_id anzulegen scheitert');

-- Fixture: Ben legt seine eigene Zeile an (kein eigenes Testziel dieses
-- Schritts, macht aber die Sichtbarkeits-Assertion unten nicht vakuos).
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
insert into public.push_tokens (token, user_id, platform)
  values ('tok-ben-1', '00000000-0000-0000-0000-00000000000b', 'android');

-- === 4. Angemeldet: fremde Zeilen sind unsichtbar ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.push_tokens), 1,
  'fremde Zeilen sind unsichtbar - Anna sieht nur ihre eigene');

-- === 5. Angemeldet: fremde Zeile löschen bewirkt nichts ===
delete from public.push_tokens where token = 'tok-ben-1';
select pg_temp.as_service();
select is(
  (select count(*)::int from public.push_tokens where token = 'tok-ben-1'), 1,
  'eine fremde Zeile zu löschen bewirkt nichts - Bens Zeile besteht weiter');

-- === 6. anon: jeder Zugriff scheitert ===
select pg_temp.as_anon();
select throws_ok(
  $$select count(*) from public.push_tokens$$,
  '42501', null, 'anon: select scheitert');
select throws_ok(
  $$insert into public.push_tokens (token, user_id, platform)
    values ('tok-anon-1', '00000000-0000-0000-0000-00000000000a', 'ios')$$,
  '42501', null, 'anon: insert scheitert');
select throws_ok(
  $$update public.push_tokens set platform = 'android' where token = 'tok-anna-1'$$,
  '42501', null, 'anon: update scheitert');
select throws_ok(
  $$delete from public.push_tokens where token = 'tok-anna-1'$$,
  '42501', null, 'anon: delete scheitert');

-- === 7. Geräte-/Account-Wechsel: Upsert durch eine ANDERE Person übernimmt
-- die Zeile, statt sie zu duplizieren ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
insert into public.push_tokens (token, user_id, platform)
  values ('tok-anna-1', '00000000-0000-0000-0000-00000000000b', 'android')
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
select pass('Ben übernimmt Annas Token per Upsert');

select pg_temp.as_service();
select is(
  (select user_id from public.push_tokens where token = 'tok-anna-1'),
  '00000000-0000-0000-0000-00000000000b'::uuid,
  'die Zeile gehört nach dem Upsert tatsächlich der zweiten Person');
select is(
  (select count(*)::int from public.push_tokens where token = 'tok-anna-1'), 1,
  'die Zeile existiert nach dem Upsert nur einmal, nicht doppelt');

select * from finish();
rollback;
