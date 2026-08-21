// Pure logic for the `covers` action, split from the I/O in index.ts the
// same way readAccess.ts splits the check chain of `read`: the
// security-relevant decisions (which trip_ids are even valid input, which
// row among the moments of one trip becomes the cover) stand independently
// testable, with no supabase client and no Deno.serve.

export const MAX_TRIP_IDS = 50;

export type CoverRow = {
  id: string;
  type: 'photo' | 'video';
  media_ext: string;
  storage_key: string;
  thumb_key: string | null;
};

export type NormalizedTripIds =
  | { ok: true; tripIds: string[] }
  | { ok: false; message: string; status: number };

export function normalizeTripIds(raw: unknown): NormalizedTripIds {
  if (!Array.isArray(raw)) return { ok: false, message: 'trip_ids fehlt.', status: 400 };
  const tripIds = [...new Set(raw.filter((v): v is string => typeof v === 'string' && v.length > 0))];
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
