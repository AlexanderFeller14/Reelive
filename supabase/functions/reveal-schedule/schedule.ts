// Decision logic of reveal-schedule, the time-triggered counterpart to the
// manual reveal-trip (spec
// docs/superpowers/specs/2026-08-18-auto-reveal-design.md). Structured like
// ../reveal-trip/reveal.ts: pure functions over a narrow store interface,
// I/O sits in scheduleStore.ts, the handler in index.ts only translates
// HTTP.
//
// The calendar day "today" comes in as a parameter (computed in SQL by the
// cron wrapper call_reveal_schedule, Europe/Zurich by the DB clock): the
// logic here deliberately has NO clock of its own, that keeps it
// deterministically testable and the due-date decision on the same clock
// as revealed_at.
//
// No owner check like in performReveal: the calendar triggers the reveal,
// not a person. The function's safeguard is the cron secret
// (checkScheduleRequest), not a JWT.
//
// Wire contract with the SQL cron job (migration 20260820090000,
// call_reveal_schedule): the body fields `task`/`today` (read at the parse
// site below), the task values 'reveal'/'reminder', and the header
// `x-cron-secret` (index.ts) move together, see task-14-report.md.
import {
  sendRevealPush,
  type RevealStore,
  type SendFn,
  type StoreResult,
  type TripRow,
} from '../reveal-trip/reveal.ts';
import type { PushMessage } from '../reveal-trip/push.ts';
import type { ReportFn } from '../_shared/errorReporter.ts';

const NO_REPORTER: ReportFn = async () => {};

export type ScheduleTask = 'reveal' | 'reminder';
export type ScheduleRequest = { task: ScheduleTask; today: string };
export type ScheduleResult = { status: number; body: Record<string, unknown> };

export interface ScheduleStore extends RevealStore {
  // status='active' and end_date < today; the conditions live as a real
  // Postgres query in the adapter (scheduleStore.ts), checked in the
  // integration test, here only what comes back matters: it is due.
  fetchDueTrips(today: string): Promise<StoreResult<TripRow[]>>;
  // status='active', end_date = today, end_reminder_sent_at is null.
  fetchReminderTrips(today: string): Promise<StoreResult<TripRow[]>>;
  // CAS on the marker (… where end_reminder_sent_at is null): null means 0
  // rows, another run was faster, no second push.
  markReminder(tripId: string): Promise<StoreResult<{ end_reminder_sent_at: string }>>;
}

const TODAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

// The handler's complete admission check as a pure function, so
// schedule_test.ts can check it with no Deno.serve. Order: first the server
// configuration (500), then the secret (401), then the body (400); an
// empty configured secret must NEVER pass as "the header matches".
export function checkScheduleRequest(
  secretHeader: string | null,
  configuredSecret: string,
  body: unknown,
): { ok: true; request: ScheduleRequest } | { ok: false; status: number; error: string } {
  if (!configuredSecret) {
    return { ok: false, status: 500, error: 'Server nicht konfiguriert.' };
  }
  if (!secretHeader || secretHeader !== configuredSecret) {
    return { ok: false, status: 401, error: 'Nicht berechtigt.' };
  }
  const b = (body ?? {}) as { task?: unknown; today?: unknown };
  if (b.task !== 'reveal' && b.task !== 'reminder') {
    return { ok: false, status: 400, error: 'Ungültige Anfrage.' };
  }
  if (typeof b.today !== 'string' || !TODAY_FORMAT.test(b.today)) {
    return { ok: false, status: 400, error: 'Ungültige Anfrage.' };
  }
  return { ok: true, request: { task: b.task, today: b.today } };
}

// Reveals every due trip. Per trip: a CAS update like the manual reveal;
// only the winner (1 row) sends the push, to ALL members (triggeringUserId
// null, see sendRevealPush). Errors on one trip are reported and do not
// stop the loop: the remaining trips still get their turn.
export async function performAutoReveal(
  store: ScheduleStore,
  sendFn: SendFn,
  today: string,
  report: ReportFn = NO_REPORTER,
): Promise<ScheduleResult> {
  const { data: due, error } = await store.fetchDueTrips(today);
  if (error || !due) {
    console.error('reveal-schedule: Auswahl fälliger Reisen fehlgeschlagen', error);
    await report(error ?? new Error('reveal-schedule: Auswahl ohne Daten.'), { today });
    return { status: 500, body: { error: 'Auswahl fehlgeschlagen.' } };
  }

  let processed = 0;
  for (const trip of due) {
    const { data: updated, error: updateError } = await store.updateIfActive(trip.id);
    if (updateError) {
      console.error('reveal-schedule: trips-Update fehlgeschlagen', updateError);
      await report(updateError, { trip_id: trip.id, today });
      continue;
    }
    // 0 rows: someone finished manually between selection and update, that
    // branch already sent the push.
    if (!updated) continue;
    processed++;
    // Like the manual reveal: the status change is the truth, the push
    // only the message, a send failure takes nothing back.
    try {
      await sendRevealPush(store, sendFn, trip, null);
    } catch (err) {
      console.error('reveal-schedule: Push-Versand fehlgeschlagen', err);
      await report(err, { trip_id: trip.id, today });
    }
  }
  return { status: 200, body: { ok: true, processed } };
}

// Reminds the owner on the morning of the last day of the trip (Spec §2
// point 2). CAS on the marker makes a double run harmless; only the winner
// sends the push. Should the send fail AFTER the marker is set, the
// reminder is simply missed (no retry): it is a convenience, the reveal the
// next day happens regardless (Spec §6).
export async function performReminder(
  store: ScheduleStore,
  sendFn: SendFn,
  today: string,
  report: ReportFn = NO_REPORTER,
): Promise<ScheduleResult> {
  const { data: trips, error } = await store.fetchReminderTrips(today);
  if (error || !trips) {
    console.error('reveal-schedule: Auswahl der Erinnerungen fehlgeschlagen', error);
    await report(error ?? new Error('reveal-schedule: Erinnerungs-Auswahl ohne Daten.'), { today });
    return { status: 500, body: { error: 'Auswahl fehlgeschlagen.' } };
  }

  let processed = 0;
  for (const trip of trips) {
    const { data: marked, error: markerError } = await store.markReminder(trip.id);
    if (markerError) {
      console.error('reveal-schedule: Erinnerungs-Marker fehlgeschlagen', markerError);
      await report(markerError, { trip_id: trip.id, today });
      continue;
    }
    if (!marked) continue;
    processed++;

    try {
      const { data: tokenRows, error: tokenError } = await store.fetchTokens([trip.owner_id]);
      if (tokenError) {
        console.error('reveal-schedule: push_tokens-Select fehlgeschlagen', tokenError);
        await report(tokenError, { trip_id: trip.id, today });
        continue;
      }
      const tokens = tokenRows ?? [];
      if (tokens.length === 0) continue;

      const text = `Heute ist der letzte Tag eurer Reise «${trip.name}». Um Mitternacht wird euer Recap aufgedeckt.`;
      const messages: PushMessage[] = tokens.map((t) => ({
        to: t.token,
        title: text,
        body: text,
        data: { trip_id: trip.id },
      }));
      const dead = await sendFn(messages);
      if (dead.length > 0) {
        const { error: deleteError } = await store.deleteTokens(dead, [trip.owner_id]);
        if (deleteError) {
          console.error('reveal-schedule: Aufräumen abgemeldeter push_tokens fehlgeschlagen', deleteError);
        }
      }
    } catch (err) {
      console.error('reveal-schedule: Erinnerungs-Versand fehlgeschlagen', err);
      await report(err, { trip_id: trip.id, today });
    }
  }
  return { status: 200, body: { ok: true, processed } };
}
