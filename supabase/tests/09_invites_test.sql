create extension if not exists pgtap with schema extensions;
begin;
select plan(15);

-- Testdaten: zwei Profile, drei Reisen (active, revealed, archived)
insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','aaaa0000-0000-4000-8000-000000000001','authenticated','authenticated','41791110001',now(),'','','','','','','','','{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','aaaa0000-0000-4000-8000-000000000002','authenticated','authenticated','41791110002',now(),'','','','','','','','','{}','{}',now(),now());

insert into public.profiles (id, username, display_name) values
  ('aaaa0000-0000-4000-8000-000000000001','owner_t9','Owner'),
  ('aaaa0000-0000-4000-8000-000000000002','gast_t9','Gast');

insert into public.trips (id, name, start_date, end_date, status, revealed_at, invite_code, owner_id) values
  ('bbbb0000-0000-4000-8000-000000000001','Aktive Reise','2026-08-01','2026-08-14','active',   null,        'code-active',   'aaaa0000-0000-4000-8000-000000000001'),
  ('bbbb0000-0000-4000-8000-000000000002','Fertige Reise','2026-05-08','2026-05-12','revealed','2026-05-13','code-revealed', 'aaaa0000-0000-4000-8000-000000000001'),
  ('bbbb0000-0000-4000-8000-000000000003','Dritte aktive Reise','2026-09-01','2026-09-10','active', null,      'code-active-2', 'aaaa0000-0000-4000-8000-000000000001');

-- Race-Verlierer-Szenario für redeem_invite: die Mitgliedschaft besteht schon,
-- BEVOR redeem_invite überhaupt aufgerufen wird (so wie beim Verlierer eines
-- echten Doppeltipp-Rennens, dessen Gegenstück den Insert bereits committet
-- hat). Echte Nebenläufigkeit lässt sich in pgTAP nicht herstellen, Insert
-- direkt als Superuser, weil trip_members bewusst keine Insert-Policy/-Grant
-- für authenticated hat.
insert into public.trip_members (trip_id, user_id, role) values
  ('bbbb0000-0000-4000-8000-000000000003','aaaa0000-0000-4000-8000-000000000002','member');

-- peek_invite
select is(
  (select count(*)::int from public.peek_invite('code-active')), 1,
  'peek_invite liefert genau eine Zeile für einen gültigen Code');
select is(
  (select name from public.peek_invite('code-active')), 'Aktive Reise',
  'peek_invite liefert den Reisenamen');
select is(
  (select owner_display_name from public.peek_invite('code-active')), 'Owner',
  'peek_invite nennt, wer einlaedt');
select is(
  (select member_count from public.peek_invite('code-active')), 1::bigint,
  'peek_invite zaehlt den Owner als Mitglied');
select is(
  (select count(*)::int from public.peek_invite('gibt-es-nicht')), 0,
  'peek_invite liefert bei unbekanntem Code null Zeilen');
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'peek_invite'
     and column_name = 'invite_code'), 0,
  'peek_invite gibt den invite_code nicht zurueck');

-- redeem_invite als Gast
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaa0000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select status from public.redeem_invite('gibt-es-nicht')), 'not_found',
  'redeem_invite meldet unbekannten Code');
select is(
  (select status from public.redeem_invite('code-revealed')), 'not_active',
  'redeem_invite verweigert den Beitritt zu einer aufgedeckten Reise');
select is(
  (select status from public.redeem_invite('code-active')), 'joined',
  'redeem_invite laesst in eine laufende Reise beitreten');
select is(
  (select status from public.redeem_invite('code-active')), 'already_member',
  'redeem_invite meldet erneuten Beitritt als bereits Mitglied');
select is(
  (select count(*)::int from public.trip_members
   where trip_id = 'bbbb0000-0000-4000-8000-000000000001'
     and user_id = 'aaaa0000-0000-4000-8000-000000000002'), 1,
  'Beitritt legt genau eine Mitgliedschaft an');

-- Race-Verlierer: die Mitgliedschaft (siehe Insert oben) besteht bereits, der
-- Aufruf darf trotzdem nie mit unique_violation durchschlagen, sondern muss
-- denselben vertraglich zugesagten Status liefern wie ein regulärer Re-Beitritt.
select is(
  (select status from public.redeem_invite('code-active-2')), 'already_member',
  'redeem_invite liefert already_member statt Exception, wenn die Mitgliedschaft schon vor dem Aufruf bestand');
select is(
  (select count(*)::int from public.trip_members
   where trip_id = 'bbbb0000-0000-4000-8000-000000000003'
     and user_id = 'aaaa0000-0000-4000-8000-000000000002'), 1,
  'on conflict do nothing legt bei bereits bestehender Mitgliedschaft keine zweite Zeile an');

reset role;
select ok(
  not has_function_privilege('anon','public.redeem_invite(text)','execute'),
  'anon darf redeem_invite nicht ausfuehren');
select ok(
  has_function_privilege('anon','public.peek_invite(text)','execute'),
  'anon darf peek_invite ausfuehren');

select * from finish();
rollback;
