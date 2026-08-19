// Integration test for scheduleStore.ts, exactly the queries no fake store
// can prove, because it dictates their conditions itself:
//   1. fetchDueTrips: end_date STRICTLY less than today and status='active'
//      in the real select (Spec §2: until 23:59 of the end date the trip is
//      still ongoing).
//   2. fetchReminderTrips: end_date = today AND marker empty.
//   3. markReminder: the CAS condition `is('end_reminder_sent_at', null)`
//      in the real update, second call 0 rows.
//
// To run:
//   cd supabase/functions/reveal-schedule
//   npx deno test --allow-net --allow-run=supabase scheduleStore_integration_test.ts

import { assert, assertEquals } from 'jsr:@std/assert';
import { createAdminClient, createScheduleStore } from './scheduleStore.ts';

const LEA_ID = '11111111-1111-4111-8111-111111111111';

async function supabaseStatusEnv(): Promise<Record<string, string> | null> {
  try {
    const cmd = new Deno.Command('supabase', { args: ['status', '-o', 'env'], stdout: 'piped', stderr: 'null' });
    const { code, stdout } = await cmd.output();
    if (code !== 0) return null;
    const text = new TextDecoder().decode(stdout);
    const env: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
      if (match) env[match[1]] = match[2];
    }
    return env;
  } catch {
    return null;
  }
}

const statusEnv = await supabaseStatusEnv();
const SUPABASE_URL = statusEnv?.API_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = statusEnv?.SERVICE_ROLE_KEY ?? '';

// Check reachability directly via the REST API, this file needs no served
// edge function, only Postgres/PostgREST/Auth.
async function restReachable(): Promise<boolean> {
  if (!SERVICE_ROLE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/trips?select=id&limit=1`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const stackReady = Boolean(statusEnv && SERVICE_ROLE_KEY && (await restReachable()));

if (!stackReady) {
  console.warn(
    'zeitplanStore_integration_test: übersprungen, braucht `supabase start`.',
  );
}

function restHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra,
  };
}

async function expectJson(res: Response, expectedStatus: number): Promise<unknown> {
  const text = await res.text();
  assertEquals(res.status, expectedStatus, text);
  return text.length > 0 ? JSON.parse(text) : null;
}

async function newTrip(endDate: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trips`, {
    method: 'POST',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({
      name: 'Integrationstest zeitplanStore',
      start_date: '2026-01-01',
      end_date: endDate,
      owner_id: LEA_ID,
      status: 'active',
    }),
  });
  const [trip] = (await expectJson(res, 201)) as Array<{ id: string }>;
  return trip.id;
}

async function deleteTrip(tripId: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}`, { method: 'DELETE', headers: restHeaders() }).catch(
    () => null,
  );
}

Deno.test({
  name: 'fetchDueTrips: end_date streng kleiner heute, active only',
  ignore: !stackReady,
  fn: async () => {
    const store = createScheduleStore(createAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY));
    const tripId = await newTrip('2026-01-02');
    try {
      const due = await store.fetchDueTrips('2026-01-03');
      assert(due.data !== null, String(due.error));
      assert(due.data.some((t) => t.id === tripId), 'Reise mit end_date < heute ist fällig');

      // On the end date itself (until 23:59) NOT yet due.
      const notYet = await store.fetchDueTrips('2026-01-02');
      assert(notYet.data !== null, String(notYet.error));
      assertEquals(notYet.data.some((t) => t.id === tripId), false);

      // Revealed does not count as due.
      await store.updateIfActive(tripId);
      const revealed = await store.fetchDueTrips('2026-01-03');
      assert(revealed.data !== null, String(revealed.error));
      assertEquals(revealed.data.some((t) => t.id === tripId), false);
    } finally {
      await deleteTrip(tripId);
    }
  },
});

Deno.test({
  name: 'markReminder: CAS im echten Update, zweiter Aufruf 0 Zeilen',
  ignore: !stackReady,
  fn: async () => {
    const store = createScheduleStore(createAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY));
    const tripId = await newTrip('2026-01-02');
    const tripId2 = await newTrip('2026-01-02');
    try {
      const first = await store.markReminder(tripId);
      assert(first.data !== null, String(first.error));
      const second = await store.markReminder(tripId);
      assertEquals(second.data, null);
      assertEquals(second.error, null);

      // Manually revealed between selection and marker: the second probe
      // trip must no longer get the reminder, `status = 'active'` in the
      // real update condition also applies against an already-revealed
      // trip (Spec §2).
      await store.updateIfActive(tripId2);
      const afterReveal = await store.markReminder(tripId2);
      assertEquals(afterReveal, { data: null, error: null });
    } finally {
      await deleteTrip(tripId);
      await deleteTrip(tripId2);
    }
  },
});

Deno.test({
  name: 'fetchReminderTrips: end_date = heute und Marker leer',
  ignore: !stackReady,
  fn: async () => {
    const store = createScheduleStore(createAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY));
    const tripId = await newTrip('2026-01-02');
    try {
      const due = await store.fetchReminderTrips('2026-01-02');
      assert(due.data !== null, String(due.error));
      assert(due.data.some((t) => t.id === tripId), 'Reise mit end_date = heute braucht die Erinnerung');

      const otherDate = await store.fetchReminderTrips('2026-01-01');
      assert(otherDate.data !== null, String(otherDate.error));
      assertEquals(otherDate.data.some((t) => t.id === tripId), false);

      await store.markReminder(tripId);
      const marked = await store.fetchReminderTrips('2026-01-02');
      assert(marked.data !== null, String(marked.error));
      assertEquals(marked.data.some((t) => t.id === tripId), false);
    } finally {
      await deleteTrip(tripId);
    }
  },
});
