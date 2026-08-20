create extension if not exists pgtap with schema extensions;
begin;
select plan(6);

-- Trip-start push (Spec 2026-08-20): column, ACL and cron wiring of
-- migration 20260820120000. No new policies, therefore no policy tests.

select has_column('public', 'trips', 'start_push_sent_at', 'trips.start_push_sent_at');

-- The column-wise update grant (20260803090200) must not include the new
-- column: only the service role (edge function) writes it.
select is(
  has_column_privilege('authenticated', 'public.trips', 'start_push_sent_at', 'UPDATE'),
  false,
  'authenticated cannot write start_push_sent_at');

-- Readable like every trips column (table-level select grant).
select is(
  has_column_privilege('authenticated', 'public.trips', 'start_push_sent_at', 'SELECT'),
  true,
  'authenticated can read start_push_sent_at');

select is(
  (select count(*)::int from cron.job where jobname = 'reveal-schedule-trip-start'),
  1,
  'the trip start job is scheduled exactly once');

select is(
  (select schedule from cron.job where jobname = 'reveal-schedule-trip-start'),
  '0 8 * * *',
  'the trip start job runs 08:00 UTC, 10:00 summer / 09:00 winter in Zurich');

select is(
  (select command from cron.job where jobname = 'reveal-schedule-trip-start'),
  $$select public.call_reveal_schedule('trip_start')$$,
  'the trip start job calls the task value the edge function accepts');

select * from finish();
rollback;
