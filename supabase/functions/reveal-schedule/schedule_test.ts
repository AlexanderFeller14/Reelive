// Unit tests for the decision logic of reveal-schedule (schedule.ts), with
// no stack and no network, style like ../reveal-trip/reveal_test.ts.
import { assertEquals } from 'jsr:@std/assert';
import {
  performAutoReveal,
  performReminder,
  checkScheduleRequest,
  type ScheduleStore,
} from './schedule.ts';
import type { SendFn, TripRow } from '../reveal-trip/reveal.ts';
import type { PushMessage } from '../reveal-trip/push.ts';

const OWNER_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const MEMBER_ID = 'bbbbbbbb-2222-4222-8222-222222222222';

type FakeTrip = TripRow & { end_date: string; end_reminder_sent_at: string | null };

type FakeState = {
  trips: FakeTrip[];
  // user_id -> tokens; applies to ALL trips of this state (enough for the
  // tests).
  tokens: Map<string, string[]>;
  members: string[];
};

// brokenUpdates: trip_ids whose CAS update responds with an error, for the
// "an error does not stop the loop" test.
function fakeStore(state: FakeState, brokenUpdates: string[] = []): ScheduleStore {
  const row = ({ id, name, owner_id, status, revealed_at }: FakeTrip): TripRow =>
    ({ id, name, owner_id, status, revealed_at });
  return {
    async fetchDueTrips(today) {
      return {
        data: state.trips.filter((t) => t.status === 'active' && t.end_date < today).map(row),
        error: null,
      };
    },
    async fetchReminderTrips(today) {
      return {
        data: state.trips
          .filter((t) => t.status === 'active' && t.end_date === today && t.end_reminder_sent_at === null)
          .map(row),
        error: null,
      };
    },
    async markReminder(tripId) {
      const trip = state.trips.find((t) => t.id === tripId);
      if (!trip || trip.end_reminder_sent_at !== null) return { data: null, error: null };
      trip.end_reminder_sent_at = new Date().toISOString();
      return { data: { end_reminder_sent_at: trip.end_reminder_sent_at }, error: null };
    },
    async fetchTrip(tripId) {
      const trip = state.trips.find((t) => t.id === tripId);
      return { data: trip ? { ...row(trip) } : null, error: null };
    },
    async updateIfActive(tripId) {
      if (brokenUpdates.includes(tripId)) return { data: null, error: new Error('kaputt') };
      const trip = state.trips.find((t) => t.id === tripId);
      if (!trip || trip.status !== 'active') return { data: null, error: null };
      trip.status = 'revealed';
      trip.revealed_at = new Date().toISOString();
      return { data: { revealed_at: trip.revealed_at }, error: null };
    },
    async fetchRevealedAtFollowUp(tripId) {
      const trip = state.trips.find((t) => t.id === tripId);
      return { data: trip ? { revealed_at: trip.revealed_at } : null, error: null };
    },
    async fetchMembers() {
      return { data: state.members.map((user_id) => ({ user_id })), error: null };
    },
    async fetchTokens(userIds) {
      const rows: { token: string }[] = [];
      for (const userId of userIds) {
        for (const token of state.tokens.get(userId) ?? []) rows.push({ token });
      }
      return { data: rows, error: null };
    },
    async deleteTokens() {
      return { error: null };
    },
  };
}

function trip(id: string, end_date: string, status: TripRow['status'] = 'active'): FakeTrip {
  return {
    id,
    name: `Reise ${id}`,
    owner_id: OWNER_ID,
    status,
    revealed_at: status === 'revealed' ? '2026-08-01T10:00:00.000Z' : null,
    end_date,
    end_reminder_sent_at: null,
  };
}

function collecting(): { sent: PushMessage[]; sendFn: SendFn } {
  const sent: PushMessage[] = [];
  const sendFn: SendFn = async (messages) => {
    sent.push(...messages);
    return [];
  };
  return { sent, sendFn };
}

// --- checkScheduleRequest ----------------------------------------------------

Deno.test('checkScheduleRequest: a correct secret and body produce the request', () => {
  const result = checkScheduleRequest('s3cret', 's3cret', { aufgabe: 'reveal', heute: '2026-08-18' });
  assertEquals(result, { ok: true, request: { task: 'reveal', today: '2026-08-18' } });
});

Deno.test('checkScheduleRequest: a wrong or missing secret produces 401', () => {
  const wrong = checkScheduleRequest('anders', 's3cret', { aufgabe: 'reveal', heute: '2026-08-18' });
  assertEquals(wrong.ok, false);
  if (!wrong.ok) assertEquals(wrong.status, 401);
  const missing = checkScheduleRequest(null, 's3cret', { aufgabe: 'reveal', heute: '2026-08-18' });
  assertEquals(missing.ok, false);
  if (!missing.ok) assertEquals(missing.status, 401);
});

Deno.test('checkScheduleRequest: an unconfigured secret produces 500, never 200', () => {
  const result = checkScheduleRequest('', '', { aufgabe: 'reveal', heute: '2026-08-18' });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 500);
});

Deno.test('checkScheduleRequest: an unknown task or a broken heute produce 400', () => {
  const task = checkScheduleRequest('s3cret', 's3cret', { aufgabe: 'putzen', heute: '2026-08-18' });
  assertEquals(task.ok, false);
  if (!task.ok) assertEquals(task.status, 400);
  const today = checkScheduleRequest('s3cret', 's3cret', { aufgabe: 'reveal', heute: '18.08.2026' });
  assertEquals(today.ok, false);
  if (!today.ok) assertEquals(today.status, 400);
});

// --- performAutoReveal --------------------------------------------------------

Deno.test('performAutoReveal: a due trip is revealed, push to everyone including the owner', async () => {
  const state: FakeState = {
    trips: [trip('t1', '2026-08-17')],
    tokens: new Map([[OWNER_ID, ['tok-owner']], [MEMBER_ID, ['tok-member']]]),
    members: [OWNER_ID, MEMBER_ID],
  };
  const { sent, sendFn } = collecting();

  const result = await performAutoReveal(fakeStore(state), sendFn, '2026-08-18');

  assertEquals(result.status, 200);
  assertEquals(result.body, { ok: true, processed: 1 });
  assertEquals(state.trips[0].status, 'revealed');
  assertEquals(sent.map((n) => n.to).sort(), ['tok-member', 'tok-owner']);
});

Deno.test('performAutoReveal: nothing due means processed 0 and no push', async () => {
  const state: FakeState = {
    // end_date == today is NOT due: until 23:59 of the end date the trip is
    // still ongoing (Spec §2).
    trips: [trip('t1', '2026-08-18')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    members: [OWNER_ID],
  };
  const { sent, sendFn } = collecting();

  const result = await performAutoReveal(fakeStore(state), sendFn, '2026-08-18');

  assertEquals(result.body, { ok: true, processed: 0 });
  assertEquals(state.trips[0].status, 'active');
  assertEquals(sent.length, 0);
});

Deno.test('performAutoReveal: a lost CAS means no second push', async () => {
  const state: FakeState = {
    trips: [trip('t1', '2026-08-17')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    members: [OWNER_ID],
  };
  const store = fakeStore(state);
  // The race: the selection still sees the trip as active, then someone
  // finishes it manually, this run's CAS update hits 0 rows. The manual
  // finish happens here BETWEEN selection and return.
  const realSelection = store.fetchDueTrips.bind(store);
  store.fetchDueTrips = async (today) => {
    const selection = await realSelection(today);
    await store.updateIfActive('t1');
    return selection;
  };
  const { sent, sendFn } = collecting();

  const result = await performAutoReveal(store, sendFn, '2026-08-18');

  assertEquals(result.body, { ok: true, processed: 0 });
  assertEquals(sent.length, 0);
});

Deno.test('performAutoReveal: an error on trip one does not stop trip two', async () => {
  const state: FakeState = {
    trips: [trip('t1', '2026-08-17'), trip('t2', '2026-08-16')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    members: [OWNER_ID],
  };
  const reported: unknown[] = [];
  const { sendFn } = collecting();

  const result = await performAutoReveal(
    fakeStore(state, ['t1']),
    sendFn,
    '2026-08-18',
    async (error) => {
      reported.push(error);
    },
  );

  assertEquals(result.body, { ok: true, processed: 1 });
  assertEquals(state.trips.find((t) => t.id === 't2')?.status, 'revealed');
  assertEquals(reported.length, 1);
});

Deno.test('performAutoReveal: a failing push is reported, the reveal stands', async () => {
  const state: FakeState = {
    trips: [trip('t1', '2026-08-17')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    members: [OWNER_ID],
  };
  const reported: unknown[] = [];
  const throwingSendFn: SendFn = async () => {
    throw new Error('Push kaputt');
  };

  const result = await performAutoReveal(fakeStore(state), throwingSendFn, '2026-08-18', async (error) => {
    reported.push(error);
  });

  assertEquals(result.status, 200);
  assertEquals(result.body, { ok: true, processed: 1 });
  assertEquals(state.trips[0].status, 'revealed');
  assertEquals(reported.length, 1);
});

Deno.test('performAutoReveal: a failing selection produces 500 and one report', async () => {
  const store = fakeStore({ trips: [], tokens: new Map(), members: [] });
  store.fetchDueTrips = async () => ({ data: null, error: new Error('kaputt') });
  const reported: unknown[] = [];
  const { sendFn } = collecting();

  const result = await performAutoReveal(store, sendFn, '2026-08-18', async (error) => {
    reported.push(error);
  });

  assertEquals(result.status, 500);
  assertEquals(reported.length, 1);
});

// --- performReminder -----------------------------------------------------------

Deno.test('performReminder: the owner gets the reminder, members do not', async () => {
  const state: FakeState = {
    trips: [trip('t1', '2026-08-18')],
    tokens: new Map([[OWNER_ID, ['tok-owner']], [MEMBER_ID, ['tok-member']]]),
    members: [OWNER_ID, MEMBER_ID],
  };
  const { sent, sendFn } = collecting();

  const result = await performReminder(fakeStore(state), sendFn, '2026-08-18');

  assertEquals(result.status, 200);
  assertEquals(result.body, { ok: true, processed: 1 });
  assertEquals(sent.map((n) => n.to), ['tok-owner']);
  assertEquals(sent[0].title, 'Heute ist der letzte Tag eurer Reise «Reise t1». Um Mitternacht wird euer Recap aufgedeckt.');
  assertEquals(sent[0].data, { trip_id: 't1' });
});

Deno.test('performReminder: a second run sends nothing more', async () => {
  const state: FakeState = {
    trips: [trip('t1', '2026-08-18')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    members: [OWNER_ID],
  };
  const store = fakeStore(state);
  const first = collecting();
  await performReminder(store, first.sendFn, '2026-08-18');
  const second = collecting();

  const result = await performReminder(store, second.sendFn, '2026-08-18');

  assertEquals(first.sent.length, 1);
  assertEquals(second.sent.length, 0);
  assertEquals(result.body, { ok: true, processed: 0 });
});

Deno.test('performReminder: a lost marker CAS means no push', async () => {
  const state: FakeState = {
    trips: [trip('t1', '2026-08-18')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    members: [OWNER_ID],
  };
  const store = fakeStore(state);
  // A parallel run just set the marker, but this run's selection had
  // already been read: markReminder then returns null.
  const realSelection = store.fetchReminderTrips.bind(store);
  store.fetchReminderTrips = async (today) => {
    const selection = await realSelection(today);
    await store.markReminder('t1');
    return selection;
  };
  const { sent, sendFn } = collecting();

  const result = await performReminder(store, sendFn, '2026-08-18');

  assertEquals(sent.length, 0);
  assertEquals(result.body, { ok: true, processed: 0 });
});

Deno.test('performReminder: an owner with no token still counts as processed', async () => {
  const state: FakeState = {
    trips: [trip('t1', '2026-08-18')],
    tokens: new Map(),
    members: [OWNER_ID],
  };
  const { sent, sendFn } = collecting();

  const result = await performReminder(fakeStore(state), sendFn, '2026-08-18');

  assertEquals(sent.length, 0);
  // The marker is set (the reminder IS handled), only delivery had nothing
  // to reach.
  assertEquals(result.body, { ok: true, processed: 1 });
  assertEquals(state.trips[0].end_reminder_sent_at !== null, true);
});

Deno.test('performReminder: dead tokens are cleaned up within the owner circle', async () => {
  const state: FakeState = {
    trips: [trip('t1', '2026-08-18')],
    tokens: new Map([[OWNER_ID, ['tok-tot']]]),
    members: [OWNER_ID],
  };
  const deleted: Array<{ tokens: string[]; userIds: string[] }> = [];
  const store = fakeStore(state);
  store.deleteTokens = async (tokens, userIds) => {
    deleted.push({ tokens, userIds });
    return { error: null };
  };
  const sendFn: SendFn = async () => ['tok-tot'];

  await performReminder(store, sendFn, '2026-08-18');

  assertEquals(deleted, [{ tokens: ['tok-tot'], userIds: [OWNER_ID] }]);
});

Deno.test('performReminder: a failing selection produces 500 and one report', async () => {
  const store = fakeStore({ trips: [], tokens: new Map(), members: [] });
  store.fetchReminderTrips = async () => ({ data: null, error: new Error('kaputt') });
  const reported: unknown[] = [];
  const { sendFn } = collecting();

  const result = await performReminder(store, sendFn, '2026-08-18', async (error) => {
    reported.push(error);
  });

  assertEquals(result.status, 500);
  assertEquals(reported.length, 1);
});
