// The pure logic of the two SIGNED-IN actions, `create` and `revoke`.
// Counterpart to resolution.ts, which holds the public path.
//
// Its own file, so resolution.ts stays exactly what its header promises: the
// path with no sign-in, readable in one piece with no management logic in
// between.
//
// Why this is even its own pure function and does not just sit in
// Deno.serve: since
// supabase/migrations/20260808140000_share_links_nur_edge_function.sql,
// `authenticated` no longer has a write right on share_links. The guarantee
// "a share link is only ever created for a revealed trip and only by its
// owner" (Spec §4, W3, first half) used to have two carriers, the RLS
// policy and the function. Now it is practically carried by the function
// alone: `service_role` has `rolbypassrls`, the policy is never evaluated
// for it, and for `authenticated` the privilege no longer exists.
//
// A guarantee that hangs on exactly one place must not be covered
// exclusively by a test that skips itself without Docker.
// management_test.ts runs on every machine.

export type TripStatus = 'active' | 'revealed' | 'archived';

export type CreateTrip = {
  id: string;
  owner_id: string;
  status: TripStatus;
  // For the text of the share notification ("… euren Recap von «Lissabon»
  // geteilt"). Comes from the same query that already runs anyway.
  name: string;
};

// Who wants to revoke a token: the row plus ownership of the trip it
// belongs to. `null` means "does not exist", and has to be treated as
// indistinguishable from "belongs to someone else", see below.
export type TokenOwnership = {
  token: string;
  trip_id: string;
  owner_id: string;
  // The trip name, for the same reason as in CreateTrip.
  name: string;
};

// The verdict carries the checked data along when it is allowed.
//
// Not for convenience: "allowed" for both verdicts below ALWAYS also means
// "the row exists", otherwise the function would never get past its first
// `if`. Without the value in the result, the caller would no longer know
// that and would have to check the row against `null` a second time, in a
// branch that never runs. Exactly the kind of condition nobody can check
// later, because it is unreachable.
export type ManagementVerdict<T> =
  | { allowed: true; data: T }
  | { allowed: false; message: string; status: number };

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------
// Order: trip exists -> belongs to the requesting person -> is revealed. The
// split between 404 and 403 here is deliberately the same as in reveal-trip
// (which runs the same owner check): it tells a signed-in person that a
// trip with this UUID exists. That is already the system's existing,
// reviewed disclosure posture, and trip_id is a UUIDv4, unlike the public
// `resolve`, where the indistinguishability of the rejections carries the
// whole guarantee.
export function evaluateCreate(
  trip: CreateTrip | null,
  requestingUserId: string,
): ManagementVerdict<CreateTrip> {
  if (!trip) {
    return { allowed: false, message: 'Reise nicht gefunden.', status: 404 };
  }
  if (trip.owner_id !== requestingUserId) {
    return { allowed: false, message: 'Nur wer die Reise angelegt hat, kann den Recap teilen.', status: 403 };
  }
  // Promise W3, first half: a share link for a not-yet-revealed trip never
  // even gets created. The second half is held by evaluateToken in
  // resolution.ts, even a row that somehow came into being anyway does not
  // resolve.
  if (trip.status === 'active') {
    return { allowed: false, message: 'Diese Reise ist noch versiegelt.', status: 409 };
  }
  // 'archived': readable stays readable ("put away is not locked away"),
  // but a NEW link no longer gets created for it. This mirrors exactly the
  // split in 20260808130000: creating is revealed-only, revoking works for
  // archived too.
  if (trip.status !== 'revealed') {
    return { allowed: false, message: 'Diese Reise ist archiviert. Für sie entsteht kein neuer Link mehr.', status: 409 };
  }
  return { allowed: true, data: trip };
}

// Upper bound for `valid_days`. Not a security value, a plausibility limit:
// a link with a 100000-day lifetime is a typo, not a wish.
export const MAX_VALID_DAYS = 3650;

export type ExpiryResult =
  | { ok: true; expiresAt: string | null }
  | { ok: false; message: string };

// `valid_days` missing or null means "no expiry". Everything else has to be
// a whole number within the allowed range, in particular no floating-point
// value and no number parsed from a string, which would otherwise turn into
// a silent `Invalid Date` through an implicit conversion.
export function computeExpiry(validDays: unknown, now: Date): ExpiryResult {
  if (validDays === undefined || validDays === null) {
    return { ok: true, expiresAt: null };
  }
  if (
    typeof validDays !== 'number' || !Number.isInteger(validDays) ||
    validDays < 1 || validDays > MAX_VALID_DAYS
  ) {
    return { ok: false, message: `valid_days muss eine ganze Zahl zwischen 1 und ${MAX_VALID_DAYS} sein.` };
  }
  return { ok: true, expiresAt: new Date(now.getTime() + validDays * 86_400_000).toISOString() };
}

// ---------------------------------------------------------------------------
// revoke
// ---------------------------------------------------------------------------
// ONE response for "token does not exist" and "token belongs to someone
// else".
//
// That is not a detail, it is the flip side of `resolve`'s guarantee:
// there, four rejections go to great lengths to be byte-identical, so a
// token's existence cannot be probed. If `revoke` were an oracle ("403,
// does not belong to you" against "404, does not exist"), exactly that
// information could be obtained there, with nothing more than any own
// account. The whole effort in resolution.ts would be for nothing.
//
// As in resolution.ts a single frozen constant instead of two
// identical-looking literals, and for the same reason.
export const REVOKE_REJECTION: { allowed: false; message: string; status: number } = Object.freeze({
  allowed: false,
  message: 'Diesen Link gibt es nicht.',
  status: 404,
});

export function evaluateRevoke(
  ownership: TokenOwnership | null,
  requestingUserId: string,
): ManagementVerdict<TokenOwnership> {
  if (!ownership) return REVOKE_REJECTION;
  if (ownership.owner_id !== requestingUserId) return REVOKE_REJECTION;
  return { allowed: true, data: ownership };
}
