// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

// First Edge Function of the project: issues short-lived presigned PUT URLs
// for S3, confirms finished uploads, and since Phase 5 also issues read
// URLs for the recap. It is the only place in the system that knows the S3
// credentials.
//
// Non-negotiable rules (Task brief §Sicherheitsregeln):
//   1. Write (PUT) URLs are for the upload, read (GET) URLs only via the
//      `read` action, and that is where the seal lives. Until Phase 5 it was
//      protected by the fact that no read path existed at all; now a check
//      chain protects it, and that chain has to be just as strict: trip
//      exists -> status is 'revealed' or 'archived' -> the calling person is
//      a member. Only then does a signature get created. Before the reveal
//      nobody gets a read URL, not even the moment's own author (the same
//      rule as posts_select_revealed_members in
//      supabase/migrations/20260806120100_counts_and_archived.sql, except
//      the function reads past RLS with the service role and therefore has
//      to run the check itself).
//   2. Keys are derived from the `posts` row (expectedKeys in ./keys.ts),
//      never taken from the client body, otherwise someone could obtain a
//      signature for someone else's path. The container extension too (iOS
//      records .mov, Android .mp4) comes from the row, column `media_ext`,
//      restricted to a closed list by a check constraint and immutable
//      after the insert. That holds retroactively too: `confirm` writes
//      those same derived keys into `posts.storage_key`/`thumb_key`,
//      instead of leaving the unchecked client value (from the insert)
//      standing. `read` derives for the same reason instead of taking
//      storage_key as given: none of the three actions ever signs a path a
//      client has written.
//   3. Identity comes exclusively from the JWT in the Authorization header
//      (supabaseAdmin.auth.getUser(token)), never from the body. Signing
//      only happens when the calling person is the post's author AND a
//      member of the trip.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch@1';
import { expectedKeys } from './keys.ts';
import { evaluateReadAccess } from './readAccess.ts';
import { normalizeTripIds, decideCover, type CoverRow } from './covers.ts';
import { createErrorReporter } from '../_shared/errorReporter.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const S3_ENDPOINT = (Deno.env.get('S3_ENDPOINT') ?? '').replace(/\/$/, '');
const S3_REGION = Deno.env.get('S3_REGION') ?? '';
const S3_BUCKET = Deno.env.get('S3_BUCKET') ?? '';
const S3_ACCESS_KEY = Deno.env.get('S3_ACCESS_KEY') ?? '';
const S3_SECRET_KEY = Deno.env.get('S3_SECRET_KEY') ?? '';

// Spec §9 / Phase 6 final review: a thin error reporter over `fetch`, no
// package (reasoning and privacy rules in _shared/errorReporter.ts). Without
// SENTRY_DSN a complete no-op.
const SENTRY_DSN = Deno.env.get('SENTRY_DSN') ?? '';
const report = createErrorReporter(SENTRY_DSN, 'media-urls');

// Presigned PUT URLs stay valid only briefly, they are meant to cover
// exactly one upload attempt, not to stockpile signatures. The client fetches
// a fresh URL immediately before uploading; if the upload fails, the queue
// job repeats the whole step, `sign` included.
const UPLOAD_URL_VALIDITY_SECONDS = 600;

// Read URLs need noticeably more room: one response covers an entire film
// roll, the player preloads, pauses, jumps back, and the phone goes into a
// pocket in between. At 600s the app would have to re-sign in the middle of
// the recap. One hour outlasts a session, without a passed-around URL
// becoming a permanent access path: after expiry the only way back leads
// through this function's check chain, which re-checks status and
// membership.
const READ_URL_VALIDITY_SECONDS = 3600;

// Page size when collecting moments. Aligned with max_rows from
// supabase/config.toml (1000): bigger has no effect, since PostgREST caps
// there anyway, smaller only costs extra round trips. The correctness of
// the loop does NOT depend on the two numbers being equal though, see there.
//
// For scale, so someone consciously decided it: a trip with 1000 finished
// moments means 2000 signatures and roughly one megabyte of JSON per call.
// That is roughly the upper bound of what this response should carry in one
// piece. Should that ever become the normal case, this action needs a
// window (Task 6 already keeps the pool client-side anyway), but a window is
// a decision with a parameter and a display for the app, not a silent cutoff
// at exactly 1000.
const POSTS_PAGE_SIZE = 1000;

type TripStatus = 'active' | 'revealed' | 'archived';

type TripRow = {
  id: string;
  status: TripStatus;
};

type PostRow = {
  id: string;
  trip_id: string;
  author_id: string;
  type: 'photo' | 'video';
  // The actual container extension of the capture (iOS: mov, Android: mp4).
  // Comes from the row, never from the request body, see keys.ts.
  media_ext: string | null;
};

// Row for the read response. storage_key is `not null` in the table,
// thumb_key is not (supabase/migrations/20260803090100_content_tables.sql);
// thumb_key therefore serves here as a yes/no, not as a path.
type MediaRow = {
  id: string;
  type: 'photo' | 'video';
  media_ext: string | null;
  storage_key: string;
  thumb_key: string | null;
};

// thumb_url is optional because thumb_key can be null, see `read`.
type MediaEntry = {
  post_id: string;
  medium_url: string;
  thumb_url?: string;
};

// One entry per trip that actually has a cover. A trip without one (no
// uploaded moment carries a thumbnail among the first page, or the trip
// failed the access chain) is simply missing from the array, see `covers`
// below.
type CoverEntry = {
  trip_id: string;
  thumb_url: string;
};

// `sign`/`confirm` work on one moment (post_id), `read` on an entire trip
// (trip_id), `covers` on several trips at once (trip_ids), deliberately
// different parameters.
type RequestBody = { action?: unknown; post_id?: unknown; trip_id?: unknown; trip_ids?: unknown };

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Error responses are German plain text for the app, never a raw provider
// error (those only end up in the server log via console.error).
function errorResponse(message: string, status: number): Response {
  return json({ error: message }, status);
}

function s3Client(): AwsClient {
  return new AwsClient({
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
    region: S3_REGION,
    service: 's3',
  });
}

function s3ObjectUrl(key: string): URL {
  return new URL(`${S3_ENDPOINT}/${S3_BUCKET}/${key}`);
}

async function presignedPutUrl(aws: AwsClient, key: string): Promise<string> {
  const url = s3ObjectUrl(key);
  url.searchParams.set('X-Amz-Expires', String(UPLOAD_URL_VALIDITY_SECONDS));
  const signed = await aws.sign(url.toString(), {
    method: 'PUT',
    aws: { signQuery: true },
  });
  return signed.url;
}

// The method is part of the signature: SigV4 puts it as the first line of
// the canonical request, whose SHA-256 feeds the string-to-sign. A URL
// created here is therefore only good for a GET, a PUT against the same URL
// computes a different canonical request server-side and fails with
// SignatureDoesNotMatch. A read URL can thus never be repurposed to
// overwrite someone else's moments (evidence: case 4 in read_integration_test.ts).
async function presignedGetUrl(aws: AwsClient, key: string): Promise<string> {
  const url = s3ObjectUrl(key);
  url.searchParams.set('X-Amz-Expires', String(READ_URL_VALIDITY_SECONDS));
  const signed = await aws.sign(url.toString(), {
    method: 'GET',
    aws: { signQuery: true },
  });
  return signed.url;
}

// Returns the object size in bytes, or null if the object does not (yet)
// exist or carries no usable Content-Length. A bare "HEAD was ok" is not
// enough: a 0-byte or aborted upload would otherwise pass as complete, and
// after that there is no way back, the queue job is gone. So only a size >
// 0 counts as proof.
async function objectSize(aws: AwsClient, key: string): Promise<number | null> {
  const signed = await aws.sign(s3ObjectUrl(key).toString(), {
    method: 'HEAD',
    aws: { signQuery: true },
  });
  const response = await fetch(signed);
  if (!response.ok) return null;
  const contentLength = response.headers.get('content-length');
  if (contentLength === null) return null;
  const size = Number(contentLength);
  return Number.isFinite(size) ? size : null;
}

function s3ConfigComplete(): boolean {
  return Boolean(S3_ENDPOINT && S3_REGION && S3_BUCKET && S3_ACCESS_KEY && S3_SECRET_KEY);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return errorResponse('Nur POST erlaubt.', 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('media-urls: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are missing.');
    await report(new Error('media-urls: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are missing.'));
    return errorResponse('Server nicht konfiguriert.', 500);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Identity comes exclusively from the JWT in the Authorization header,
  // never from the body. The body may contain post_id, but no identity.
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return errorResponse('Nicht angemeldet.', 401);
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    return errorResponse('Nicht angemeldet.', 401);
  }
  const requestingUserId = userData.user.id;

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Ungültige Anfrage.', 400);
  }

  const action = body.action;

  // `read` branches off here, BEFORE the post_id check: it works on a
  // trip_id, not on a moment. That keeps the path of `sign` and `confirm`
  // below unchanged, including the order of their checks and their error
  // text.
  if (action === 'read') {
    const tripId = body.trip_id;
    if (typeof tripId !== 'string' || tripId.length === 0) {
      return errorResponse('trip_id fehlt.', 400);
    }

    const { data: trip, error: tripError } = await supabaseAdmin
      .from('trips')
      .select('id, status')
      .eq('id', tripId)
      .maybeSingle();

    if (tripError) {
      console.error('media-urls: trips select failed', tripError);
      await report(tripError, { trip_id: tripId });
      return errorResponse('Reise konnte nicht geladen werden.', 500);
    }
    const rawTrip = trip as TripRow | null;

    // trip_members is only queried when the trip exists AND is no longer
    // sealed, otherwise the verdict (404 or "still sealed") is already
    // decided, independent of membership, and the query would be wasted
    // work against any guessed trip_id. This short-circuit property of the
    // queries deliberately stays here in index.ts: it concerns I/O, not a
    // decision, and therefore does not belong in the pure check chain below.
    //
    // is_trip_member() is unusable here, see the detailed reasoning further
    // below in the sign/confirm branch: the oracle guard (20260803090700)
    // always returns false for the service role. So read directly. Whoever
    // was removed from the trip no longer has a trip_members row and falls
    // out from here on, even if they know the trip_id.
    let membership: { user_id: string } | null = null;
    if (rawTrip && (rawTrip.status === 'revealed' || rawTrip.status === 'archived')) {
      const { data: membershipRow, error: membershipError } = await supabaseAdmin
        .from('trip_members')
        .select('user_id')
        .eq('trip_id', rawTrip.id)
        .eq('user_id', requestingUserId)
        .maybeSingle();
      if (membershipError) {
        console.error('media-urls: trip_members select failed', membershipError);
        await report(membershipError, { trip_id: rawTrip.id, user_id: requestingUserId });
        // membership stays null: evaluateReadAccess reaches the same
        // decision (403, same text) for "no row" and "error while
        // querying", only the log side effect belongs here, not in the pure
        // function.
      } else {
        membership = membershipRow;
      }
    }

    // The actual sealing check chain, extracted to readAccess.ts so it is
    // unit-testable without a running stack (readAccess_test.ts). "Trip
    // exists -> status is 'revealed' or 'archived' -> the calling person is
    // a member", identical to the previous version (error text, status
    // codes, order).
    const verdict = evaluateReadAccess(rawTrip, membership);
    if (!verdict.allowed) {
      return errorResponse(verdict.message, verdict.status);
    }
    // Safe: evaluateReadAccess only returns allowed:true when rawTrip was
    // not null (see its first branch there), the same
    // cast-after-existence-check style as postRow further below in this
    // file.
    const tripRow = rawTrip as TripRow;

    // Only finished uploads: a moment with upload_status 'pending' has no
    // complete object in storage, a URL for it would be a 404 in the film
    // roll. Order by captured_at ascending, id as the second criterion for
    // a stable sort at equal timestamps (global constraint: never by
    // created_at).
    //
    // Paged, and this is not caution just in case: PostgREST caps every
    // response at max_rows (supabase/config.toml, 1000), with no error, no
    // hint in the result, without supabase-js noticing anything. A single
    // select would silently cut off the rest of the recap for a trip with
    // more than 1000 moments, of all things in the response the whole
    // product builds towards. So it counts and pages until a page is no
    // longer full.
    //
    // `type` and `media_ext` come along because the path is re-derived here
    // instead of being taken from storage_key, see below.
    const postRows: MediaRow[] = [];
    // Offset paging runs over a set that can shift underneath it: a
    // `confirm` that sets a moment with an earlier captured_at to 'uploaded'
    // while paging is in progress pushes everything after it one position
    // back, the last row of the previous page then appears as the first of
    // the next page ONCE MORE. The cross-check below catches the loss
    // direction, not the duplicate direction: 1201 collected rows against
    // 1200 counted are >= and trip nothing. The response would carry a
    // duplicate post_id, the recap would show the same moment twice. Hence
    // the set of already-seen ids.
    const seen = new Set<string>();
    let fetchedCount = 0;
    let countedTotal: number | null = null;
    for (;;) {
      // The offset is always "however many rows the server has already
      // delivered". Deliberately not page number x page size: then
      // correctness would depend on a full page really returning
      // POSTS_PAGE_SIZE rows, i.e. on max_rows in config.toml having
      // exactly this value. Should it ever be set lower there, this loop
      // still pages correctly.
      //
      // And deliberately not the number of KEPT rows: since sorting out
      // duplicates those are two different numbers, and only the delivered
      // one is guaranteed to grow on every pass. Measured against the kept
      // count, a page made entirely of duplicates could leave the offset
      // standing, an infinite loop.
      const from = fetchedCount;
      const { data, error: postsError, count } = await supabaseAdmin
        .from('posts')
        // Counted only on the first pass: the count is its own aggregation,
        // and repeating it per page costs without benefit.
        .select('id, type, media_ext, storage_key, thumb_key', countedTotal === null ? { count: 'exact' } : undefined)
        .eq('trip_id', tripRow.id)
        .eq('upload_status', 'uploaded')
        .order('captured_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + POSTS_PAGE_SIZE - 1);

      if (postsError) {
        console.error('media-urls: posts select for read failed', postsError);
        await report(postsError, { trip_id: tripRow.id });
        return errorResponse('Momente konnten nicht geladen werden.', 500);
      }
      if (countedTotal === null) countedTotal = count ?? null;

      const pageRows = (data ?? []) as MediaRow[];
      fetchedCount += pageRows.length;
      for (const row of pageRows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        postRows.push(row);
      }

      // Empty page: there is no more. This condition ends the loop even
      // when the count is missing, and it terminates safely, because every
      // other pass moves the offset by at least one row.
      if (pageRows.length === 0) break;
      // Complete according to the first pass's count. Saves the otherwise
      // needed last, empty fetch. Measured against what was delivered:
      // otherwise a duplicate would show up as "I'm still missing one" in a
      // fetch that delivers that same duplicate again.
      if (countedTotal !== null && fetchedCount >= countedTotal) break;
    }

    // Cross-checked against the count: if fewer rows end up collected than
    // the first page promised, something was lost along the way, for
    // example a late insert that shifted the page boundaries. The response
    // still goes out (an incomplete recap is better than none), but the gap
    // is logged instead of going unnoticed.
    const lostWhileCollecting = countedTotal === null ? 0 : Math.max(0, countedTotal - postRows.length);
    if (countedTotal !== null && postRows.length < countedTotal) {
      console.error('media-urls: read collected fewer moments than counted.', {
        trip_id: tripRow.id,
        countedTotal,
        collected: postRows.length,
      });
      await report(new Error('media-urls: read collected fewer moments than counted.'), {
        trip_id: tripRow.id,
        countedTotal,
        collected: postRows.length,
      });
    }

    if (!s3ConfigComplete()) {
      console.error('media-urls: S3 environment variables incomplete.');
      await report(new Error('media-urls: S3 environment variables incomplete.'));
      return errorResponse('Server nicht konfiguriert.', 500);
    }

    // valid_until is stamped BEFORE signing. Every signature expires from
    // its own X-Amz-Date, which is never earlier than this moment, so the
    // value is conservative (never later than the real expiry), and the app
    // would rather renew a second too early than one too late.
    const validUntil = new Date(Date.now() + READ_URL_VALIDITY_SECONDS * 1000).toISOString();

    let media: MediaEntry[];
    // How many moments this trip has that are not in this response. Two
    // sources: rows sorted out (path does not match the derivation, see
    // below) and rows lost while paging. Both are the same thing for the
    // app, "the recap is N moments shorter than it should be", and both
    // were previously only visible in the server log.
    let skipped = 0;
    try {
      const aws = s3Client();
      const entries = await Promise.all(
        postRows.map(async (row): Promise<MediaEntry | null> => {
          // The signed path is derived (keys.ts), not taken from
          // storage_key. Both are identical today: `confirm` writes exactly
          // these derived values into the row, and upload_status cannot be
          // set by a client (column grant in
          // supabase/migrations/20260803090600_role_hardening.sql, plus no
          // UPDATE right on posts). Both are pinned down in pgTAP:
          // supabase/tests/07_role_hardening_test.sql (insert with
          // upload_status -> 42501) and
          // supabase/tests/12_upload_status_test.sql (update to
          // upload_status -> 42501). A row with upload_status='uploaded'
          // therefore carries server-derived keys, further confirmed in
          // confirm_integration_test.ts.
          //
          // It is still derived here regardless, because the guarantee is
          // held elsewhere: by a column grant, a missing UPDATE right, and
          // the two pgTAP files that guard them. A migration that loosens
          // the grant for a later feature would make those tests fail, but
          // whoever adjusts them then would not see from this function that
          // they are pulling its foundation out from under it. An import
          // job with the service role would bypass them entirely.
          // storage_key is the ONLY component of the path that a client has
          // ever written; not using it makes the read path independent of
          // everything outside this file. tripRow.id instead of the trip_id
          // column: filtered by this trip already, so an object from
          // another trip can never even be addressed.
          const derived = expectedKeys(
            tripRow.id,
            row.id,
            row.type,
            row.media_ext,
          );

          // If the stored path deviates from the derivation, the entry is
          // dropped, with a log entry. Two things can trigger this, and for
          // both, leaving it out is the right response: a planted row
          // (which should get no URL at all) or a row from a different key
          // scheme (then the bytes live elsewhere, and the derived URL
          // would point at nothing, a broken tile instead of an honest gap).
          //
          // That this is left out rather than merely logged has a second
          // reason: an alert that fires during normal operation gets
          // learned to be ignored, and a real hit gets lost in it. Normal
          // operation therefore has to be silent, supabase/seed.sql has
          // written its keys in the same scheme since Phase 5.
          if (row.storage_key !== derived.storage_key) {
            console.error(
              'media-urls: storage_key deviates from the derived path, moment is skipped.',
              { post_id: row.id, stored: row.storage_key, derived: derived.storage_key },
            );
            return null;
          }

          const entry: MediaEntry = {
            post_id: row.id,
            medium_url: await presignedGetUrl(aws, derived.storage_key),
          };
          // thumb_key is nullable and is only read here as a yes/no: whether
          // a thumbnail exists at all. Without this check, null would
          // produce a signature for the path ".../null", a valid URL for an
          // object that does not exist. The entry then leaves out thumb_url,
          // so the app sees the case instead of loading it. The path here
          // too comes from the derivation and never from the column: a
          // thumbnail is the content of a moment in miniature, for the seal
          // therefore nothing less than the medium itself.
          if (row.thumb_key) {
            entry.thumb_url = await presignedGetUrl(aws, derived.thumb_key);
          }
          return entry;
        }),
      );
      media = entries.filter((entry): entry is MediaEntry => entry !== null);
      // The only cause for a `null` in `entries` is the storage_key
      // comparison above (a signing error would throw through the whole
      // Promise.all chain, not null out individual entries), this
      // difference is therefore exactly the count of deviating paths,
      // separate from `lostWhileCollecting` (paging loss, already reported
      // separately above). ONE combined report instead of one per moment:
      // the comment above explains at length why normal operation has to
      // stay silent, so a real hit does not get lost in alert noise, the
      // same consideration applies to Sentry, just with an external
      // service's real rate limiting additionally in view.
      const mismatched = entries.length - media.length;
      skipped = mismatched + lostWhileCollecting;
      if (mismatched > 0) {
        await report(
          new Error('media-urls: signierte Momente wegen abweichendem Pfad ausgelassen.'),
          { trip_id: tripRow.id, count: mismatched },
        );
      }
    } catch (err) {
      console.error('media-urls: signing the read URLs failed', err);
      await report(err, { trip_id: tripRow.id });
      return errorResponse('Signieren fehlgeschlagen.', 502);
    }

    // `skipped` is a purely additive field: existing readers (Task 6,
    // mobile/src/features/recap/urlVorrat.ts) access `media` and
    // `valid_until` and remain unaffected. It is always present, even as 0;
    // a field that only shows up on error gets overlooked while building
    // the app and is then missing exactly when it is needed.
    //
    // Why it exists at all: the sorting-out above is just as silent towards
    // the app as the bare log alert used to be silent towards operations.
    // Without this number, a skipped moment is indistinguishable from one
    // that never existed, and the recap claims a completeness it does not
    // have. With it, it can say that N moments are missing.
    return json({ media, valid_until: validUntil, skipped }, 200);
  }

  // `covers` branches off here too, BEFORE the post_id check, same reason as
  // `read`: it works on trip_ids, not on a moment. The recap list needs one
  // thumbnail per trip, not the trip's whole pool (that stays `read`'s job),
  // hence its own action instead of a `limit` parameter bolted onto `read`.
  if (action === 'covers') {
    const normalized = normalizeTripIds(body.trip_ids);
    if (!normalized.ok) {
      return errorResponse(normalized.message, normalized.status);
    }

    if (!s3ConfigComplete()) {
      console.error('media-urls: S3 environment variables incomplete.');
      await report(new Error('media-urls: S3 environment variables incomplete.'));
      return errorResponse('Server nicht konfiguriert.', 500);
    }

    // Stamped BEFORE signing, same reasoning as in `read`: every signature's
    // own X-Amz-Date is never earlier than this moment, so the value is
    // conservative.
    const validUntil = new Date(Date.now() + READ_URL_VALIDITY_SECONDS * 1000).toISOString();
    const aws = s3Client();

    // Final-review finding: any per-trip DB/signing failure used to call
    // `report()` individually, up to MAX_TRIP_IDS times in one request. That
    // contradicts the "one alert, not N" policy this file already applies
    // to `read` further up (see the comment there on the combined report for
    // mismatched storage_key entries): an alert that fires routinely gets
    // learned to be ignored, and Sentry's own rate limiting would start
    // dropping some of them anyway, at which point the count is a lie. So
    // this counts across the whole batch and reports ONCE below.
    // console.error stays per-trip: local logs are not rate-limited and
    // carry the per-trip detail this aggregate deliberately drops.
    let failureCount = 0;

    // One independent check chain per trip, run concurrently
    // (Promise.all, not a loop: at up to MAX_TRIP_IDS entries the queries do
    // not depend on each other, and sequential round trips would just add
    // up latency for no benefit).
    //
    // A trip that fails ANY step below, be it the access chain or an
    // unexpected error while querying or signing, resolves to `null` and is
    // filtered out further down, WITHOUT an error and WITHOUT a distinct
    // reason. That is deliberate, not merely for the access chain: this
    // action answers for a whole batch of trip_ids in one response, and the
    // one property that must hold for every one of them, existing or
    // guessed, member or not, misconfigured storage or not, is the same
    // outward behaviour, "this trip has no cover right now". Anything that
    // let one failure mode look different from another across many trip_ids
    // would hand a caller a way to tell them apart.
    const settled = await Promise.all(
      normalized.tripIds.map(async (tripId): Promise<CoverEntry | null> => {
        const { data: trip, error: tripError } = await supabaseAdmin
          .from('trips')
          .select('id, status')
          .eq('id', tripId)
          .maybeSingle();

        if (tripError) {
          console.error('media-urls: trips select for covers failed', tripError);
          failureCount++;
          return null;
        }
        const rawTrip = trip as TripRow | null;

        // Same short-circuit as `read`: trip_members is only queried once
        // the trip exists AND is no longer sealed, and for the same reason
        // is_trip_member() stays unusable here (oracle guard, see the
        // comment in the sign/confirm branch further below), so this reads
        // trip_members directly with the service role.
        let membership: { user_id: string } | null = null;
        if (rawTrip && (rawTrip.status === 'revealed' || rawTrip.status === 'archived')) {
          const { data: membershipRow, error: membershipError } = await supabaseAdmin
            .from('trip_members')
            .select('user_id')
            .eq('trip_id', rawTrip.id)
            // This filter is what makes `membership` mean "the requesting
            // person is a member", not merely "a trip_members row exists".
            // decideCover (covers.ts) only ever checks truthiness of this
            // value, it cannot tell a targeted membership row from a stray
            // one, so removing this .eq() would make every authenticated
            // caller a member of every revealed trip as far as this action
            // is concerned. No unit test can catch that: it is a property
            // of this query against a real trip_members table, not of the
            // pure decision function. Only an integration test against the
            // real stack could, and there is none for `covers` (same gap as
            // read_integration_test.ts's ignore: !stackReady for `read`).
            .eq('user_id', requestingUserId)
            .maybeSingle();
          if (membershipError) {
            console.error('media-urls: trip_members select for covers failed', membershipError);
            failureCount++;
            // membership stays null, same fold as in `read`.
          } else {
            membership = membershipRow;
          }
        }

        // Posts are fetched regardless of whether the trip will turn out to
        // be allowed: there is no early return here for a rejected trip,
        // deliberately. Enforcement is not an inline short-circuit in this
        // file, it lives entirely in decideCover below, the ONE place that
        // decides whether this trip's rows may become a cover. A previous
        // version composed evaluateReadAccess and pickCoverRow inline here;
        // a final-review finding showed that the single line enforcing the
        // verdict could be deleted with a fully green test suite, because
        // nothing exercised that composition on its own. Moving it into
        // covers.ts as `decideCover` means the same tampering now has to
        // happen inside a function covers_test.ts exercises directly (three
        // cases there prove exactly this: sealed-trip, non-member-trip,
        // and the allowed case), so it fails loudly instead of quietly.
        const { data: postsData, error: postsError } = await supabaseAdmin
          .from('posts')
          // Only the earliest moment with a thumbnail is wanted, not the
          // whole trip. The limit is small on purpose: this looks for the
          // first of up to 20 uploaded moments (by captured_at, id) that
          // carries a thumbnail, not the whole recap pool. If none of the
          // first 20 has one, this trip gets no cover and the app falls
          // back to its placeholder, an outcome no worse than the status
          // quo before this action existed.
          .select('id, type, media_ext, storage_key, thumb_key')
          .eq('trip_id', tripId)
          .eq('upload_status', 'uploaded')
          .order('captured_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(20);

        if (postsError) {
          console.error('media-urls: posts select for covers failed', postsError);
          failureCount++;
          return null;
        }

        const coverRow = decideCover(rawTrip, membership, (postsData ?? []) as CoverRow[]);
        if (!coverRow) return null;
        // Safe: decideCover only returns non-null when evaluateReadAccess
        // returned allowed: true, which itself requires a non-null trip
        // (its first branch in readAccess.ts), the same
        // cast-after-existence-check style as tripRow in the `read` branch
        // above.
        const tripRow = rawTrip as TripRow;

        // Derived, never taken from storage_key, exactly like `read`: the
        // signed path must be the one this function computes itself, not
        // whatever a client once wrote into the row.
        const derived = expectedKeys(tripRow.id, coverRow.id, coverRow.type, coverRow.media_ext);
        if (coverRow.storage_key !== derived.storage_key) {
          console.error(
            'media-urls: storage_key deviates from the derived path, trip gets no cover.',
            { trip_id: tripRow.id, post_id: coverRow.id, stored: coverRow.storage_key, derived: derived.storage_key },
          );
          failureCount++;
          return null;
        }

        try {
          return { trip_id: tripRow.id, thumb_url: await presignedGetUrl(aws, derived.thumb_key) };
        } catch (err) {
          // Caught per trip, not around the whole Promise.all: one signing
          // failure must not turn the entire batch into a 502, the other
          // trip_ids are independent of this one. This is NOT a guard
          // against expired or revoked S3 credentials, those never throw
          // here: presignedGetUrl/aws.sign is a local WebCrypto HMAC over
          // the request, no network call, so a bad credential still
          // produces a syntactically valid signed URL, it only surfaces
          // later as a 403 from S3 against the client's own GET. What this
          // catches is a systemic local failure, e.g. a syntactically
          // broken S3_ENDPOINT reaching `new URL(...)` in s3ObjectUrl.
          console.error('media-urls: signing a cover URL failed', err);
          failureCount++;
          return null;
        }
      }),
    );

    if (failureCount > 0) {
      await report(
        new Error('media-urls: covers hatte fehlerhafte oder ausgelassene Reisen.'),
        { count: failureCount, requested: normalized.tripIds.length },
      );
    }

    const covers = settled.filter((entry): entry is CoverEntry => entry !== null);
    return json({ covers, valid_until: validUntil }, 200);
  }

  const postId = body.post_id;
  if (typeof postId !== 'string' || postId.length === 0) {
    return errorResponse('post_id fehlt.', 400);
  }
  if (action !== 'sign' && action !== 'confirm') {
    return errorResponse('Unbekannte Aktion.', 400);
  }

  // The function does not trust the client with a path: it reads the posts
  // row itself and derives the expected key from it (see keys.ts).
  const { data: post, error: postError } = await supabaseAdmin
    .from('posts')
    .select('id, trip_id, author_id, type, media_ext')
    .eq('id', postId)
    .maybeSingle();

  if (postError) {
    console.error('media-urls: posts select failed', postError);
    await report(postError, { post_id: postId });
    return errorResponse('Moment konnte nicht geladen werden.', 500);
  }
  if (!post) {
    return errorResponse('Moment nicht gefunden.', 404);
  }
  const postRow = post as PostRow;
  if (postRow.author_id !== requestingUserId) {
    return errorResponse('Kein Zugriff auf diesen Moment.', 403);
  }

  // is_trip_member() only answers questions about the caller themselves
  // (auth.uid() = p_user_id) since the oracle guard migration and therefore
  // always returns false for service_role calls (no auth.uid() claim),
  // deliberately, see
  // supabase/migrations/20260803090700_membership_oracle_guard.sql. Edge
  // Functions therefore read trip_members directly (RLS bypassed via the
  // service role).
  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('trip_members')
    .select('user_id')
    .eq('trip_id', postRow.trip_id)
    .eq('user_id', requestingUserId)
    .maybeSingle();
  if (membershipError || !membership) {
    return errorResponse('Kein Zugriff auf diesen Moment.', 403);
  }

  const { storage_key, thumb_key } = expectedKeys(
    postRow.trip_id,
    postRow.id,
    postRow.type,
    postRow.media_ext,
  );

  if (!s3ConfigComplete()) {
    console.error('media-urls: S3 environment variables incomplete.');
    await report(new Error('media-urls: S3 environment variables incomplete.'), { post_id: postRow.id });
    return errorResponse('Server nicht konfiguriert.', 500);
  }

  if (action === 'sign') {
    try {
      const aws = s3Client();
      const [medium_url, thumb_url] = await Promise.all([
        presignedPutUrl(aws, storage_key),
        presignedPutUrl(aws, thumb_key),
      ]);
      return json({ medium_url, thumb_url }, 200);
    } catch (err) {
      console.error('media-urls: signing failed', err);
      await report(err, { post_id: postRow.id });
      return errorResponse('Signieren fehlgeschlagen.', 502);
    }
  }

  // action === 'confirm': first prove it via HEAD (size > 0 included), then
  // set upload_status.
  let mediumSize: number | null;
  let thumbSize: number | null;
  try {
    const aws = s3Client();
    [mediumSize, thumbSize] = await Promise.all([
      objectSize(aws, storage_key),
      objectSize(aws, thumb_key),
    ]);
  } catch (err) {
    console.error('media-urls: check failed', err);
    await report(err, { post_id: postRow.id });
    return errorResponse('Prüfung fehlgeschlagen.', 502);
  }

  if (mediumSize === null || mediumSize <= 0 || thumbSize === null || thumbSize <= 0) {
    return errorResponse('Upload ist noch nicht vollständig.', 409);
  }

  // Only the service role may set upload_status, authenticated has had no
  // update right on posts since Phase 1
  // (supabase/migrations/20260803090300_sealing_rls.sql). storage_key/
  // thumb_key are deliberately set here TOO, not just the status: the
  // columns originally come from the client (it needs the keys before the
  // insert, see media.ts) and are unchecked. Only with this write does the
  // row guaranteed name the object that actually sits under the
  // server-derived path. `read` has not relied on that since Phase 5, it
  // derives itself, but the column thereby stays the truth about where
  // things are stored, and the comparison tripwire there only fires when
  // something is really wrong.
  const { error: updateError } = await supabaseAdmin
    .from('posts')
    .update({ upload_status: 'uploaded', storage_key, thumb_key })
    .eq('id', postRow.id);

  if (updateError) {
    console.error('media-urls: confirm failed', updateError);
    await report(updateError, { post_id: postRow.id });
    return errorResponse('Bestätigen fehlgeschlagen.', 500);
  }

  return json({ ok: true }, 200);
});
