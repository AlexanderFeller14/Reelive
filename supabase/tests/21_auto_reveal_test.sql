create extension if not exists pgtap with schema extensions;
begin;
select plan(6);

-- Auto-Reveal (Spec 2026-08-18): Spalte, ACL und Cron-Verdrahtung der
-- Migration 20260818100000. Keine neuen Policies, darum keine Policy-Tests.

select has_column('public', 'trips', 'end_reminder_sent_at', 'trips.end_reminder_sent_at');

-- Der spaltenweise Update-Grant (20260803090200) darf die neue Spalte nicht
-- aufnehmen: geschrieben wird sie nur von der Service-Role (Edge Function).
select is(
  has_column_privilege('authenticated', 'public.trips', 'end_reminder_sent_at', 'UPDATE'),
  false,
  'authenticated kann end_reminder_sent_at nicht schreiben');

-- Gegenprobe: ohne sie belegte der Test oben auch einen versehentlich ganz
-- fehlenden Update-Grant auf trips.
select is(
  has_column_privilege('authenticated', 'public.trips', 'end_date', 'UPDATE'),
  true,
  'authenticated kann end_date weiterhin schreiben');

-- Lesbar wie alle trips-Spalten (Tabellen-Grant select, Spec §5).
select is(
  has_column_privilege('authenticated', 'public.trips', 'end_reminder_sent_at', 'SELECT'),
  true,
  'authenticated kann end_reminder_sent_at lesen');

select is(
  (select count(*)::int from cron.job
    where jobname in ('reveal-zeitplan-reveal', 'reveal-zeitplan-erinnerung')),
  2,
  'beide Cron-Jobs sind eingeplant');

select is(
  has_function_privilege('authenticated', 'public.rufe_reveal_zeitplan(text)', 'EXECUTE'),
  false,
  'authenticated kann den Cron-Wrapper nicht aufrufen');

select * from finish();
rollback;
