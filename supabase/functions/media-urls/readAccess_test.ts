// Unit tests for the check chain of the `read` action, extracted from
// index.ts. Run WITHOUT `supabase start` and WITHOUT a second terminal
// running `functions serve`, unlike read_integration_test.ts (which needs real HTTP
// calls against the running stack and therefore carries `ignore:
// !stackReady`). That was exactly the core finding of the final review: the
// only safeguard for Spec promise V1 ("before the reveal nobody reads a
// medium, not even the moment's own author") was available exclusively
// through a test that gets silently skipped on a machine without Docker,
// "ignored", not "failed", indistinguishable from passing in any summary.
// This file always runs, on any machine, in any CI with no Docker
// requirement, `deno test` with no --allow-net, --allow-run, or any other
// permission.
//
// Covers exactly the same six cases as the "Covered" header comment of
// read_integration_test.ts (cases 1, 2, 3 there, plus the archive variant of `read`
// itself; cases 4/5 there concern signing/PUT/paging, which stays I/O and
// therefore outside a pure function).

import { assertEquals } from 'jsr:@std/assert';
import { evaluateReadAccess, type ReadCheckTrip } from './readAccess.ts';

const MEMBER = { user_id: '11111111-1111-4111-8111-111111111111' };

// --- Case 1: no URL before the reveal, not even for the author -----------
Deno.test('read: an active (sealed) trip rejects, even when the requesting person is a member', () => {
  const trip: ReadCheckTrip = { status: 'active' };
  assertEquals(evaluateReadAccess(trip, MEMBER), {
    allowed: false,
    message: 'Diese Reise ist noch versiegelt.',
    status: 403,
  });
});

Deno.test('read: an active trip rejects a non-member with the same message', () => {
  const trip: ReadCheckTrip = { status: 'active' };
  assertEquals(evaluateReadAccess(trip, null), {
    allowed: false,
    message: 'Diese Reise ist noch versiegelt.',
    status: 403,
  });
});

// --- Case 2: unknown trip_id ------------------------------------------------
Deno.test('read: no trip row (trip_id does not exist) returns 404, regardless of membership', () => {
  assertEquals(evaluateReadAccess(null, MEMBER), {
    allowed: false,
    message: 'Reise nicht gefunden.',
    status: 404,
  });
  assertEquals(evaluateReadAccess(null, null), {
    allowed: false,
    message: 'Reise nicht gefunden.',
    status: 404,
  });
});

// --- Case 3: non-member after the reveal -----------------------------------
Deno.test('read: a revealed trip rejects a non-member', () => {
  const trip: ReadCheckTrip = { status: 'revealed' };
  assertEquals(evaluateReadAccess(trip, null), {
    allowed: false,
    message: 'Kein Zugriff auf diese Reise.',
    status: 403,
  });
});

// --- Member after the reveal: allowed --------------------------------------
Deno.test('read: a revealed trip allows a member access', () => {
  const trip: ReadCheckTrip = { status: 'revealed' };
  assertEquals(evaluateReadAccess(trip, MEMBER), { allowed: true });
});

// --- Archive stays readable ("put away is not locked away") ----------------
Deno.test('read: an archived trip still allows a member access', () => {
  const trip: ReadCheckTrip = { status: 'archived' };
  assertEquals(evaluateReadAccess(trip, MEMBER), { allowed: true });
});

Deno.test('read: an archived trip still rejects a non-member', () => {
  const trip: ReadCheckTrip = { status: 'archived' };
  assertEquals(evaluateReadAccess(trip, null), {
    allowed: false,
    message: 'Kein Zugriff auf diese Reise.',
    status: 403,
  });
});

// --- membership is "unknown", not just "{user_id} | null" ------------------
// index.ts also folds a membershipError to null (see the comment in
// readAccess.ts), but the function itself treats every falsy value the
// same, in case the caller's mapping ever changes. undefined is an edge case
// that never occurs in index.ts (the variable is always initialized to
// `null`), but the function must not crash on it.
Deno.test('read: a falsy but non-null membership value is treated as "no access"', () => {
  const trip: ReadCheckTrip = { status: 'revealed' };
  assertEquals(evaluateReadAccess(trip, undefined), {
    allowed: false,
    message: 'Kein Zugriff auf diese Reise.',
    status: 403,
  });
});
