// Same call pattern as urlPool.ts's getPool (supabase.functions.invoke
// against media-urls), but deliberately without its error translation:
// getPool turns a failure into German text because the recap player shows
// it to a human. This module never shows anything. Task 6's `covers`
// action already folds "sealed", "not a member", "trip doesn't exist" and
// "no thumbnail among the first moments" into the same outcome, an absent
// entry, with no way to tell them apart and no remedy attached to any of
// them. So there is no text worth extracting from a failure here, only
// ever an empty Map, and the recap list falls back to its own placeholder
// covers exactly as if this call had never been made.
import { supabase } from '@/lib/supabase';

// Mirrors CoverEntry/the covers response shape in
// supabase/functions/media-urls/index.ts. valid_until isn't read here: the
// list refetches covers on every focus alongside the trips (signed URLs,
// never cached beyond the session), so nothing client-side ever needs to
// know when they expire.
type CoverEntry = { trip_id: string; thumb_url: string };
type CoversResponse = { covers: CoverEntry[] };

export async function fetchCovers(tripIds: string[]): Promise<Map<string, string>> {
  // Guards against a call for nothing, not against exceeding MAX_TRIP_IDS
  // (that cap is enforced server-side, covers.ts): the recap list is the
  // only caller and in practice never approaches it.
  if (tripIds.length === 0) return new Map();

  const { data, error } = await supabase.functions.invoke('media-urls', {
    body: { action: 'covers', trip_ids: tripIds },
  });
  if (error) return new Map();

  const response = data as Partial<CoversResponse> | null;
  if (!response || !Array.isArray(response.covers)) return new Map();

  return new Map(response.covers.map((entry) => [entry.trip_id, entry.thumb_url]));
}
