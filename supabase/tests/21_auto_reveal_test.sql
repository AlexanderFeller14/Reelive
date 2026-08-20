create extension if not exists pgtap with schema extensions;
begin;
select plan(8);

-- Auto-Reveal (Spec 2026-08-18): Spalte, ACL und Cron-Verdrahtung der
-- Migration 20260818100000. Keine neuen Policies, darum keine Policy-Tests.

select has_column('public', 'trips', 'end_reminder_sent_at', 'trips.end_reminder_sent_at');

-- Der spaltenweise Update-Grant (20260803090200) darf die neue Spalte nicht
-- aufnehmen: geschrieben wird sie nur von der Service-Role (Edge Function).
select is(
  has_column_privilege('authenticated', 'public.trips', 'end_reminder_sent_at', 'UPDATE'),
  false,
  'authenticated cannot write end_reminder_sent_at');

-- Gegenprobe: ohne sie belegte der Test oben auch einen versehentlich ganz
-- fehlenden Update-Grant auf trips.
select is(
  has_column_privilege('authenticated', 'public.trips', 'end_date', 'UPDATE'),
  true,
  'authenticated can still write end_date');

-- Lesbar wie alle trips-Spalten (Tabellen-Grant select, Spec §5).
select is(
  has_column_privilege('authenticated', 'public.trips', 'end_reminder_sent_at', 'SELECT'),
  true,
  'authenticated can read end_reminder_sent_at');

select is(
  (select count(*)::int from cron.job
    where jobname in ('reveal-schedule-reveal', 'reveal-schedule-reminder')),
  2,
  'both cron jobs are scheduled');

select is(
  (select schedule from cron.job where jobname = 'reveal-schedule-reveal'),
  '10 23 * * *',
  'the reveal job runs 23:10 UTC, year-round after Zurich midnight');

select is(
  (select schedule from cron.job where jobname = 'reveal-schedule-reminder'),
  '30 7 * * *',
  'the reminder job runs 07:30 UTC, year-round in the Zurich morning');

select is(
  has_function_privilege('authenticated', 'public.call_reveal_schedule(text)', 'EXECUTE'),
  false,
  'authenticated cannot call the cron wrapper');

select * from finish();
rollback;
