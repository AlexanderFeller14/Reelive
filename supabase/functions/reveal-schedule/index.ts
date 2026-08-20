// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

// reveal-schedule, the time-triggered counterpart to reveal-trip: called by
// pg_cron via call_reveal_schedule (migration 20260820090000), never by the
// app. Instead of a JWT, the call carries the cron secret in the header
// x-cron-secret; the complete admission check is testable as a pure
// function in schedule.ts (checkScheduleRequest). This handler only
// translates HTTP: method, configuration, body parsing, dispatch by task.
//
// Wire contract with the SQL cron job: the header x-cron-secret, the body
// fields task/today, the task values 'reveal'/'reminder'/'trip_start', the
// migrations 20260820090000/20260820120000, and the env key CRON_SECRET
// below move together.
import { send } from '../reveal-trip/push.ts';
import { createErrorReporter } from '../_shared/errorReporter.ts';
import {
  performAutoReveal,
  performReminder,
  performTripStart,
  checkScheduleRequest,
  type ScheduleResult,
} from './schedule.ts';
import { createAdminClient, createScheduleStore } from './scheduleStore.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

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
    console.error('reveal-schedule: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are missing.');
    await report(new Error('reveal-schedule: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are missing.'));
    return errorResponse('Server nicht konfiguriert.', 500);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Ungültige Anfrage.', 400);
  }

  const admission = checkScheduleRequest(req.headers.get('x-cron-secret'), CRON_SECRET, body);
  if (!admission.ok) {
    if (admission.status === 500) {
      console.error('reveal-schedule: CRON_SECRET is missing.');
      await report(new Error('reveal-schedule: CRON_SECRET is missing.'));
    }
    return errorResponse(admission.error, admission.status);
  }

  const store = createScheduleStore(createAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY));
  const { task, today } = admission.request;
  let result: ScheduleResult;
  switch (task) {
    case 'reveal':
      result = await performAutoReveal(store, send, today, report);
      break;
    case 'reminder':
      result = await performReminder(store, send, today, report);
      break;
    case 'trip_start':
      result = await performTripStart(store, send, today, report);
      break;
    default: {
      // A fourth ScheduleTask value fails to compile here instead of
      // silently routing into one of the branches above.
      task satisfies never;
      return errorResponse('Ungültige Anfrage.', 400);
    }
  }
  return json(result.body, result.status);
});
