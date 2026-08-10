-- recap_ist_geteilt: die eine Auskunft, die Mitreisende über einen Teilen-Link
-- bekommen, und die einzige, die sie bekommen sollen.
--
-- Zwei Dinge stehen hier auf dem Spiel, und beide sind unangenehm, wenn sie
-- kippen:
--
--   1. Der TOKEN darf ein Mitglied nie erreichen. Er ist die Berechtigung
--      (share-link/aufloesung.ts); wer ihn hat, kann den Recap weiterreichen,
--      an dem alle mitgeschrieben haben. Die Funktion gibt deshalb `boolean`
--      zurück und nicht die Zeile, und die SELECT-Policy auf share_links
--      bleibt owner-only. Abschnitt C prüft beides zusammen.
--
--   2. Die Antwort muss dieselbe sein wie die von `share-link/aufloesen`.
--      Sagt sie «geteilt», wo der Link längst nichts mehr hergibt, sorgt sich
--      jemand grundlos. Sagt sie «nicht geteilt», wo er weiterhin trägt, ist
--      das die schlimmere Richtung: dann verschweigt diese App genau das, wozu
--      es die Auskunft gibt.

create extension if not exists pgtap with schema extensions;
begin;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'anna@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'cleo@test.local');

create or replace function pg_temp.login_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

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
  ('00000000-0000-0000-0000-00000000000b', 'ben', 'Ben'),
  ('00000000-0000-0000-0000-00000000000c', 'cleo', 'Cleo');

-- Anna ist Owner, Ben mitgereist, Cleo hat mit dieser Reise nichts zu tun.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('11111111-1111-1111-1111-111111111111', 'Lissabon',
          '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-00000000000a');
select pg_temp.as_service();
insert into public.trip_members (trip_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b');
update public.trips set status = 'revealed', revealed_at = '2026-08-10 18:00+00'
  where id = '11111111-1111-1111-1111-111111111111';

-- ----------------------------------------------------------------------------
-- A. Ohne Link ist nichts geteilt
-- ----------------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(public.recap_ist_geteilt('11111111-1111-1111-1111-111111111111'), false,
  'ohne Link sagt die Auskunft nein');

-- ----------------------------------------------------------------------------
-- B. Mit einem aktiven Link sehen es BEIDE, die Owner-Person und die Mitreisende
-- ----------------------------------------------------------------------------
select pg_temp.as_service();
insert into public.share_links (token, trip_id) values
  ('link-aktiv', '11111111-1111-1111-1111-111111111111');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(public.recap_ist_geteilt('11111111-1111-1111-1111-111111111111'), true,
  'die Mitreisende erfährt, dass ihr Recap geteilt ist');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select is(public.recap_ist_geteilt('11111111-1111-1111-1111-111111111111'), true,
  'die Owner-Person sieht dasselbe');

-- Der Orakel-Schutz. `security definer` hebt RLS auf, ohne die
-- Mitgliedschafts-Bedingung in der Funktion beantwortete sie für JEDE
-- beliebige trip_id, ob dort gerade geteilt wird.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000c');
select is(public.recap_ist_geteilt('11111111-1111-1111-1111-111111111111'), false,
  'wer nicht mitgereist ist, erfährt nichts, auch nicht dass geteilt wird');

-- Und eine Reise, die es gar nicht gibt, verrät ebenso wenig, sie sieht von
-- aussen aus wie eine fremde.
select is(public.recap_ist_geteilt('99999999-9999-9999-9999-999999999999'), false,
  'eine unbekannte Reise antwortet wie eine fremde');

-- ----------------------------------------------------------------------------
-- C. Der Token bleibt bei der Owner-Person
-- ----------------------------------------------------------------------------
-- Die Auskunft oben ist genau deshalb eine Funktion und keine zweite
-- SELECT-Policy: Policies entscheiden über Zeilen, nicht über Spalten, und wer
-- die Zeile liest, liest den Token mit.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.share_links
            where trip_id = '11111111-1111-1111-1111-111111111111'), 0,
  'die Mitreisende sieht die Zeile selbst nicht, und damit nie den Token');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.share_links
            where trip_id = '11111111-1111-1111-1111-111111111111'), 1,
  'die Owner-Person sieht ihre Zeile weiterhin, sie braucht den Token');

-- ----------------------------------------------------------------------------
-- D. Dieselben Grenzen wie `share-link/aufloesen`
-- ----------------------------------------------------------------------------
select pg_temp.as_service();
update public.share_links set revoked = true where token = 'link-aktiv';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(public.recap_ist_geteilt('11111111-1111-1111-1111-111111111111'), false,
  'ein widerrufener Link zählt nicht mehr als geteilt');

-- Ein zweiter, abgelaufener Link daneben: auch er trägt nichts mehr.
select pg_temp.as_service();
insert into public.share_links (token, trip_id, expires_at) values
  ('link-abgelaufen', '11111111-1111-1111-1111-111111111111', now() - interval '1 minute');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(public.recap_ist_geteilt('11111111-1111-1111-1111-111111111111'), false,
  'ein abgelaufener Link zählt nicht als geteilt');

-- Und ein dritter, der noch gilt: EIN tragender Link genügt, auch neben zwei
-- toten. Ohne diesen Fall wäre nicht zu unterscheiden, ob die Funktion
-- wirklich prüft oder nur die zuletzt eingefügte Zeile ansieht.
select pg_temp.as_service();
insert into public.share_links (token, trip_id, expires_at) values
  ('link-mit-frist', '11111111-1111-1111-1111-111111111111', now() + interval '7 days');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(public.recap_ist_geteilt('11111111-1111-1111-1111-111111111111'), true,
  'ein gültiger Link neben zwei toten genügt');

-- Die Grenze selbst, von der anderen Seite: läuft auch dieser ab, ist wieder
-- nichts geteilt. Damit ist belegt, dass `expires_at` überhaupt gelesen wird
-- und nicht bloss zufällig einmal passte.
select pg_temp.as_service();
update public.share_links set expires_at = now() - interval '1 second'
  where token = 'link-mit-frist';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(public.recap_ist_geteilt('11111111-1111-1111-1111-111111111111'), false,
  'läuft auch der letzte ab, ist wieder nichts geteilt');

-- `expires_at is null` heisst «ohne Ablauf», der Normalfall.
select pg_temp.as_service();
insert into public.share_links (token, trip_id) values
  ('link-unbefristet', '11111111-1111-1111-1111-111111111111');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(public.recap_ist_geteilt('11111111-1111-1111-1111-111111111111'), true,
  'ein Link ohne Ablaufdatum gilt');

-- ----------------------------------------------------------------------------
-- E. Ohne Anmeldung gar nichts
-- ----------------------------------------------------------------------------
select pg_temp.as_anon();
select is(has_function_privilege('anon', 'public.recap_ist_geteilt(uuid)', 'EXECUTE'), false,
  'anon darf die Auskunft gar nicht erst aufrufen');
select is(has_function_privilege('authenticated', 'public.recap_ist_geteilt(uuid)', 'EXECUTE'), true,
  'authenticated darf sie aufrufen');

select * from finish();
rollback;
