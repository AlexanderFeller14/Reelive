// Pool of read URLs for the recap player: ONE call against the edge
// function `media-urls` (action `lesen`) returns signed GET URLs for ALL
// uploaded moments of a trip at once (task brief). The player therefore
// doesn't fetch its own signature per moment, it holds a pool that it
// checks itself for looming expiry, that's the bracket around promise V10:
// an expired URL must never end the recap, the player renews it in the
// background in good time (Task 11, Step 6).
//
// Same call pattern as recapApi.revealTrip and momentsApi.signedUrls/
// confirmUpload: supabase.functions.invoke, errors arrive either as a
// FunctionsHttpError with German plain text in the JSON body, or as a
// network error recognised via istOffline.
import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, istOffline } from '@/lib/networkError';

export type MediaUrl = { post_id: string; medium_url: string; thumb_url: string | null };
// ausgelassen: number of moments for which there was no URL, Task 11 turns
// that into "N Momente konnten nicht geladen werden". The function
// normally always sends this field (even as 0), but the app and the
// function are rolled out separately, a missing field must never keep the
// recap from loading (Phase-5 final review, point 2).
export type Pool = { urls: Map<string, MediaUrl>; gueltigBis: number; ausgelassen: number };

// The function signs for LESE_URL_GUELTIGKEIT_SEKUNDEN = 3600 s (see
// supabase/functions/media-urls/index.ts), a five-minute buffer is enough
// at that scale to refetch ahead of the actual expiry without re-signing on
// every other tap. Exported because Task 11 needs the same threshold in its
// own tests (review finding), a second, repeated literal there must never
// drift from this one.
export const SOON_EXPIRING_THRESHOLD_MS = 5 * 60 * 1000;

// A database error during the function's own membership check also answers
// with "Kein Zugriff auf diese Reise." and status 403
// (supabase/functions/media-urls/index.ts:256-259): server-side, the text
// alone can't reliably distinguish "genuinely not a member" from "DB outage
// while checking", but from the client's point of view that's the same
// action either way ("no access", go back, maybe retry), so the function
// deliberately maps both cases onto the same text.
const TRIP_SEALED_TEXT = 'Diese Reise ist noch versiegelt.';
const NO_ACCESS_TEXT = 'Kein Zugriff auf diese Reise.';

export type Reason = 'versiegelt' | 'kein_zugriff';

// All three recap screens (overview, player, map) used to always offer
// "Try again" up to this point, even under "Diese Reise ist noch
// versiegelt.". That's not a minor tone issue: a button is a promise, and
// this one could never keep it, no matter how often it was pressed.
//
// As a named function rather than `reason === null` in three screens: if a
// third reason is ever added for which retrying does help, there is exactly
// one place that needs to know.
export function retryHelps(reason: Reason | null): boolean {
  return reason === null;
}

function reasonFrom(status: number, text: string): Reason | null {
  if (status !== 403) return null;
  if (text === TRIP_SEALED_TEXT) return 'versiegelt';
  if (text === NO_ACCESS_TEXT) return 'kein_zugriff';
  return null;
}

// Mirrors MediaEntry in supabase/functions/media-urls/index.ts: thumb_url
// is only set there when thumb_key exists, for a moment without a
// thumbnail the field is absent entirely (no `null`, no empty string).
type MediaEntry = { post_id: string; medium_url: string; thumb_url?: string };
type ReadResponse = { medien: MediaEntry[]; gueltig_bis: string; ausgelassen: number };

// functions-js replaces a genuine network error with a fixed English
// sentence and puts the original fetch error message in `context` (see the
// detailed comment in momentsApi.ts), both places must be checked before
// falling back to the generic message. Same pattern as recapApi.ts.
function functionMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string; context?: { message?: string } } | null;
  if (istOffline({ message: err?.context?.message })) return OFFLINE_HINT;
  return istOffline(err ?? null) ? OFFLINE_HINT : fallback;
}

const LOAD_ERROR = 'Die Momente konnten nicht geladen werden. Probier es gleich nochmal.';

export async function getPool(
  tripId: string
): Promise<{ pool: Pool | null; error: string | null; reason: Reason | null }> {
  const { data, error } = await supabase.functions.invoke('media-urls', {
    body: { aktion: 'lesen', trip_id: tripId },
  });

  if (error) {
    // Only the two domain-specific 403s (sealed, membership) are passed
    // through 1:1, they name both the cause AND the only possible
    // "solution" (wait, or go back, DESIGN-LANGUAGE §6). Everything else the
    // same function can return is technical text without a remedy and not
    // in second person (review finding, minor): LOAD_ERROR below stays the
    // right, consistent answer for those.
    const httpError = error as { name?: string; context?: unknown };
    if (httpError?.name === 'FunctionsHttpError' && httpError.context instanceof Response) {
      const status = httpError.context.status;
      try {
        const body = (await httpError.context.clone().json()) as { fehler?: string };
        const reason = typeof body.fehler === 'string' ? reasonFrom(status, body.fehler) : null;
        if (reason) return { pool: null, error: body.fehler as string, reason: reason };
      } catch {
        // Antwort war kein JSON, generische Meldung unten.
      }
    }
    return { pool: null, error: functionMessage(error, LOAD_ERROR), reason: null };
  }

  const response = data as Partial<ReadResponse> | null;
  const gueltigBis = typeof response?.gueltig_bis === 'string' ? Date.parse(response.gueltig_bis) : NaN;
  if (!response || !Array.isArray(response.medien) || Number.isNaN(gueltigBis)) {
    return { pool: null, error: LOAD_ERROR, reason: null };
  }

  const urls = new Map<string, MediaUrl>();
  for (const entry of response.medien) {
    urls.set(entry.post_id, {
      post_id: entry.post_id,
      medium_url: entry.medium_url,
      thumb_url: entry.thumb_url ?? null,
    });
  }

  return { pool: { urls, gueltigBis, ausgelassen: response.ausgelassen ?? 0 }, error: null, reason: null };
}

export function isSoonExpiring(pool: Pool, now: number): boolean {
  return !(pool.gueltigBis - now >= SOON_EXPIRING_THRESHOLD_MS);
}
