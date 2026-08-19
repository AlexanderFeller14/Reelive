// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

// reveal-schedule, the time-triggered counterpart to reveal-trip: called by
// pg_cron via rufe_reveal_zeitplan (migration 20260818100000), never by the
// app. Instead of a JWT, the call carries the cron secret in the header
// x-cron-geheimnis; the complete admission check is testable as a pure
// function in schedule.ts (checkScheduleRequest). This handler only
// translates HTTP: method, configuration, body parsing, dispatch by task.
//
// Task-14 contract: the header x-cron-geheimnis, the body fields
// aufgabe/heute, the task values 'reveal'/'erinnerung', and the env key
// CRON_GEHEIMNIS below are a wire contract with the SQL cron job and stay
// exactly as written until Task 14 moves both sides together, see
// task-13-report.md.
import { send } from '../reveal-trip/push.ts';
import { createErrorReporter } from '../_shared/errorReporter.ts';
import { performAutoReveal, performReminder, checkScheduleRequest } from './schedule.ts';
import { createAdminClient, createScheduleStore } from './scheduleStore.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_GEHEIMNIS = Deno.env.get('CRON_GEHEIMNIS') ?? '';

const SENTRY_DSN = Deno.env.get('SENTRY_DSN') ?? '';
const report = createErrorReporter(SENTRY_DSN, 'reveal-schedule');

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(message: string, status: number): Response {
  return json({ error: message }, status);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return errorResponse('Nur POST erlaubt.', 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('reveal-schedule: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen.');
    await report(new Error('reveal-schedule: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen.'));
    return errorResponse('Server nicht konfiguriert.', 500);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Ungültige Anfrage.', 400);
  }

  const admission = checkScheduleRequest(req.headers.get('x-cron-geheimnis'), CRON_GEHEIMNIS, body);
  if (!admission.ok) {
    if (admission.status === 500) {
      console.error('reveal-schedule: CRON_GEHEIMNIS fehlt.');
      await report(new Error('reveal-schedule: CRON_GEHEIMNIS fehlt.'));
    }
    return errorResponse(admission.error, admission.status);
  }

  const store = createScheduleStore(createAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY));
  const { task, today } = admission.request;
  const result = task === 'reveal'
    ? await performAutoReveal(store, send, today, report)
    : await performReminder(store, send, today, report);
  return json(result.body, result.status);
});
