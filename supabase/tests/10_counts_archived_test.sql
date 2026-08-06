create extension if not exists pgtap with schema extensions;
begin;
select plan(6);

insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','cccc0000-0000-4000-8000-000000000001','authenticated','authenticated','41791120001',now(),'','','','','','','','','{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','cccc0000-0000-4000-8000-000000000002','authenticated','authenticated','41791120002',now(),'','','','','','','','','{}','{}',now(),now());

insert into public.profiles (id, username, display_name) values
  ('cccc0000-0000-4000-8000-000000000001','ich_t10','Ich'),
  ('cccc0000-0000-4000-8000-000000000002','fremd_t10','Fremd');

insert into public.trips (id, name, start_date, end_date, status, revealed_at, invite_code, owner_id) values
  ('dddd0000-0000-4000-8000-000000000001','Archiviert','2025-09-06','2025-09-20','archived','2025-09-21','code-arch','cccc0000-0000-4000-8000-000000000001'),
  ('dddd0000-0000-4000-8000-000000000002','Laeuft','2026-08-01','2026-08-14','active',null,'code-act','cccc0000-0000-4000-8000-000000000001');

-- je ein eigener und ein fremder Moment in der archivierten Reise
insert into public.trip_members (trip_id, user_id, role) values
  ('dddd0000-0000-4000-8000-000000000001','cccc0000-0000-4000-8000-000000000002','member');

insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz) values
  ('dddd0000-0000-4000-8000-000000000001','cccc0000-0000-4000-8000-000000000001','photo','a.jpg','2025-09-07 10:00+02','Europe/Rome'),
  ('dddd0000-0000-4000-8000-000000000001','cccc0000-0000-4000-8000-000000000002','photo','b.jpg','2025-09-08 10:00+02','Europe/Rome');

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccc0000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.posts
   where trip_id = 'dddd0000-0000-4000-8000-000000000001'), 2,
  'Mitglied liest die Momente einer archivierten Reise');
select is(
  (select count(*)::int from public.posts
   where trip_id = 'dddd0000-0000-4000-8000-000000000002'), 0,
  'Die laufende Reise bleibt versiegelt');
select is(
  (select count from public.my_post_counts()
   where trip_id = 'dddd0000-0000-4000-8000-000000000001'), 1::bigint,
  'my_post_counts zaehlt nur die eigenen Momente');
select is(
  (select count from public.my_post_counts()
   where trip_id = 'dddd0000-0000-4000-8000-000000000002'), 0::bigint,
  'my_post_counts liefert auch fuer leere Reisen eine Zeile');
select is(
  (select count(*)::int from public.my_post_counts()), 2,
  'my_post_counts liefert nur Reisen der aufrufenden Person');

reset role;
select ok(
  not has_function_privilege('anon','public.my_post_counts()','execute'),
  'anon darf my_post_counts nicht ausfuehren');

select * from finish();
rollback;
