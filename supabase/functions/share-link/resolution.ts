// The pure logic of the `resolve` action, the SECOND read path onto media
// and the first with no sign-in at all. A bug here is not a crash, it is a
// silent leak.
//
// This file contains no I/O: no Deno.serve, no network, no Supabase client,
// no S3 credentials. In that it follows media-urls/readAccess.ts (the
// check chain of the member read path) and reveal-trip/reveal.ts (the
// decision logic of the status change). The reason is spelled out at length
// in the header of readAccess.ts and is binding here too: a test with
// `ignore: !stackReady` is indistinguishable from a PASSED test in any
// summary on a machine without Docker. Every guarantee of this function that
// can be checked without a running stack is therefore held here and proven
// in resolution_test.ts, the integration test is the second layer, never
// the only one.
//
// What lives here and is therefore checkable without Docker:
//   1. `evaluateToken`, the check chain including the guarantee that its
//      four rejections are BYTE-IDENTICAL (LINK_REJECTION).
//   2. `collectMoments`, paging past the PostgREST max_rows boundary,
//      including duplicate protection and termination conditions.
//   3. `buildMedia`, the derivation of storage keys (never from
//      posts.storage_key) and the shape of a single moment.
//   4. `shapeTrip` / `buildResolveResponse`, the shape of the response, i.e.
//      the evidence for what `resolve` does NOT hand out.
//
// What cannot live here and therefore falls to share_link_integration_test.ts:
// that the SQL queries really filter by `trip_id` and `upload_status =
// 'uploaded'`, that the S3 signature holds, and that the public call gets
// through the gateway with no Authorization header.

import { expectedKeys } from '../media-urls/keys.ts';

export type TripStatus = 'active' | 'revealed' | 'archived';

// Exactly the four columns a link's validity hinges on. Deliberately not the
// whole row: `created_at` plays no role in the decision, and what is never
// passed in cannot accidentally end up in the response either.
export type ShareLinkRow = {
  token: string;
  trip_id: string;
  expires_at: string | null;
  revoked: boolean;
};

// The trip, the way `resolve` needs it: `status` for the check chain, the
// other three for the response. `id`, `owner_id`, `invite_code`, `plan`,
// `revealed_at`, and `cover_key` deliberately do NOT appear here, see
// shapeTrip.
export type ResolutionTrip = {
  status: TripStatus;
  name: string;
  start_date: string;
  end_date: string;
};

export type TokenVerdict =
  | { allowed: true }
  | { allowed: false; message: string; status: number };

// ---------------------------------------------------------------------------
// THE ONE GUARANTEE EVERYTHING HANGS ON
// ---------------------------------------------------------------------------
// Every rejection from `resolve` is THIS one constant. Not four object
// literals that happen to carry the same content, but a single value every
// rejection branch returns.
//
// Why that matters: unknown token, revoked token, expired token, and trip
// not yet revealed must be indistinguishable to an outsider. If anything
// differs, text, status code, an extra field, the function becomes an
// oracle that lets valid tokens be told apart from invalid ones: "404 with
// text A means this token exists, it is just expired" is already half the
// answer. `resolution_test.ts` pins the equality down at the level that
// matters: same status code AND same serialized response body.
//
// Object.freeze, because this value is returned in four places and only
// ever read by the caller; an accidental `verdict.message = …` at the call
// site would otherwise change all four branches at once.
//
// The text is the same one the public web player displays ("Dieser Link
// funktioniert nicht mehr.", plan Task 5 step 3), it does not reveal whether
// the token ever existed.
export const LINK_REJECTION: { allowed: false; message: string; status: number } = Object.freeze({
  allowed: false,
  message: 'Dieser Link funktioniert nicht mehr.',
  status: 404,
});

// Upper bound for the token from the request body. The real token is 32 hex
// characters (share_links.token, default
// encode(gen_random_bytes(16),'hex')), but the column is `text` and an
// owner could in theory set their own value, so enforcing a character class
// would be wrong. This is not a length limit for its own sake: it only
// keeps a megabyte-long string from being poured into a PostgREST query.
// Whoever hits it gets LINK_REJECTION like any unknown token, no dedicated
// error text, otherwise the limit itself would again be a distinguishable
// signal.
export const TOKEN_MAX_LENGTH = 512;

export function isTokenLengthPlausible(token: string): boolean {
  return token.length > 0 && token.length <= TOKEN_MAX_LENGTH;
}

// The check chain. Order as in Spec §5.1: token exists -> not revoked -> not
// expired -> trip is 'revealed' or 'archived'.
//
// `now` is passed in instead of created internally: a function that calls
// `Date.now()` itself cannot be tested against the edge case "expires this
// very second" without clock trickery.
//
// `trip === null` while a row exists cannot occur today
// (`share_links.trip_id` is `not null` with `on delete cascade`), but is
// rejected rather than let through: a missing trip is no reason to hand out
// media.
export function evaluateToken(
  row: ShareLinkRow | null,
  trip: { status: TripStatus } | null,
  now: Date,
): TokenVerdict {
  // 1. Token unknown.
  if (!row) return LINK_REJECTION;

  // 2. Revoked. Not a delete, but a flag (Spec §5.1), so a support case
  //    stays answerable. From the outside the difference stays invisible
  //    regardless.
  if (row.revoked) return LINK_REJECTION;

  // 3. Expired. `null` means "no expiry". A value Date.parse cannot
  //    understand counts as expired, not as "no expiry", a broken
  //    timestamp must never make a link valid indefinitely. `<=` instead of
  //    `<`: the second of expiry no longer counts.
  if (row.expires_at !== null) {
    const expiry = Date.parse(row.expires_at);
    if (!Number.isFinite(expiry) || expiry <= now.getTime()) return LINK_REJECTION;
  }

  // 4. The seal, for the second time, here with no sign-in at all, so
  //    independent of the check chain in media-urls/readAccess.ts, but
  //    with the same set: 'revealed' and 'archived' show, 'active' does
  //    not. "Put away is not locked away"
  //    (20260803090600_role_hardening.sql). There is no "sealed again"
  //    state today, the check costs nothing (Spec §5.1, point 3).
  if (!trip) return LINK_REJECTION;
  if (trip.status !== 'revealed' && trip.status !== 'archived') return LINK_REJECTION;

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Collecting the moments, paging past the max_rows boundary
// ---------------------------------------------------------------------------
// PostgREST caps every response at max_rows (supabase/config.toml: 1000),
// with no error, no hint in the result, without supabase-js noticing any of
// it. media-urls learned that in Phase 5; the same pattern lives here, but
// as a pure function over an injected page query, so resolution_test.ts can
// check it WITHOUT a stack (in media-urls the loop sits inside index.ts and
// is only reachable through the integration test).

export type MomentRow = {
  id: string;
  type: 'photo' | 'video';
  media_ext: string | null;
  storage_key: string;
  thumb_key: string | null;
  captured_at: string;
  captured_tz: string;
  place_name: string | null;
  // Part of the public response since Phase 7 (Spec R4, user decision): the
  // shared recap shows the same map as the app. This is the only path
  // through which coordinates reach people with no account, they only ever
  // leave through a passed `evaluateToken`.
  //
  // Both columns are nullable, and `null` is the NORMAL case, not an error:
  // ortBestimmen() deliberately returns nothing when location services are
  // not allowed, no fix is obtained indoors, or the deadline runs out. The
  // moment still gets submitted and therefore has to appear here too.
  lat: number | null;
  lng: number | null;
  caption: string | null;
  duration_s: number | null;
  // Already flattened out of the PostgREST embed (store.ts). The author's
  // name belongs in the response, it already sits on every moment in the
  // recap anyway.
  author_name: string | null;
  // Flattened out of the PostgREST embed like author_name (store.ts). The
  // key goes out, never a finished URL: the client alone
  // (mobile/src/features/auth/avatar.ts) knows the formula, and it should
  // have exactly one place that does.
  //
  // This used to say the author_id "NEVER" leaves. That stopped being true
  // with the profile picture feature (2026-08-12): the key is
  // `profiles/<author_id>/<32 hex>.jpg`, so the author's auth UUID does
  // travel along in this row once they have a profile picture. Accepted
  // deliberately (addendum in
  // docs/superpowers/specs/2026-08-08-phase-6-teilen-export-store-design.md
  // §5.1): a bare UUID opens nothing, profiles RLS requires shared
  // membership, `select` on storage.objects requires authenticated, and no
  // anonymous endpoint accepts a raw uid. Whoever has the link can only
  // read from it that two shared recaps have the same author, whose name
  // the response names anyway.
  author_avatar_key: string | null;
};

export type PageResult = {
  rows: MomentRow[];
  // Only filled on the first pass (`withCount`), otherwise null.
  count: number | null;
  error: unknown;
};

export type FetchPageFn = (from: number, withCount: boolean) => Promise<PageResult>;

export async function collectMoments(
  fetchPage: FetchPageFn,
): Promise<{ rows: MomentRow[]; lost: number; error: unknown }> {
  const rows: MomentRow[] = [];
  // Offset paging runs over a set that can shift underneath it. A `confirm`
  // (media-urls) that sets a moment with an earlier captured_at to
  // 'uploaded' while paging is in progress pushes everything after it one
  // position back, the last row of the previous page then appears as the
  // first of the next page ONCE MORE. The cross-check below catches the
  // loss direction, not the duplicate direction. Hence the set of
  // already-seen ids.
  const seen = new Set<string>();
  let fetchedCount = 0;
  let countedTotal: number | null = null;

  for (;;) {
    // The offset is always "however many rows the server has already
    // delivered". Deliberately not page number x page size: then
    // correctness would depend on a full page really returning the
    // expected number of rows, i.e. on max_rows in config.toml having
    // exactly this value. And deliberately not the number of KEPT rows:
    // only the delivered count is guaranteed to grow on every pass,
    // measured against the kept count a page made entirely of duplicates
    // could leave the offset standing, an infinite loop.
    const page = await fetchPage(fetchedCount, countedTotal === null);
    if (page.error) return { rows, lost: 0, error: page.error };
    if (countedTotal === null) countedTotal = page.count;

    fetchedCount += page.rows.length;
    for (const row of page.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }

    // Empty page: there is no more. This condition ends the loop even when
    // the count is missing, and it terminates safely, because every other
    // pass moves the offset by at least one row.
    if (page.rows.length === 0) break;
    // Complete according to the first pass's count. Measured against what
    // was delivered, not what was kept, otherwise a duplicate would show up
    // as "I'm still missing one" in a fetch that delivers that same
    // duplicate again.
    if (countedTotal !== null && fetchedCount >= countedTotal) break;
  }

  // If fewer rows end up collected than the first page promised, something
  // was lost along the way. The response still goes out (an incomplete
  // recap is better than none), but the gap gets counted instead of going
  // unnoticed.
  const lost = countedTotal === null ? 0 : Math.max(0, countedTotal - rows.length);
  return { rows, lost, error: null };
}

// ---------------------------------------------------------------------------
// The shape of the response, and thereby the evidence for what is NOT in it
// ---------------------------------------------------------------------------

export type PublicTrip = {
  name: string;
  start_date: string;
  end_date: string;
};

// Exactly the thirteen fields from the interface contract (plan Task 2,
// extended by lat/lng since Phase 7, by author_avatar_key since Task 10).
// thumb_url is `string | null` here and not optional like in media-urls: a
// field that only shows up sometimes gets overlooked while building the
// player and is then missing exactly when it is needed. For the same
// reason lat/lng and author_avatar_key are not optional either, but
// `T | null`, "no place"/"no picture" is a statement, "field missing" is
// not.
export type PublicMoment = {
  post_id: string;
  author_name: string;
  // The image KEY, never a finished URL: this function only ever hands out
  // the key (the opposite of what would normally apply for medium_url/
  // thumb_url below), so `avatarUrl()`
  // (mobile/src/features/auth/avatar.ts) stays the only place in the system
  // that knows the URL format. The web viewer builds the URL itself with
  // the same formula.
  author_avatar_key: string | null;
  type: 'photo' | 'video';
  captured_at: string;
  captured_tz: string;
  place_name: string | null;
  lat: number | null;
  lng: number | null;
  caption: string | null;
  duration_s: number | null;
  medium_url: string;
  thumb_url: string | null;
};

export type ResolveResponse = {
  trip: PublicTrip;
  media: PublicMoment[];
  valid_until: string;
  skipped: number;
};

// Builds the three trip fields FRESH, instead of passing the read row
// through. That is this function's entire purpose: the trip row carries
// `id`, `owner_id`, `invite_code`, `plan`, `revealed_at`, `cover_key`, and
// `status`. `invite_code` alone would let anyone with the public link join
// the trip, "allowed to look" would turn into "able to take part". A
// `...row` spread or a passed-through object would be exactly the mistake
// no reviewer catches on a skim. resolution_test.ts therefore feeds this
// function a row carrying all of these fields, and checks the result's key
// set is EXACTLY three.
export function shapeTrip(row: PublicTrip): PublicTrip {
  return {
    name: row.name,
    start_date: row.start_date,
    end_date: row.end_date,
  };
}

export type SignFn = (key: string) => Promise<string>;

// Builds the public entries plus signed URLs from the read posts rows.
// `tripId` comes from the share_links ROW, never from the request body,
// that is where promise W1 lives ("a share link only shows the trip it
// belongs to").
export async function buildMedia(
  tripId: string,
  rows: MomentRow[],
  sign: SignFn,
): Promise<{ media: PublicMoment[]; skipped: number }> {
  const entries = await Promise.all(
    rows.map(async (row): Promise<PublicMoment | null> => {
      // The signed path is derived (media-urls/keys.ts), not taken from
      // storage_key. Reasoning at length in media-urls/index.ts:
      // storage_key is the ONLY component of the path a client has ever
      // written. For the PUBLIC read path this weighs heavier than for the
      // member read path, since no JWT and no membership check stands in
      // the way here anymore.
      const derived = expectedKeys(tripId, row.id, row.type, row.media_ext);

      // If the stored path deviates from the derivation, the entry is
      // dropped. Two things can trigger this, and for both, leaving it out
      // is the right response: a planted row (which should get no public
      // URL at all) or a row from a different key scheme (then the bytes
      // live elsewhere, and the derived URL would point at nothing).
      if (row.storage_key !== derived.storage_key) {
        console.error(
          'share-link: storage_key weicht vom abgeleiteten Pfad ab, Moment wird ausgelassen.',
          { post_id: row.id, stored: row.storage_key, derived: derived.storage_key },
        );
        return null;
      }

      return {
        post_id: row.id,
        // display_name is `not null` in profiles and author_id is a
        // required foreign key column, so this case does not occur. A
        // missing name must still never turn into `null` or `undefined` in
        // the contract.
        author_name: row.author_name ?? '',
        // Unlike author_name, no `?? ''`: a missing name needs an initial
        // to draw, a missing picture needs NOTHING except `null`, Avatar()
        // then draws the initial itself. An empty string here would be a
        // key that `avatarUrl()` would assemble into a broken URL to a
        // non-existent object.
        author_avatar_key: row.author_avatar_key,
        type: row.type,
        captured_at: row.captured_at,
        captured_tz: row.captured_tz,
        place_name: row.place_name,
        // Passed through unchanged, even as null. No `?? 0` and no
        // dropping the moment: a 0/0 coordinate would drop a pin in the
        // Gulf of Guinea, dropping the moment would make it disappear from
        // the film roll. The map leaves out the pin, not the moment.
        lat: row.lat,
        lng: row.lng,
        caption: row.caption,
        duration_s: row.duration_s,
        medium_url: await sign(derived.storage_key),
        // thumb_key is nullable and is only read as a yes/no. Without this
        // check, null would produce a signature for the path ".../null", a
        // valid URL for an object that does not exist. The path here too
        // comes from the derivation: a thumbnail is the content of a
        // moment in miniature, for the seal therefore nothing less than
        // the medium itself.
        thumb_url: row.thumb_key ? await sign(derived.thumb_key) : null,
      };
    }),
  );

  const media = entries.filter((e): e is PublicMoment => e !== null);
  return { media, skipped: entries.length - media.length };
}

// The complete response. Its own function instead of an object literal in
// index.ts, so resolution_test.ts can pin down the key set of the WHOLE
// response, not just of its parts.
//
// `skipped` is purely additive (same number, same reason as in
// media-urls/lesen): the sorting-out above and a loss while paging would
// otherwise be just as silent towards the player as a bare log alert would
// be silent towards operations. It is always present, even as 0.
export function buildResolveResponse(
  trip: PublicTrip,
  media: PublicMoment[],
  validUntil: string,
  skipped: number,
): ResolveResponse {
  return {
    trip: shapeTrip(trip),
    media,
    valid_until: validUntil,
    skipped,
  };
}
