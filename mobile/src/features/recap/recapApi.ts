import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, isOffline } from '@/lib/networkError';
import { sortMoments } from './days';
import type { RecapMoment } from './types';

// Same pattern as tripsApi.ts/momentsApi.ts: return data and error
// separately, so an empty array is never confused with "genuinely empty"
// (Loaded<T> isn't exported there, every file gets its own local
// definition of the same shape, no second import detour for two fields).
type Loaded<T> = { data: T; error: string | null };

function message(error: { message?: string } | null, fallback: string): string {
  return isOffline(error) ? OFFLINE_HINT : fallback;
}

// functions-js replaces a genuine network error with a fixed English
// sentence and puts the original fetch error message in `context` (see the
// detailed comment in momentsApi.ts), both places must be checked before
// falling back to the generic message.
function functionMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string; context?: { message?: string } } | null;
  if (isOffline({ message: err?.context?.message })) return OFFLINE_HINT;
  return message(err ?? null, fallback);
}

// `profiles!posts_author_id_fkey` instead of just `profiles`: there are TWO
// paths between `posts` and `profiles`, the direct one via
// `posts.author_id`, and a many-to-many one via `reactions` (post_id/
// user_id). PostgREST refuses an ambiguous embed with HTTP 300 (PGRST201)
// and returns no data at all.
//
// Found only by playing through the running app: the recap showed "Die
// Momente konnten nicht geladen werden", for every trip, for every person.
// No test saw it, because they all mock the Supabase client and the mock
// never actually issues the query. Shortening the name here breaks the
// recap completely.
const COLUMNS = [
  'id', 'trip_id', 'author_id', 'type', 'duration_s', 'caption',
  'captured_at', 'captured_tz', 'place_name', 'lat', 'lng', 'upload_status',
  'profiles!posts_author_id_fkey(display_name, avatar_key)',
].join(', ');

type PostRow = Omit<RecapMoment, 'authorName' | 'authorAvatarKey'> & {
  profiles: { display_name: string; avatar_key: string | null } | null;
};

// profiles(display_name) hangs off the author_id foreign key, analogous to
// trip_members(profiles(display_name)) in tripsApi.fetchMembers.
//
// Only runs after the reveal: posts_select_revealed_members only lets
// members read once trips.status is in ('revealed', 'archived'), before
// that the query returns an empty list without an error (RLS filters,
// doesn't throw). That's not a special case this function needs to handle.
export async function fetchRecapMoments(tripId: string): Promise<Loaded<RecapMoment[]>> {
  const { data, error } = await supabase.from('posts').select(COLUMNS).eq('trip_id', tripId);
  if (error || !data) {
    return {
      data: [],
      error: message(error, 'Die Momente konnten nicht geladen werden. Probier es gleich nochmal.'),
    };
  }
  // `unknown` as an intermediate step: without a generic Database type on
  // the client, postgrest-js infers profiles(...) as an array instead of a
  // single object (same reason as TripRow in tripsApi.ts). Unchanged at
  // runtime.
  const moments = (data as unknown as PostRow[]).map((row) => ({
    id: row.id,
    trip_id: row.trip_id,
    author_id: row.author_id,
    type: row.type,
    duration_s: row.duration_s,
    caption: row.caption,
    captured_at: row.captured_at,
    captured_tz: row.captured_tz,
    place_name: row.place_name,
    lat: row.lat,
    lng: row.lng,
    upload_status: row.upload_status,
    authorName: row.profiles?.display_name ?? '',
    authorAvatarKey: row.profiles?.avatar_key ?? null,
  }));
  return { data: sortMoments(moments), error: null };
}

export async function revealTrip(
  tripId: string
): Promise<{ revealed_at: string | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('reveal-trip', {
    body: { trip_id: tripId },
  });
  if (error) {
    // Same pattern as confirmUpload in momentsApi.ts.
    const httpError = error as { name?: string; context?: unknown };
    if (httpError?.name === 'FunctionsHttpError' && httpError.context instanceof Response) {
      try {
        const body = (await httpError.context.clone().json()) as { error?: string };
        if (typeof body.error === 'string') return { revealed_at: null, error: body.error };
      } catch {
        // Antwort war kein JSON, generische Meldung unten.
      }
    }
    return {
      revealed_at: null,
      error: functionMessage(error, 'Die Reise konnte nicht abgeschlossen werden. Probier es gleich nochmal.'),
    };
  }
  const result = data as { ok?: boolean; revealed_at?: string | null } | null;
  if (!result?.ok) {
    return { revealed_at: null, error: 'Die Reise konnte nicht abgeschlossen werden. Probier es gleich nochmal.' };
  }
  return { revealed_at: result.revealed_at ?? null, error: null };
}
