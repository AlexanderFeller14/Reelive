// Unit tests for the two signed-in actions, with no `supabase start`, no
// `functions serve`, no network, no permission:
//   cd supabase/functions/share-link && npx deno test management_test.ts
//
// Why this file exists: since
// 20260808140000_share_links_nur_edge_function.sql, `authenticated` no
// longer has a write right on share_links. The guarantee "a share link is
// only ever created for a revealed trip and only by its owner" (Spec §4,
// W3, first half) used to have two carriers, the RLS policy and the
// function. Now it is practically carried by the function alone. If its
// only evidence were the integration test with `ignore: !stackReady`, W3
// would go unchecked on any machine without Docker and the run would still
// be green.
//
// Covered:
//   1. evaluateCreate: trip missing / foreign trip / sealed / archived /
//      revealed, order and wording.
//   2. computeExpiry: what passes as valid_days and what does not.
//   3. evaluateRevoke: "does not exist" and "belongs to someone else" are
//      byte-identical.

import { assertEquals, assertFalse } from 'jsr:@std/assert';
import {
  evaluateCreate,
  evaluateRevoke,
  computeExpiry,
  type CreateTrip,
  MAX_VALID_DAYS,
  type TokenOwnership,
  type ManagementVerdict,
  REVOKE_REJECTION,
} from './management.ts';

const LEA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const TRIP_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

function trip(status: CreateTrip['status'], ownerId = LEA): CreateTrip {
  return { id: TRIP_ID, owner_id: ownerId, status, name: 'Lissabon' };
}

// What the caller makes of it: status code and body. What has to be
// compared at this level, what goes back over the wire are bytes.
function asHttpResponse(verdict: ManagementVerdict<unknown>): string {
  if (verdict.allowed) return 'ALLOWED';
  return `${verdict.status} ${JSON.stringify({ error: verdict.message })}`;
}

// ===========================================================================
// create, W3, first half
// ===========================================================================

Deno.test('create: no link gets created for a sealed trip', () => {
  // The core of W3. Without this line, a public link could be created for a
  // still-sealed trip, and the seal is the whole product.
  assertEquals(evaluateCreate(trip('active'), LEA), {
    allowed: false,
    message: 'Diese Reise ist noch versiegelt.',
    status: 409,
  });
});

Deno.test('create: no NEW link gets created for an archived trip', () => {
  // Mirrors 20260808130000: creating stays revealed-only, revoking works
  // for archived too. Existing links on archived trips keep resolving
  // (evaluateToken in resolution.ts), "put away is not locked away".
  assertEquals(evaluateCreate(trip('archived'), LEA), {
    allowed: false,
    message: 'Diese Reise ist archiviert. Für sie entsteht kein neuer Link mehr.',
    status: 409,
  });
});

Deno.test('create: only the owner, not just any member', () => {
  assertEquals(evaluateCreate(trip('revealed'), BEN), {
    allowed: false,
    message: 'Nur wer die Reise angelegt hat, kann den Recap teilen.',
    status: 403,
  });
});

Deno.test('create: the owner check comes BEFORE the status check', () => {
  // Otherwise an outsider would learn from the error text what state a trip
  // they have nothing to do with is in.
  assertEquals(asHttpResponse(evaluateCreate(trip('active', LEA), BEN)), asHttpResponse(evaluateCreate(trip('revealed', LEA), BEN)));
});

Deno.test('create: an unknown trip returns 404, regardless of the requesting person', () => {
  assertEquals(evaluateCreate(null, LEA), {
    allowed: false,
    message: 'Reise nicht gefunden.',
    status: 404,
  });
  assertEquals(evaluateCreate(null, BEN), {
    allowed: false,
    message: 'Reise nicht gefunden.',
    status: 404,
  });
});

// The verdict carries the checked data along: "allowed" here always also
// means "the row exists", and the caller needs it for the message to the
// fellow travellers, with no second check against null.
Deno.test('create: a revealed own trip is allowed, including the checked row', () => {
  const row = trip('revealed');
  assertEquals(evaluateCreate(row, LEA), { allowed: true, data: row });
});

// ===========================================================================
// valid_days
// ===========================================================================

const NOW = new Date('2026-08-08T12:00:00.000Z');

Deno.test('computeExpiry: missing and null mean "no expiry"', () => {
  assertEquals(computeExpiry(undefined, NOW), { ok: true, expiresAt: null });
  assertEquals(computeExpiry(null, NOW), { ok: true, expiresAt: null });
});

Deno.test('computeExpiry: whole days are computed onto a timestamp', () => {
  assertEquals(computeExpiry(7, NOW), { ok: true, expiresAt: '2026-08-15T12:00:00.000Z' });
  assertEquals(computeExpiry(1, NOW), { ok: true, expiresAt: '2026-08-09T12:00:00.000Z' });
  assertEquals(computeExpiry(MAX_VALID_DAYS, NOW).ok, true);
});

Deno.test('computeExpiry: everything else is rejected instead of silently becoming an Invalid Date', () => {
  // The dangerous case is the last one: `new Date(x)` with NaN produces an
  // Invalid Date, whose toISOString() throws, or, worse, an expiry date
  // evaluateToken cannot read. Hence rejected here rather than computed.
  for (const value of [0, -1, 1.5, MAX_VALID_DAYS + 1, '7', true, NaN, Infinity, {}, []]) {
    const result = computeExpiry(value, NOW);
    assertFalse(result.ok, `${JSON.stringify(value)} hätte abgelehnt werden müssen`);
  }
});

// ===========================================================================
// revoke, no oracle
// ===========================================================================

Deno.test('revoke: "does not exist" and "belongs to someone else" are byte-identical', () => {
  const ownership: TokenOwnership = { token: 'abc', trip_id: TRIP_ID, owner_id: LEA, name: 'Lissabon' };

  const notFound = evaluateRevoke(null, BEN);
  const foreign = evaluateRevoke(ownership, BEN);

  const expected = `404 ${JSON.stringify({ error: 'Diesen Link gibt es nicht.' })}`;
  assertEquals(asHttpResponse(notFound), expected);
  assertEquals(asHttpResponse(foreign), expected);
  assertEquals(asHttpResponse(notFound), asHttpResponse(foreign));

  // Were this different, a token's existence could be probed here, with any
  // own account, and the byte-identical rejections from `resolve` would be
  // for nothing.
});

Deno.test('revoke: the rejection cannot be changed by the caller', () => {
  const verdict = evaluateRevoke(null, BEN);
  try {
    (verdict as { message: string }).message = 'Dieser Link gehört dir nicht.';
  } catch {
    // In strict mode the assignment throws, either way is fine as long as
    // the value stays unchanged afterwards.
  }
  assertEquals(asHttpResponse(evaluateRevoke(null, BEN)), asHttpResponse(REVOKE_REJECTION));
});

Deno.test('revoke: your own row is allowed, including the checked row', () => {
  const ownership: TokenOwnership = { token: 'abc', trip_id: TRIP_ID, owner_id: LEA, name: 'Lissabon' };
  assertEquals(evaluateRevoke(ownership, LEA), { allowed: true, data: ownership });
});
