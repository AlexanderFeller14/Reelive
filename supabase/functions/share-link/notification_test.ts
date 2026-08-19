// Unit tests for the share notification, with no stack, no network:
//   cd supabase/functions && deno test --allow-env share-link/
//
// What is really at stake here is the RECIPIENT CIRCLE. If it only lived as
// a `.neq(…)` in a SQL query, no test that runs with no Docker would check
// it, and the bug would be invisible: one notification too few goes
// unnoticed by anyone, one too many sends the owner an echo of their own
// action.
//
// Model: reveal-trip/reveal_test.ts, which checks the same circle for the
// reveal push.

import { assertEquals } from 'jsr:@std/assert@1';
import {
  buildMessages,
  recipientCircle,
  textsFor,
  sendSharePush,
  type NotificationStore,
} from './notification.ts';
import type { PushMessage } from '../reveal-trip/push.ts';

const MIRA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const LEA = '33333333-3333-4333-8333-333333333333';
const TRIP = { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Lissabon' };

// ===========================================================================
// The recipient circle
// ===========================================================================

Deno.test('the triggering person gets no echo of their own action', () => {
  const circle = recipientCircle(
    [{ user_id: MIRA }, { user_id: BEN }, { user_id: LEA }],
    MIRA,
  );
  assertEquals(circle, [BEN, LEA]);
});

Deno.test('a trip where only the triggering person is a member sends nothing at all', () => {
  assertEquals(recipientCircle([{ user_id: MIRA }], MIRA), []);
});

Deno.test('if the triggering person is not even a member, everyone else remains', () => {
  // Cannot occur today (only the owner shares, and she is always a
  // member), still stands here: the function must not silently empty the
  // list should that assumption ever break.
  assertEquals(recipientCircle([{ user_id: BEN }, { user_id: LEA }], MIRA), [BEN, LEA]);
});

// ===========================================================================
// The texts
// ===========================================================================

Deno.test('the notification names who shared, the trip, and what the link shows', () => {
  const { title, body } = textsFor('created', 'Lissabon', 'Mira');
  assertEquals(title, 'Euer Recap ist geteilt');
  assertEquals(
    body,
    'Mira hat euren Recap von «Lissabon» geteilt. Wer den Link hat, sieht alle Momente samt ihren Orten.',
  );
});

// The places are the whole reason this notification exists: since Phase 7
// the link carries them unredacted. Without this sentence the notification
// would be a courtesy instead of information.
Deno.test('the notification does not conceal the places', () => {
  assertEquals(textsFor('created', 'Lissabon', 'Mira').body.includes('Orten'), true);
});

Deno.test('the revocation is the all-clear, not the same notification again', () => {
  const { title, body } = textsFor('revoked', 'Lissabon', 'Mira');
  assertEquals(title, 'Der geteilte Link gilt nicht mehr');
  assertEquals(body, 'Mira hat den Link zu «Lissabon» widerrufen. Der Recap ist wieder nur für euch.');
});

Deno.test('with no name, the sentence stays, instead of showing a gap', () => {
  for (const event of ['created', 'revoked'] as const) {
    const { body } = textsFor(event, 'Lissabon', null);
    assertEquals(body.includes('undefined') || body.includes('null'), false);
    assertEquals(body.includes('«Lissabon»'), true);
  }
});

// DESIGN-LANGUAGE §6: no em dashes in visible text.
Deno.test('no em dash in any of the four texts', () => {
  for (const event of ['created', 'revoked'] as const) {
    for (const who of ['Mira', null]) {
      const { title, body } = textsFor(event, 'Lissabon', who);
      assertEquals(`${title} ${body}`.includes('—'), false);
    }
  }
});

Deno.test('every message carries the same texts and the trip_id for the jump', () => {
  const messages = buildMessages(
    [{ token: 'ExponentPushToken[a]' }, { token: 'ExponentPushToken[b]' }],
    'created',
    TRIP,
    'Mira',
  );
  assertEquals(messages.length, 2);
  assertEquals(messages.map((n) => n.to), ['ExponentPushToken[a]', 'ExponentPushToken[b]']);
  assertEquals(new Set(messages.map((n) => n.body)).size, 1);
  assertEquals(messages[0].data, { trip_id: TRIP.id, event: 'created' });
});

// ===========================================================================
// The send as a whole
// ===========================================================================

type StoreCalls = {
  members: string[];
  tokenQueries: string[][];
  deleted: { tokens: string[]; userIds: string[] }[];
  nameQueries: string[];
};

function fakeStore(
  overrides: Partial<{
    members: { user_id: string }[];
    tokens: { token: string }[];
    name: string | null;
    membersError: unknown;
    tokenError: unknown;
    nameError: unknown;
  }> = {},
): { store: NotificationStore; calls: StoreCalls } {
  const calls: StoreCalls = {
    members: [],
    tokenQueries: [],
    deleted: [],
    nameQueries: [],
  };
  const store: NotificationStore = {
    async fetchMembers(tripId) {
      calls.members.push(tripId);
      return { data: overrides.members ?? [{ user_id: MIRA }, { user_id: BEN }], error: overrides.membersError ?? null };
    },
    async fetchTokens(userIds) {
      calls.tokenQueries.push(userIds);
      return { data: overrides.tokens ?? [{ token: 'ExponentPushToken[b]' }], error: overrides.tokenError ?? null };
    },
    async deleteTokens(tokens, userIds) {
      calls.deleted.push({ tokens, userIds });
      return { error: null };
    },
    async fetchDisplayName(userId) {
      calls.nameQueries.push(userId);
      return { data: overrides.name === undefined ? 'Mira' : overrides.name, error: overrides.nameError ?? null };
    },
  };
  return { store, calls };
}

Deno.test('the send goes to the tokens of the others, with the finished text', async () => {
  const { store, calls } = fakeStore();
  const sent: PushMessage[][] = [];
  await sendSharePush(store, async (n) => { sent.push(n); return []; }, TRIP, MIRA, 'created');

  assertEquals(calls.members, [TRIP.id]);
  assertEquals(calls.tokenQueries, [[BEN]]);
  assertEquals(sent.length, 1);
  assertEquals(sent[0][0].to, 'ExponentPushToken[b]');
  assertEquals(sent[0][0].title, 'Euer Recap ist geteilt');
});

Deno.test('with no other members, tokens are not even queried', async () => {
  const { store, calls } = fakeStore({ members: [{ user_id: MIRA }] });
  let sent = 0;
  await sendSharePush(store, async () => { sent++; return []; }, TRIP, MIRA, 'created');
  assertEquals(calls.tokenQueries, []);
  assertEquals(sent, 0);
});

Deno.test('with no tokens, nothing is sent, and the name is not even fetched', async () => {
  const { store, calls } = fakeStore({ tokens: [] });
  let sent = 0;
  await sendSharePush(store, async () => { sent++; return []; }, TRIP, MIRA, 'created');
  assertEquals(sent, 0);
  assertEquals(calls.nameQueries, []);
});

// A failure fetching the name costs the name, not the notification. The
// information "your recap is shared" is what matters, who shared it is the
// bonus.
Deno.test('if the name query fails, the notification still goes out', async () => {
  const { store } = fakeStore({ nameError: new Error('kaputt'), name: null });
  const sent: PushMessage[][] = [];
  await sendSharePush(store, async (n) => { sent.push(n); return []; }, TRIP, MIRA, 'created');
  assertEquals(sent.length, 1);
  assertEquals(sent[0][0].body.includes('«Lissabon»'), true);
});

Deno.test('a failure reading members aborts nothing, it just sends nothing', async () => {
  const { store } = fakeStore({ membersError: new Error('kaputt') });
  let sent = 0;
  await sendSharePush(store, async () => { sent++; return []; }, TRIP, MIRA, 'created');
  assertEquals(sent, 0);
});

// The reason `deleteTokens` has two parameters: the ticket-to-token mapping
// in push.ts is position-based. A token wrongly read as deregistered must
// never delete outside the notified circle.
Deno.test('deregistered tokens are only ever deleted within the notified circle', async () => {
  const { store, calls } = fakeStore({
    members: [{ user_id: MIRA }, { user_id: BEN }, { user_id: LEA }],
    tokens: [{ token: 'tot' }, { token: 'lebt' }],
  });
  await sendSharePush(store, async () => ['tot'], TRIP, MIRA, 'revoked');
  assertEquals(calls.deleted, [{ tokens: ['tot'], userIds: [BEN, LEA] }]);
});

Deno.test('if Expo reports nothing dead, nothing gets deleted either', async () => {
  const { store, calls } = fakeStore();
  await sendSharePush(store, async () => [], TRIP, MIRA, 'created');
  assertEquals(calls.deleted, []);
});
