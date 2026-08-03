create extension if not exists pgtap with schema extensions;
begin;
select plan(10);

select has_table('public', 'posts', 'posts existiert');
select has_column('public', 'posts', 'captured_at', 'posts.captured_at');
select has_column('public', 'posts', 'captured_tz', 'posts.captured_tz');
select has_table('public', 'reactions', 'reactions existiert');
select has_table('public', 'comments', 'comments existiert');
select has_table('public', 'share_links', 'share_links existiert');
select has_table('public', 'reports', 'reports existiert');

-- Vorbereitung: Nutzer + Trip als Superuser
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'anna@test.local');
insert into public.profiles (id, username, display_name)
  values ('00000000-0000-0000-0000-00000000000a', 'anna', 'Anna');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('11111111-1111-1111-1111-111111111111', 'Lissabon',
          '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-00000000000a');

select throws_ok(
  $$insert into public.posts (trip_id, author_id, type, storage_key, duration_s, captured_at, captured_tz)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
            'video', 'k', 31, now(), 'Europe/Zurich')$$,
  '23514', null, 'Videos länger als 30s werden abgelehnt');

select throws_ok(
  $$insert into public.posts (trip_id, author_id, type, storage_key, caption, captured_at, captured_tz)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
            'photo', 'k', repeat('x', 121), now(), 'Europe/Zurich')$$,
  '23514', null, 'Captions über 120 Zeichen werden abgelehnt');

select throws_ok(
  $$insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
            'kino', 'k', now(), 'Europe/Zurich')$$,
  '22P02', null, 'Nur photo/video als Typ');

select * from finish();
rollback;
