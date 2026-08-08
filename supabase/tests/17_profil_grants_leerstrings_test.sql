create extension if not exists pgtap with schema extensions;
begin;
select plan(14);

-- ----------------------------------------------------------------------------
-- profiles-Spalten-Grants (Migration 20260808150000)
-- ----------------------------------------------------------------------------
select is(has_column_privilege('authenticated', 'public.profiles', 'created_at', 'INSERT'), false,
  'authenticated darf profiles.created_at nicht setzen');
select is(has_column_privilege('authenticated', 'public.profiles', 'created_at', 'UPDATE'), false,
  'authenticated darf profiles.created_at nicht ändern');
select is(has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE'), false,
  'authenticated darf profiles.id nicht ändern — das wäre ein Identitätswechsel');

-- Was der Client wirklich braucht, bleibt offen: Anlegen mit eigener uid,
-- danach Username, Anzeigename und Avatar pflegen.
select is(has_column_privilege('authenticated', 'public.profiles', 'id', 'INSERT'), true,
  'authenticated darf profiles.id beim Anlegen setzen');
select is(has_column_privilege('authenticated', 'public.profiles', 'username', 'INSERT'), true,
  'authenticated darf profiles.username setzen');
select is(has_column_privilege('authenticated', 'public.profiles', 'display_name', 'INSERT'), true,
  'authenticated darf profiles.display_name setzen');
select is(has_column_privilege('authenticated', 'public.profiles', 'username', 'UPDATE'), true,
  'authenticated darf profiles.username ändern');
select is(has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE'), true,
  'authenticated darf profiles.display_name ändern');
select is(has_column_privilege('authenticated', 'public.profiles', 'avatar_key', 'UPDATE'), true,
  'authenticated darf profiles.avatar_key ändern');

select is(has_table_privilege('anon', 'public.profiles', 'INSERT'), false,
  'anon darf gar keine Profile anlegen');

-- ----------------------------------------------------------------------------
-- Leerstring-Checks. Bewusst ohne Rollenwechsel: postgres umgeht RLS, aber
-- keine Check-Constraints — die Zeilen hier scheitern also nachweislich an der
-- Constraint und nicht an einer Policy.
-- ----------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-0000000000aa',
        'authenticated','authenticated','41791119999',now(),'','','','','','','','','{}','{}',now(),now());
insert into public.profiles (id, username, display_name)
  values ('00000000-0000-4000-8000-0000000000aa', 'leertest', 'Leer Test');
insert into public.trips (id, owner_id, name, start_date, end_date)
  values ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000000aa',
          'Leerstring-Reise', '2026-05-08', '2026-05-10');

select throws_ok($$
  insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz)
  values ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000000aa',
          'photo', 'k/leer', now(), '')
$$, '23514', null, 'posts.captured_tz = '''' wird abgewiesen');

select lives_ok($$
  insert into public.posts (id, trip_id, author_id, type, storage_key, captured_at, captured_tz)
  values ('00000000-0000-4000-8000-0000000000cc', '00000000-0000-4000-8000-0000000000bb',
          '00000000-0000-4000-8000-0000000000aa', 'photo', 'k/gut', now(), 'Europe/Lisbon')
$$, 'eine echte IANA-Zone geht durch');

select throws_ok($$
  insert into public.reactions (post_id, user_id, emoji)
  values ('00000000-0000-4000-8000-0000000000cc', '00000000-0000-4000-8000-0000000000aa', '')
$$, '23514', null, 'reactions.emoji = '''' wird abgewiesen');

select lives_ok($$
  insert into public.reactions (post_id, user_id, emoji)
  values ('00000000-0000-4000-8000-0000000000cc', '00000000-0000-4000-8000-0000000000aa', '🔥')
$$, 'ein echtes Emoji geht durch');

select * from finish();
rollback;
