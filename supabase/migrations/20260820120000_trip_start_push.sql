-- ============================================================================
-- Trip-start push (Spec docs/superpowers/specs/2026-08-20-reisebeginn-push-design.md):
-- every member gets a push on the morning of the first trip day. Two pieces:
--   1. trips.start_push_sent_at: marker that the push went out (CAS on
--      «is null» in the edge function, a double cron run sends nothing twice).
--   2. A third pg_cron job at a fixed UTC time (pg_cron knows no timezones):
--      08:00 UTC is 10:00 Zurich in summer, 09:00 in winter.
-- call_reveal_schedule itself stays unchanged: it passes the task through and
-- computes today in Europe/Zurich (migration 20260820090000).
-- Wire contract with the edge function reveal-schedule: the task value
-- 'trip_start' below and the task values in schedule.ts/index.ts move
-- together.
-- ============================================================================

alter table public.trips add column start_push_sent_at timestamptz;

comment on column public.trips.start_push_sent_at is
  'When the push «Heute beginnt eure Reise» went out to all members; written only by the edge function reveal-schedule (service role, CAS on is null). The column-wise update grant for authenticated (20260803090200) deliberately does not include this column.';

-- Idempotent like in 20260820090000: cron.unschedule throws hard when the
-- job does not exist (rerun after a failure, migration repair), that must
-- not abort this migration.
do $$ begin
  perform cron.unschedule('reveal-schedule-trip-start');
exception when others then null; end $$;

select cron.schedule('reveal-schedule-trip-start', '0 8 * * *',
  $$select public.call_reveal_schedule('trip_start')$$);
