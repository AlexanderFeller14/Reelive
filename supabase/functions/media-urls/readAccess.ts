// The check chain for the `read` action, extracted out of Deno.serve in
// response to a final-review finding: its only evidence (read_integration_test.ts) is
// silently skipped without a running stack (`ignore: !stackReady`), instead
// of failing. Whoever removed or weakened the check would get a fully green
// suite on a machine without Docker, nothing here would show that Spec
// promise V1 in particular ("before the reveal nobody reads a medium, not
// even the moment's own author") went unchecked.
//
// This file is pure logic with no I/O, no Deno.serve, no network, no
// Supabase client, following the same pattern as keys.ts in this folder,
// push.ts in ../reveal-trip, and queueLogic.ts in mobile/src/features/moments:
// the security-relevant decision stands as a pure function, independently
// testable, with no `supabase start` and no second terminal running
// `functions serve`. index.ts still reads the trip and trip_members rows
// itself (service role, see the comment there on the oracle guard) and now
// only calls `evaluateReadAccess` with the result; the order and the
// short-circuit property of the queries (trip_members is only queried once
// the trip exists AND is no longer sealed) stays in index.ts, this function
// only decides based on what it is handed.
//
// Evidence of behavioural equivalence with the previous version: readAccess_test.ts
// covers exactly the six cases from the "Covered" header comment of
// read_integration_test.ts (numbers 1-3 there, plus the archive variant), without
// Docker/a running stack; read_integration_test.ts itself stayed unchanged and remains
// additionally green against the real stack (S3 signing, paging, HTTP error
// text, none of which a pure function can cover, that stays covered by the
// integration test).

export type TripStatus = 'active' | 'revealed' | 'archived';

// Only the field the decision actually needs, not the full TripRow from
// index.ts (which also carries `id`, irrelevant here).
export type ReadCheckTrip = { status: TripStatus };

export type ReadVerdict =
  | { allowed: true }
  | { allowed: false; message: string; status: number };

// trip === null: no row found, the trip does not exist (or the trip_id is
// made up).
// membership === null: no trip_members row for the requesting person,
// either never a member or removed, indistinguishable and that is
// deliberate (index.ts: "whoever was removed from the trip no longer has a
// trip_members row and falls out from here on, even if they know the
// trip_id"). A membershipError while querying is folded to null by index.ts
// BEFORE calling this function, same error text, same handling as "no row",
// only the console.error side effect stays there.
export function evaluateReadAccess(
  trip: ReadCheckTrip | null,
  membership: unknown | null,
): ReadVerdict {
  if (!trip) {
    return { allowed: false, message: 'Reise nicht gefunden.', status: 404 };
  }

  // The seal. 'active' means: nobody sees anything yet, not even the author
  // of their own moment, that is the whole point of the product, not a
  // convenience of the interface. 'archived' stays readable: put away is not
  // locked away (the same set as in posts_select_revealed_members). This
  // branch decides independently of whether `membership` is set, the author
  // herself is a member and would otherwise slip through here.
  if (trip.status !== 'revealed' && trip.status !== 'archived') {
    return { allowed: false, message: 'Diese Reise ist noch versiegelt.', status: 403 };
  }

  if (!membership) {
    return { allowed: false, message: 'Kein Zugriff auf diese Reise.', status: 403 };
  }

  return { allowed: true };
}
