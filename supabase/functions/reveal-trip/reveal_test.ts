// Unit tests for the decision and send logic of reveal-trip (reveal.ts),
// extracted out of Deno.serve. Run WITHOUT `supabase start` and WITHOUT a
// network, in response to a final-review finding that this function had
// ZERO automated tests until now (push_test.ts only covers push.ts in
// isolation, not the status change itself).
//
// A fake store holds the state of ONE trip in memory and models the CAS
// condition of the real Postgres update (`.eq('status','active')`) exactly:
// `updateIfActive` sets status/revealed_at only when status is still
// 'active' at the time of the call, and otherwise returns `null` (0 rows
// affected), exactly the semantics `performReveal` relies on. That makes a
// REAL two-call race testable, with no Docker: two `performReveal` calls
// against the same fake store, started with `Promise.all`.
//
// What a fake store CANNOT prove: that the REAL Postgres query in index.ts'
// adapter really carries `.eq('status','active')`, the CAS semantics here
// are deliberately dictated by the test, not derived from production. That
// gap is closed by reveal_integration_test.ts (Docker-gated, real stack,
// real race over real Postgres).

import { assertEquals, assertExists } from 'jsr:@std/assert';
import { performReveal, sendRevealPush, type RevealStore, type SendFn, type TripRow } from './reveal.ts';
import type { PushMessage } from './push.ts';
import type { ErrorContext, ReportFn } from '../_shared/errorReporter.ts';

const OWNER_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const MEMBER_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const MEMBER2_ID = 'cccccccc-3333-4333-8333-333333333333';
const TRIP_ID = 'dddddddd-4444-4444-8444-444444444444';

// --- Fake store --------------------------------------------------------------

type FakeState = {
  trip: TripRow;
  // user_id -> this person's tokens
  tokens: Map<string, string[]>;
};

// Builds a fake store over a shared state object. Several calls to
// `performReveal` against the SAME state simulate real concurrency (a
// race), against ONE state each simulate independent trips.
function fakeStore(state: FakeState, calls: { fetchMembers: number; deleteTokens: Array<{ tokens: string[]; userIds: string[] }> }): RevealStore {
  return {
    async fetchTrip(tripId) {
      if (tripId !== state.trip.id) return { data: null, error: null };
      // A copy: the caller must not be able to mutate the returned object
      // and thereby corrupt the fake state.
      return { data: { ...state.trip }, error: null };
    },
    async updateIfActive(tripId) {
      if (tripId !== state.trip.id) return { data: null, error: null };
      // The CAS condition: only if CURRENTLY 'active', otherwise 0 rows
      // (null).
      if (state.trip.status !== 'active') return { data: null, error: null };
      const revealedAt = new Date().toISOString();
      state.trip = { ...state.trip, status: 'revealed', revealed_at: revealedAt };
      return { data: { revealed_at: revealedAt }, error: null };
    },
    async fetchRevealedAtFollowUp(tripId) {
      if (tripId !== state.trip.id) return { data: null, error: null };
      return { data: { revealed_at: state.trip.revealed_at }, error: null };
    },
    async fetchMembers(tripId) {
      calls.fetchMembers++;
      if (tripId !== state.trip.id) return { data: [], error: null };
      return { data: [...state.tokens.keys()].map((user_id) => ({ user_id })), error: null };
    },
    async fetchTokens(userIds) {
      const rows: { token: string }[] = [];
      for (const userId of userIds) {
        for (const token of state.tokens.get(userId) ?? []) {
          rows.push({ token });
        }
      }
      return { data: rows, error: null };
    },
    async deleteTokens(tokens, userIds) {
      calls.deleteTokens.push({ tokens, userIds });
      for (const userId of userIds) {
        const existing = state.tokens.get(userId);
        if (!existing) continue;
        state.tokens.set(userId, existing.filter((t) => !tokens.includes(t)));
      }
      return { error: null };
    },
  };
}

function newFakeState(status: TripRow['status'] = 'active'): FakeState {
  return {
    trip: {
      id: TRIP_ID,
      name: 'Lissabon',
      owner_id: OWNER_ID,
      status,
      revealed_at: status === 'revealed' ? '2026-08-01T10:00:00.000Z' : null,
    },
    tokens: new Map([
      [MEMBER_ID, ['tok-member']],
      [MEMBER2_ID, ['tok-member2']],
    ]),
  };
}

// sendFn spy: counts calls, collects the addressed tokens, defaults to
// "nobody dead".
function fakeSendFn(dead: string[] = []): { fn: SendFn; calls: PushMessage[][] } {
  const calls: PushMessage[][] = [];
  const fn: SendFn = (messages) => {
    calls.push(messages);
    return Promise.resolve(dead);
  };
  return { fn, calls };
}

// Phase 6 final review, point 2: "an error reporter with no caller is
// worthless", the following tests prove not only that `performReveal`
// accepts a fifth argument, but THAT it is called at exactly the three DB
// error paths (and at no other).
function fakeReporter(): { fn: ReportFn; calls: Array<{ error: unknown; context?: ErrorContext }> } {
  const calls: Array<{ error: unknown; context?: ErrorContext }> = [];
  const fn: ReportFn = (error, context) => {
    calls.push({ error, context });
    return Promise.resolve();
  };
  return { fn, calls };
}

// =============================================================================
// performReveal, the six guarantees named in the final review
// =============================================================================

// --- 1. Owner check: non-owner -> 403 ---------------------------------------
Deno.test('performReveal: a non-owner gets 403 and triggers no status change/push', async () => {
  const state = newFakeState('active');
  const calls = { fetchMembers: 0, deleteTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(state, calls);
  const { fn: sendFn, calls: sendCalls } = fakeSendFn();

  const result = await performReveal(store, sendFn, TRIP_ID, MEMBER_ID);

  assertEquals(result, {
    status: 403,
    body: { error: 'Nur wer die Reise angelegt hat, kann sie abschliessen.' },
  });
  assertEquals(state.trip.status, 'active', 'der Status blieb unverändert');
  assertEquals(sendCalls.length, 0, 'kein Push wurde ausgelöst');
  assertEquals(calls.fetchMembers, 0, 'sendRevealPush wurde gar nicht erst aufgerufen');
});

// Re-review finding: the owner check has to sit BEFORE the status branches,
// not just before the CAS update. An already-revealed or archived trip each
// has its own early return branch (line 184/187), had the owner check been
// moved behind those two, ANY authenticated person who knows a trip_id
// would get 200 instead of 403 for a revealed trip and 409 instead of 403
// for an archived one. The two tests above/below did not cover that: "a
// non-owner gets 403" only checks against status='active', and
// reveal_integration_test.ts too only tests the non-owner there. These two
// cases close exactly the gap finding 2 was originally written for: no
// member may open the trip for everyone, regardless of status.
Deno.test('performReveal: a non-owner gets 403, even when the trip is already revealed', async () => {
  const state = newFakeState('revealed');
  const store = fakeStore(state, { fetchMembers: 0, deleteTokens: [] });
  const { fn: sendFn, calls: sendCalls } = fakeSendFn();

  const result = await performReveal(store, sendFn, TRIP_ID, MEMBER_ID);

  assertEquals(result, {
    status: 403,
    body: { error: 'Nur wer die Reise angelegt hat, kann sie abschliessen.' },
  });
  assertEquals(sendCalls.length, 0);
});

Deno.test('performReveal: a non-owner gets 403, even when the trip is already archived', async () => {
  const state = newFakeState('archived');
  const store = fakeStore(state, { fetchMembers: 0, deleteTokens: [] });
  const { fn: sendFn, calls: sendCalls } = fakeSendFn();

  const result = await performReveal(store, sendFn, TRIP_ID, MEMBER_ID);

  assertEquals(result, {
    status: 403,
    body: { error: 'Nur wer die Reise angelegt hat, kann sie abschliessen.' },
  });
  assertEquals(sendCalls.length, 0);
});

// --- Trip not found -----------------------------------------------------------
Deno.test('performReveal: an unknown trip_id returns 404', async () => {
  const state = newFakeState('active');
  const store = fakeStore(state, { fetchMembers: 0, deleteTokens: [] });
  const { fn: sendFn } = fakeSendFn();

  const result = await performReveal(store, sendFn, 'unbekannte-trip-id', OWNER_ID);

  assertEquals(result, { status: 404, body: { error: 'Reise nicht gefunden.' } });
});

// --- 2. Idempotent: sequential second call ----------------------------------
Deno.test('performReveal: an already-revealed trip returns the same revealed_at with no repeated update/push', async () => {
  const state = newFakeState('revealed');
  const calls = { fetchMembers: 0, deleteTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(state, calls);
  const { fn: sendFn, calls: sendCalls } = fakeSendFn();

  const result = await performReveal(store, sendFn, TRIP_ID, OWNER_ID);

  assertEquals(result, { status: 200, body: { ok: true, revealed_at: state.trip.revealed_at } });
  assertEquals(sendCalls.length, 0, 'ein sequenzieller zweiter Aufruf löst keinen erneuten Push aus');
  assertEquals(calls.fetchMembers, 0);
});

// --- 3. Archive conflict ------------------------------------------------------
Deno.test('performReveal: an archived trip returns 409 and triggers no push', async () => {
  const state = newFakeState('archived');
  const calls = { fetchMembers: 0, deleteTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(state, calls);
  const { fn: sendFn, calls: sendCalls } = fakeSendFn();

  const result = await performReveal(store, sendFn, TRIP_ID, OWNER_ID);

  assertEquals(result, { status: 409, body: { error: 'Diese Reise ist schon archiviert.' } });
  assertEquals(sendCalls.length, 0);
  assertEquals(calls.fetchMembers, 0);
});

// --- Winner branch: active trip, owner ---------------------------------------
Deno.test('performReveal: an active trip is revealed and the push is sent exactly once to the right recipients', async () => {
  const state = newFakeState('active');
  const calls = { fetchMembers: 0, deleteTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(state, calls);
  const { fn: sendFn, calls: sendCalls } = fakeSendFn();

  const result = await performReveal(store, sendFn, TRIP_ID, OWNER_ID);

  assertEquals(result.status, 200);
  assertEquals((result.body as { ok: boolean }).ok, true);
  assertExists((result.body as { revealed_at: string }).revealed_at);
  assertEquals(state.trip.status, 'revealed');
  assertEquals(sendCalls.length, 1, 'genau ein Push-Versand');
  assertEquals(
    sendCalls[0].map((n) => n.to).sort(),
    ['tok-member', 'tok-member2'],
    'beide Mitglieder (nicht der Owner selbst, der hat keinen Token hier) bekommen die Nachricht',
  );
});

// --- 4. Double send: real two-call race --------------------------------------
// The actual regression case from f26437a: two calls BOTH see
// status==='active', before either overtakes the other. Started with
// `Promise.all`, so both `fetchTrip` calls finish BEFORE the first
// `updateIfActive`, real concurrency, not a sequential flow.
Deno.test('performReveal: two concurrent calls return the same revealed_at and trigger the push only ONCE', async () => {
  const state = newFakeState('active');
  const calls = { fetchMembers: 0, deleteTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(state, calls);
  const { fn: sendFn, calls: sendCalls } = fakeSendFn();

  const [resultA, resultB] = await Promise.all([
    performReveal(store, sendFn, TRIP_ID, OWNER_ID),
    performReveal(store, sendFn, TRIP_ID, OWNER_ID),
  ]);

  assertEquals(resultA.status, 200);
  assertEquals(resultB.status, 200);
  assertEquals(
    (resultA.body as { revealed_at: string }).revealed_at,
    (resultB.body as { revealed_at: string }).revealed_at,
    'beide Antworten tragen denselben Zeitstempel, nur EIN Update hat wirklich geschrieben',
  );
  assertEquals(sendCalls.length, 1, 'der Push wurde nur vom Gewinner-Zweig ausgelöst, nicht vom Verlierer');
});

// --- A failing push -> still 200 ----------------------------------------------
Deno.test('performReveal: a throwing push send leaves the status change standing and the response stays 200', async () => {
  const state = newFakeState('active');
  const store = fakeStore(state, { fetchMembers: 0, deleteTokens: [] });
  const throwingSendFn: SendFn = () => {
    throw new Error('Expo nicht erreichbar');
  };

  const result = await performReveal(store, throwingSendFn, TRIP_ID, OWNER_ID);

  assertEquals(result.status, 200);
  assertEquals((result.body as { ok: boolean }).ok, true);
  assertExists((result.body as { revealed_at: string }).revealed_at);
  assertEquals(state.trip.status, 'revealed', 'der Statuswechsel bleibt die Wahrheit, unabhängig vom Push-Ausgang');
});

Deno.test('performReveal: a rejecting promise from the push send also leaves the status change standing', async () => {
  const state = newFakeState('active');
  const store = fakeStore(state, { fetchMembers: 0, deleteTokens: [] });
  const rejectingSendFn: SendFn = () => Promise.reject(new Error('Netzwerk weg'));

  const result = await performReveal(store, rejectingSendFn, TRIP_ID, OWNER_ID);

  assertEquals(result.status, 200);
  assertEquals(state.trip.status, 'revealed');
});

// --- Error paths: select/update/follow-up fail -------------------------------
Deno.test('performReveal: an error loading the trip row returns 500', async () => {
  const store: RevealStore = {
    fetchTrip: () => Promise.resolve({ data: null, error: new Error('DB weg') }),
    updateIfActive: () => Promise.resolve({ data: null, error: null }),
    fetchRevealedAtFollowUp: () => Promise.resolve({ data: null, error: null }),
    fetchMembers: () => Promise.resolve({ data: [], error: null }),
    fetchTokens: () => Promise.resolve({ data: [], error: null }),
    deleteTokens: () => Promise.resolve({ error: null }),
  };
  const { fn: sendFn } = fakeSendFn();
  const { fn: report, calls: reportCalls } = fakeReporter();

  const result = await performReveal(store, sendFn, TRIP_ID, OWNER_ID, report);
  assertEquals(result, { status: 500, body: { error: 'Reise konnte nicht geladen werden.' } });
  assertEquals(reportCalls.length, 1);
  assertEquals((reportCalls[0].error as Error).message, 'DB weg');
  assertEquals(reportCalls[0].context, { trip_id: TRIP_ID });
});

Deno.test('performReveal: an error in the CAS update returns 500', async () => {
  const state = newFakeState('active');
  const store: RevealStore = {
    ...fakeStore(state, { fetchMembers: 0, deleteTokens: [] }),
    updateIfActive: () => Promise.resolve({ data: null, error: new Error('DB weg') }),
  };
  const { fn: sendFn } = fakeSendFn();
  const { fn: report, calls: reportCalls } = fakeReporter();

  const result = await performReveal(store, sendFn, TRIP_ID, OWNER_ID, report);
  assertEquals(result, { status: 500, body: { error: 'Reise konnte nicht abgeschlossen werden.' } });
  assertEquals(reportCalls.length, 1);
  assertEquals(reportCalls[0].context, { trip_id: TRIP_ID, user_id: OWNER_ID });
});

Deno.test('performReveal: an error in the follow-up read of the loser branch returns 500', async () => {
  const state = newFakeState('active');
  // status is already 'revealed', but NOT set through the fake store,
  // simulates exactly "another call won": updateIfActive returns null (0
  // rows), the follow-up read fails.
  state.trip.status = 'revealed';
  const store: RevealStore = {
    ...fakeStore(state, { fetchMembers: 0, deleteTokens: [] }),
    fetchTrip: () => Promise.resolve({ data: { ...state.trip, status: 'active' }, error: null }),
    updateIfActive: () => Promise.resolve({ data: null, error: null }),
    fetchRevealedAtFollowUp: () => Promise.resolve({ data: null, error: new Error('DB weg') }),
  };
  const { fn: sendFn } = fakeSendFn();
  const { fn: report, calls: reportCalls } = fakeReporter();

  const result = await performReveal(store, sendFn, TRIP_ID, OWNER_ID, report);
  assertEquals(result, { status: 500, body: { error: 'Reise konnte nicht abgeschlossen werden.' } });
  assertEquals(reportCalls.length, 1);
  assertEquals(reportCalls[0].context, { trip_id: TRIP_ID });
});

Deno.test('performReveal: with no reporter passed in, everything stays as before (the default is a no-op)', async () => {
  const store: RevealStore = {
    fetchTrip: () => Promise.resolve({ data: null, error: new Error('DB weg') }),
    updateIfActive: () => Promise.resolve({ data: null, error: null }),
    fetchRevealedAtFollowUp: () => Promise.resolve({ data: null, error: null }),
    fetchMembers: () => Promise.resolve({ data: [], error: null }),
    fetchTokens: () => Promise.resolve({ data: [], error: null }),
    deleteTokens: () => Promise.resolve({ error: null }),
  };
  const { fn: sendFn } = fakeSendFn();
  // No fifth argument, has to keep compiling and working.
  const result = await performReveal(store, sendFn, TRIP_ID, OWNER_ID);
  assertEquals(result, { status: 500, body: { error: 'Reise konnte nicht geladen werden.' } });
});

Deno.test('performReveal: a successful reveal does NOT call the reporter', async () => {
  const state = newFakeState('active');
  const store = fakeStore(state, { fetchMembers: 0, deleteTokens: [] });
  const { fn: sendFn } = fakeSendFn();
  const { fn: report, calls: reportCalls } = fakeReporter();

  const result = await performReveal(store, sendFn, TRIP_ID, OWNER_ID, report);
  assertEquals(result.status, 200);
  assertEquals(reportCalls.length, 0);
});

Deno.test('performReveal: a failing push send does NOT call the reporter (a deliberately tolerated outcome)', async () => {
  const state = newFakeState('active');
  const store = fakeStore(state, { fetchMembers: 0, deleteTokens: [] });
  const throwingSendFn: SendFn = () => {
    throw new Error('Netzwerk weg');
  };
  const { fn: report, calls: reportCalls } = fakeReporter();

  const result = await performReveal(store, throwingSendFn, TRIP_ID, OWNER_ID, report);
  assertEquals(result.status, 200);
  assertEquals(reportCalls.length, 0);
});

// =============================================================================
// sendRevealPush, 5. exclusion of the triggering person, 6. scoping of the
// token deletion
// =============================================================================

const TRIP: TripRow = {
  id: TRIP_ID,
  name: 'Lissabon',
  owner_id: OWNER_ID,
  status: 'revealed',
  revealed_at: '2026-08-01T10:00:00.000Z',
};

// --- 5. `.neq('user_id', triggeringUserId)`, the owner does not get her own
// reveal pushed to her ------------------------------------------------------
Deno.test('sendRevealPush: the triggering person is excluded from the recipients, even with her own token', async () => {
  const state = newFakeState('revealed');
  state.tokens.set(OWNER_ID, ['tok-owner']);
  const calls = { fetchMembers: 0, deleteTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(state, calls);
  const { fn: sendFn, calls: sendCalls } = fakeSendFn();

  await sendRevealPush(store, sendFn, TRIP, OWNER_ID);

  assertEquals(sendCalls.length, 1);
  const addressedTokens = sendCalls[0].map((n) => n.to);
  assertEquals(addressedTokens.includes('tok-owner'), false, 'der Token der auslösenden Person fehlt');
  assertEquals(addressedTokens.sort(), ['tok-member', 'tok-member2']);
});

Deno.test('sendRevealPush: if no recipients remain after excluding the triggering person, nothing is sent at all', async () => {
  const state: FakeState = {
    trip: { ...TRIP },
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
  };
  const store = fakeStore(state, { fetchMembers: 0, deleteTokens: [] });
  const { fn: sendFn, calls: sendCalls } = fakeSendFn();

  await sendRevealPush(store, sendFn, TRIP, OWNER_ID);

  assertEquals(sendCalls.length, 0, 'kein Empfänger übrig, also kein Aufruf an Expo');
});

// --- 6. `.in('user_id', recipientIds)` when deleting tokens, the
// orchestration passes the recipient restriction through to the store -----
Deno.test('sendRevealPush: the token deletion is restricted to exactly the notified recipients', async () => {
  const state = newFakeState('revealed');
  const calls = { fetchMembers: 0, deleteTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(state, calls);
  const { fn: sendFn } = fakeSendFn(['tok-member']); // Expo reports MEMBER_ID as deregistered

  await sendRevealPush(store, sendFn, TRIP, OWNER_ID);

  assertEquals(calls.deleteTokens.length, 1);
  assertEquals(calls.deleteTokens[0], {
    tokens: ['tok-member'],
    userIds: [MEMBER_ID, MEMBER2_ID],
  });
});

Deno.test('sendRevealPush: if Expo reports nobody as deregistered, nothing gets deleted at all', async () => {
  const state = newFakeState('revealed');
  const calls = { fetchMembers: 0, deleteTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(state, calls);
  const { fn: sendFn } = fakeSendFn([]);

  await sendRevealPush(store, sendFn, TRIP, OWNER_ID);

  assertEquals(calls.deleteTokens.length, 0);
});

Deno.test('sendRevealPush: an error loading the members aborts with no push', async () => {
  const store: RevealStore = {
    fetchTrip: () => Promise.resolve({ data: null, error: null }),
    updateIfActive: () => Promise.resolve({ data: null, error: null }),
    fetchRevealedAtFollowUp: () => Promise.resolve({ data: null, error: null }),
    fetchMembers: () => Promise.resolve({ data: null, error: new Error('DB weg') }),
    fetchTokens: () => Promise.resolve({ data: [], error: null }),
    deleteTokens: () => Promise.resolve({ error: null }),
  };
  const { fn: sendFn, calls: sendCalls } = fakeSendFn();

  await sendRevealPush(store, sendFn, TRIP, OWNER_ID);

  assertEquals(sendCalls.length, 0);
});

Deno.test('sendRevealPush: no push tokens among the recipients -> no send call', async () => {
  const state: FakeState = {
    trip: { ...TRIP },
    tokens: new Map([[MEMBER_ID, []]]), // member exists, but has no token
  };
  const store = fakeStore(state, { fetchMembers: 0, deleteTokens: [] });
  const { fn: sendFn, calls: sendCalls } = fakeSendFn();

  await sendRevealPush(store, sendFn, TRIP, OWNER_ID);

  assertEquals(sendCalls.length, 0);
});

// Auto-reveal (Spec 2026-08-18): the calendar triggers it, no person. With
// triggeringUserId null, NOBODY may be filtered out of the recipients, not
// even the owner.
Deno.test('sendRevealPush: triggeringUserId null notifies every member', async () => {
  const state = newFakeState('active');
  state.tokens.set(OWNER_ID, ['tok-owner']);
  const calls = { fetchMembers: 0, deleteTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(state, calls);
  const sent: PushMessage[] = [];
  const fakeSend: SendFn = async (messages) => {
    sent.push(...messages);
    return [];
  };

  await sendRevealPush(store, fakeSend, state.trip, null);

  const recipients = sent.map((n) => n.to).sort();
  const allTokens = [...state.tokens.values()].flat().sort();
  assertEquals(recipients, allTokens);
});
