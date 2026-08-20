-- recap_is_shared: die eine Auskunft, die Mitreisende über einen Teilen-Link
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
select plan(22);

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
select is(public.recap_is_shared('11111111-1111-1111-1111-111111111111'), false,
  'without a link the answer says no');

-- ----------------------------------------------------------------------------
-- B. Mit einem aktiven Link sehen es BEIDE, die Owner-Person und die Mitreisende
-- ----------------------------------------------------------------------------
select pg_temp.as_service();
insert into public.share_links (token, trip_id) values
  ('link-aktiv', '11111111-1111-1111-1111-111111111111');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(public.recap_is_shared('11111111-1111-1111-1111-111111111111'), true,
  'the fellow traveler learns that their recap is shared');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select is(public.recap_is_shared('11111111-1111-1111-1111-111111111111'), true,
  'the owner sees the same');

-- Der Orakel-Schutz. `security definer` hebt RLS auf, ohne die
-- Mitgliedschafts-Bedingung in der Funktion beantwortete sie für JEDE
-- beliebige trip_id, ob dort gerade geteilt wird.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000c');
select is(public.recap_is_shared('11111111-1111-1111-1111-111111111111'), false,
  'whoever did not come along learns nothing, not even that sharing is happening');

-- Und eine Reise, die es gar nicht gibt, verrät ebenso wenig, sie sieht von
-- aussen aus wie eine fremde.
select is(public.recap_is_shared('99999999-9999-9999-9999-999999999999'), false,
  'an unknown trip answers just like a stranger''s');

-- ----------------------------------------------------------------------------
-- C. Der Token bleibt bei der Owner-Person
-- ----------------------------------------------------------------------------
-- Die Auskunft oben ist genau deshalb eine Funktion und keine zweite
-- SELECT-Policy: Policies entscheiden über Zeilen, nicht über Spalten, und wer
-- die Zeile liest, liest den Token mit.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.share_links
            where trip_id = '11111111-1111-1111-1111-111111111111'), 0,
  'the fellow traveler never sees the row itself, and so never the token');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.share_links
            where trip_id = '11111111-1111-1111-1111-111111111111'), 1,
  'the owner still sees their row, they need the token');

-- ----------------------------------------------------------------------------
-- D. Dieselben Grenzen wie `share-link/aufloesen`
-- ----------------------------------------------------------------------------
select pg_temp.as_service();
update public.share_links set revoked = true where token = 'link-aktiv';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(public.recap_is_shared('11111111-1111-1111-1111-111111111111'), false,
  'a revoked link no longer counts as shared');

-- Ein zweiter, abgelaufener Link daneben: auch er trägt nichts mehr.
select pg_temp.as_service();
insert into public.share_links (token, trip_id, expires_at) values
  ('link-abgelaufen', '11111111-1111-1111-1111-111111111111', now() - interval '1 minute');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(public.recap_is_shared('11111111-1111-1111-1111-111111111111'), false,
  'an expired link does not count as shared');

-- Und ein dritter, der noch gilt: EIN tragender Link genügt, auch neben zwei
-- toten. Ohne diesen Fall wäre nicht zu unterscheiden, ob die Funktion
-- wirklich prüft oder nur die zuletzt eingefügte Zeile ansieht.
select pg_temp.as_service();
insert into public.share_links (token, trip_id, expires_at) values
  ('link-mit-frist', '11111111-1111-1111-1111-111111111111', now() + interval '7 days');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(public.recap_is_shared('11111111-1111-1111-1111-111111111111'), true,
  'one valid link next to two dead ones is enough');

-- Die Grenze selbst, von der anderen Seite: läuft auch dieser ab, ist wieder
-- nichts geteilt. Damit ist belegt, dass `expires_at` überhaupt gelesen wird
-- und nicht bloss zufällig einmal passte.
select pg_temp.as_service();
update public.share_links set expires_at = now() - interval '1 second'
  where token = 'link-mit-frist';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(public.recap_is_shared('11111111-1111-1111-1111-111111111111'), false,
  'once the last one expires too, nothing is shared again');

-- `expires_at is null` heisst «ohne Ablauf», der Normalfall.
select pg_temp.as_service();
insert into public.share_links (token, trip_id) values
  ('link-unbefristet', '11111111-1111-1111-1111-111111111111');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(public.recap_is_shared('11111111-1111-1111-1111-111111111111'), true,
  'a link with no expiry date counts');

-- ----------------------------------------------------------------------------
-- E. Die View traegt die Regel, und sie traegt die RLS mit
-- ----------------------------------------------------------------------------
-- `aktive_share_links` (Migration 20260810120000) ist die EINE Stelle, an der
-- steht, welcher Link gerade traegt. Sie hat zwei Leser mit verschiedenen
-- Sichtweiten: den Client der Owner-Person (braucht den Token) und
-- `recap_is_shared` (braucht nur ja/nein).
--
-- Das Gefaehrliche an einer View ueber einer Tabelle mit RLS ist der
-- Vorgabewert: OHNE `security_invoker = on` gehoert sie ihrem Erzeuger, und
-- jede angemeldete Person saehe darin JEDEN Token JEDER Reise. Die naechsten
-- Zusicherungen sind genau dagegen.

-- Ausgangslage: ein gueltiger Link, ein widerrufener, ein abgelaufener.
select pg_temp.as_service();
update public.share_links set revoked = false, expires_at = null where token = 'link-unbefristet';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.aktive_share_links
            where trip_id = '11111111-1111-1111-1111-111111111111'), 1,
  'the owner sees in the view exactly the one link that still carries');

select is((select token from public.aktive_share_links
            where trip_id = '11111111-1111-1111-1111-111111111111'), 'link-unbefristet',
  'and specifically the right one, not the revoked or the expired one');

-- DIE Zusicherung, wegen der `security_invoker = on` in der Migration steht.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.aktive_share_links), 0,
  'the fellow traveler sees NO row in the view, the table''s RLS still applies');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.aktive_share_links), 0,
  'a stranger even less so');

-- Und die Gegenprobe zur Sichtweite: die Auskunft an die Mitreisende sagt
-- trotzdem ja. Genau das ist der Unterschied zwischen den beiden Lesern, und
-- ohne dieses Paar waere nicht zu erkennen, ob die Funktion die View
-- ueberhaupt erreicht oder bloss dieselbe leere Sicht bekommt wie der Client.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(public.recap_is_shared('11111111-1111-1111-1111-111111111111'), true,
  'the answer says yes, even though that same person may not see the row');

select is(has_table_privilege('anon', 'public.aktive_share_links', 'SELECT'), false,
  'anon may not even read the view');
select is(has_table_privilege('authenticated', 'public.aktive_share_links', 'SELECT'), true,
  'authenticated may read it, RLS then decides on the rows');

-- Die View ist eine SICHT, kein Schreibweg. Ohne Grant scheitert ein Insert am
-- Tabellenprivileg (42501), noch bevor irgendeine Regel ausgewertet wird.
select throws_ok($$
  insert into public.aktive_share_links (token, trip_id)
  values ('geschmuggelt', '11111111-1111-1111-1111-111111111111')
$$, '42501', null, 'no link can be created through the view');

-- ----------------------------------------------------------------------------
-- F. Ohne Anmeldung gar nichts
-- ----------------------------------------------------------------------------
select pg_temp.as_anon();
select is(has_function_privilege('anon', 'public.recap_is_shared(uuid)', 'EXECUTE'), false,
  'anon may not even call the function');
select is(has_function_privilege('authenticated', 'public.recap_is_shared(uuid)', 'EXECUTE'), true,
  'authenticated may call it');

select * from finish();
rollback;
