// Pure logic for the `covers` action, split from the I/O in index.ts the
// same way readAccess.ts splits the check chain of `read`: the
// security-relevant decisions (which trip_ids are even valid input, whether
// a trip may have a cover at all, which row among its moments becomes that
// cover) stand independently testable, with no supabase client and no
// Deno.serve.

import { evaluateReadAccess, type ReadCheckTrip } from './readAccess.ts';

export const MAX_TRIP_IDS = 50;

// media_ext is `string | null` even though the column is currently `not
// null default 'jpg'` (supabase/migrations/20260807100000_post_media_ext.sql):
// that guarantee lives in the schema, not in anything this file's own query
// enforces, and index.ts casts the untyped query result into this type
// (`as CoverRow[]`), so a narrower type here would assert something this
// file cannot actually verify. expectedKeys in keys.ts already treats a
// missing extension as "unknown, fall back to the default for the capture
// type", so nothing downstream needs the tighter type either.
export type CoverRow = {
  id: string;
  type: 'photo' | 'video';
  media_ext: string | null;
  storage_key: string;
  thumb_key: string | null;
};

export type NormalizedTripIds =
  | { ok: true; tripIds: string[] }
  | { ok: false; message: string; status: number };

// trips.id is `uuid` (supabase/migrations/20260803090000_core_tables.sql).
// A string that is not shaped like a uuid can never match a row, Postgres
// rejects it outright with 22P02 before it even gets to compare anything.
// Filtering it out here costs nothing (such an id was never going to yield
// a cover) and closes an on-demand trigger: every rejected id used to route
// straight into the per-trip error-reporting path in index.ts, up to
// MAX_TRIP_IDS times in a single request, for any authenticated caller who
// simply sent garbage strings.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeTripIds(raw: unknown): NormalizedTripIds {
  // One message for "absent" and "present but the wrong shape": the caller
  // gets the same 400 either way, and a message claiming the field is
  // missing when it was in fact a string or an object would just be wrong.
  if (!Array.isArray(raw)) {
    return { ok: false, message: 'trip_ids fehlt oder ist ungültig.', status: 400 };
  }
  const tripIds = [
    ...new Set(raw.filter((v): v is string => typeof v === 'string' && UUID_RE.test(v))),
  ];
  if (tripIds.length > MAX_TRIP_IDS) {
    return { ok: false, message: 'Zu viele Reisen auf einmal.', status: 400 };
  }
  return { ok: true, tripIds };
}

// `rows` comes in already ordered by captured_at, id (the query does that),
// so the first row carrying a thumbnail is the earliest one. A moment
// without a thumbnail is skipped rather than signed: the path would be
// ".../null", a valid signature for an object that does not exist.
export function pickCoverRow(rows: CoverRow[]): CoverRow | null {
  return rows.find((row) => row.thumb_key !== null) ?? null;
}

// The composed decision for one trip: index.ts calls THIS, not
// evaluateReadAccess and pickCoverRow side by side. That is not a style
// preference, it is the actual fix for a final-review finding: when the two
// were composed inline in index.ts, deleting the single line that checked
// the verdict left every other test in the repository green, sealed trips
// and non-members included, and there was nothing that would trip. With the
// composition living here instead, the same tampering has to happen inside
// a function this file's own tests exercise directly (see the three cases
// below), so it fails loudly instead of quietly.
//
// Folds "not allowed" and "no cover among the rows" into the same `null`
// on purpose: index.ts never has to (and must not) tell those two apart,
// see the header reasoning in index.ts on why a rejected trip is only ever
// absent from the response.
export function decideCover(
  trip: ReadCheckTrip | null,
  membership: unknown | null,
  rows: CoverRow[],
): CoverRow | null {
  if (!evaluateReadAccess(trip, membership).allowed) return null;
  return pickCoverRow(rows);
}
