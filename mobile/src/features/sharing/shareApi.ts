// Second, public read path onto a recap (Task-5-brief, counterpart's
// Task-2-brief): the edge function `share-link`, action `aufloesen`, needs
// NO JWT. Same call path as recapApi.ts/urlPool.ts, supabase.functions.invoke,
// errors arrive either as a FunctionsHttpError with German plain text in the
// JSON body, or as a network error detected via istOffline.
//
// W4 (spec promise): the web player can write nothing. This file calls
// ONLY supabase.functions.invoke('share-link', { aktion: 'aufloesen' }),
// no .from(), no .rpc(), no .auth. Proven here by test (spies on the whole
// client, see shareApi.test.ts), and additionally for the WHOLE screen
// statically via the module graph
// (mobile/src/app/share/__tests__/moduleGraph.test.ts), not just asserted.
import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, istOffline } from '@/lib/networkError';

export type SharedMoment = {
  post_id: string;
  authorName: string;
  // The image KEY, never a finished URL (Task 10, share-link/
  // aufloesung.ts): `avatarUrl()` (features/auth/avatar.ts) stays the only
  // place that knows the URL format, even for the shared recap. `null`
  // means "no picture", the normal case, Avatar() draws the initial then.
  authorAvatarKey: string | null;
  type: 'photo' | 'video';
  captured_at: string;
  captured_tz: string;
  place_name: string | null;
  caption: string | null;
  duration_s: number | null;
  // Coordinates of the capture (spec R4/K13, in the function's response
  // since Task 13). `null` is the normal case and no error, the same
  // meaning as in RecapMoment: without granted location services, indoors,
  // or after a timeout, the moment is submitted without a place.
  lat: number | null;
  lng: number | null;
  medium_url: string;
  thumb_url: string | null;
};

export type SharedRecap = {
  reise: { name: string; start_date: string; end_date: string };
  medien: SharedMoment[];
  validUntil: number;
  // Moments for which the function could not hand out a URL (broken or
  // missing object, signing error, dropped while paging). They're missing
  // from `medien`; without this count they'd be missing WITHOUT A TRACE, and
  // the shared page would claim to show the whole trip. It's always present
  // in the response, even as 0 (share-link/aufloesung.ts,
  // `baueAufloesungsAntwort`).
  ausgelassen: number;
};

// Same pattern as recapApi.ts/urlPool.ts/tripsApi.ts: Loaded<T> is NOT
// exported there either, each file gets its own local definition.
// `data: SharedRecap | null` instead of `Loaded<SharedRecap>` (deviation
// from the interface wording in the task brief, see report): a rejected/
// broken token has no meaningful "empty" SharedRecap value, the same shape
// as tripsApi.fetchTrip (`Loaded<Trip | null>`), where `data === null` with
// `error === null` never occurs (here: `data` is `null` exactly when
// `error` is set).
type Loaded<T> = { data: T; error: string | null };

// The function makes the four rejections (unknown, revoked, expired, not
// revealed) byte-identical by contract, no oracle. This client reinforces
// that: on error it does NOT even read the function's plain text first, it
// maps EVERY HTTP error of this action onto the same sentence, without a
// case distinction. Only a genuine network outage (no contact with the
// function) gets a different message, that's a different cause with a
// different remedy ("connect"), not a hint about the token itself.
export const DEAD_LINK_TEXT = 'Dieser Link funktioniert nicht mehr.';
const LOAD_ERROR = 'Der Recap konnte nicht geladen werden. Probier es gleich nochmal.';

// functions-js replaces a genuine network error with a fixed English
// sentence and stashes the original fetch error message in `context`, both
// places must be checked (same pattern as recapApi.ts/urlPool.ts).
function functionMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string; context?: { message?: string } } | null;
  if (istOffline({ message: err?.context?.message })) return OFFLINE_HINT;
  return istOffline(err ?? null) ? OFFLINE_HINT : fallback;
}

// Mirrors OeffentlicherMoment in supabase/functions/share-link/aufloesung.ts
// byte for byte (wire contract, Task 13), field names stay as the function
// sends them.
type MediaEntry = {
  post_id: string;
  autor_name: string;
  // Not optional, but `string | null`, exactly as `OeffentlicherMoment`
  // describes it in supabase/functions/share-link/aufloesung.ts. Still read
  // defensively (see `stringOrNull`), same reason as lat/lng: the app and
  // the function are rolled out separately.
  autor_avatar_key: string | null;
  type: 'photo' | 'video';
  captured_at: string;
  captured_tz: string;
  place_name: string | null;
  caption: string | null;
  duration_s: number | null;
  // Not optional, but `number | null`, exactly as `OeffentlicherMoment`
  // describes it in supabase/functions/share-link/aufloesung.ts. Still read
  // defensively (see `numberOrNull`).
  lat: number | null;
  lng: number | null;
  medium_url: string;
  thumb_url?: string; // only set when a thumbnail exists (contract, see media-urls precedent)
};
type ResolveResponse = {
  reise: { name: string; start_date: string; end_date: string };
  medien: MediaEntry[];
  gueltig_bis: string;
  ausgelassen: number;
};

// A coordinate that can be computed with, or `null`.
//
// `?? null` was NOT enough here, and the difference isn't theoretical: the
// app and the edge function are rolled out separately (the same reason
// `thumb_url` is read leniently). If an older function answers without the
// two fields, `m.lat` is `undefined`, and `undefined ?? null` would indeed
// give `null`, but an `m.lat` holding a string or NaN would pass through
// unchecked. Downstream, `zuKartenPunkten` checks exclusively for `=== null`
// (features/map/mapPoints.ts); anything else counts as a valid
// coordinate there and would place a pin at a position that doesn't exist.
function numberOrNull(wert: unknown): number | null {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : null;
}

// Like numberOrNull, for the image key: a value that isn't a string
// (missing from an older function, or mangled by a broken 200 response)
// becomes null instead of passing through unchecked. Avatar() hands
// avatarKey straight to avatarUrl(), a non-string value would build a URL
// that points at no real object there.
function stringOrNull(wert: unknown): string | null {
  return typeof wert === 'string' ? wert : null;
}

export async function resolveToken(token: string): Promise<Loaded<SharedRecap | null>> {
  const { data, error } = await supabase.functions.invoke('share-link', {
    body: { aktion: 'aufloesen', token },
  });

  if (error) {
    return { data: null, error: functionMessage(error, DEAD_LINK_TEXT) };
  }

  // Defensive shape check like holeVorrat (urlPool.ts): the app and the edge
  // function are rolled out separately, an unexpected/broken 200 response
  // must not crash, it counts as a load error.
  const antwort = data as Partial<ResolveResponse> | null;
  const validUntil = typeof antwort?.gueltig_bis === 'string' ? Date.parse(antwort.gueltig_bis) : NaN;
  const reise = antwort?.reise;
  if (
    !antwort ||
    !reise ||
    typeof reise.name !== 'string' ||
    typeof reise.start_date !== 'string' ||
    typeof reise.end_date !== 'string' ||
    !Array.isArray(antwort.medien) ||
    Number.isNaN(validUntil)
  ) {
    return { data: null, error: LOAD_ERROR };
  }

  const media: SharedMoment[] = antwort.medien.map((m) => ({
    post_id: m.post_id,
    authorName: m.autor_name,
    authorAvatarKey: stringOrNull(m.autor_avatar_key),
    type: m.type,
    captured_at: m.captured_at,
    captured_tz: m.captured_tz,
    place_name: m.place_name,
    caption: m.caption,
    duration_s: m.duration_s,
    lat: numberOrNull(m.lat),
    lng: numberOrNull(m.lng),
    medium_url: m.medium_url,
    thumb_url: m.thumb_url ?? null,
  }));

  return {
    data: {
      reise: { name: reise.name, start_date: reise.start_date, end_date: reise.end_date },
      medien: media,
      validUntil,
      // Read leniently and NOT part of the shape check above: the field is
      // purely additive (see `baueAufloesungsAntwort`), and an older
      // function without it must not produce a dead page. If it's missing,
      // nothing is claimed, 0 means "nothing left out", the same state it
      // was everywhere before this field existed.
      ausgelassen: typeof antwort.ausgelassen === 'number' && Number.isFinite(antwort.ausgelassen)
        ? antwort.ausgelassen
        : 0,
    },
    error: null,
  };
}
