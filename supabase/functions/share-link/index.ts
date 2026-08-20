// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

// share-link, the SECOND read path onto media and the first with NO sign-in
// at all. Three actions:
//
//   create  (JWT, owner)  -> creates a share_links row
//   revoke  (JWT, owner)  -> sets revoked = true
//   resolve (no JWT)      -> hands out what an outsider is allowed to see
//
// ---------------------------------------------------------------------------
// WHY THIS FUNCTION HAS verify_jwt = false, and what follows from that
// ---------------------------------------------------------------------------
// media-urls and reveal-trip sit in supabase/config.toml with `verify_jwt =
// true`: a call never even reaches them without a valid, correctly signed
// JWT; the gateway is the first of two hurdles there.
//
// That does not work here. `resolve` is the path through which someone
// WITHOUT an account views a shared recap, no JWT, no anon key, nothing
// (Spec §4, W5: "whoever has the link needs no account"). So the gateway
// has to let everything through, and that removes the first hurdle for ALL
// three actions, not just the public one.
//
// It follows necessarily: `create` and `revoke` check the JWT THEMSELVES
// (supabaseAdmin.auth.getUser below). For the other two functions the same
// check is a second safeguard; here it is the only one. Whoever removes it
// or puts it behind a condition makes `create` callable by anyone anonymous.
// The code path is therefore built so `resolve` branches off at the top and
// EVERYTHING below it runs through the identity check unconditionally, not
// as an if/else where a later branch could accidentally bypass it.
//
// ---------------------------------------------------------------------------
// The check chain of `resolve` does NOT live in this file
// ---------------------------------------------------------------------------
// It sits in resolution.ts as a pure function, together with the paging and
// the shape of the response. Reason: a test with `ignore: !stackReady` is
// indistinguishable from a passed test on a machine without Docker (the
// heaviest finding of the Phase 5 review). This handler only translates
// HTTP: method, CORS, configuration, body, identity, and the result into a
// Response.
//
// Rate limiting: the endpoint is public and accepts a 32-character hex
// token (2^128 possibilities). Rate limiting is therefore pointless; a
// dedicated limiter is deliberately NOT built here, it belongs in front of
// the function (Supabase/Cloudflare) once there is a first real deployment,
// Spec §5.1.
import { AwsClient } from 'npm:aws4fetch@1';
import {
  buildResolveResponse,
  buildMedia,
  evaluateToken,
  LINK_REJECTION,
  collectMoments,
  isTokenLengthPlausible,
} from './resolution.ts';
import { createAdminClient, createShareStore } from './store.ts';
import { computeExpiry, evaluateCreate, evaluateRevoke } from './management.ts';
import { createErrorReporter } from '../_shared/errorReporter.ts';
// The send building block lives with reveal-trip, because it originated
// there and knows nothing except the Expo push API. A second one would be a
// second place where block size, error handling, and the cleanup of
// deregistered tokens could drift apart. Cross-imports between function
// folders are established in the project (delete-account/process.ts pulls in
// media-urls/keys.ts).
import { send } from '../reveal-trip/push.ts';
import { sendSharePush } from './notification.ts';

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
const report = createErrorReporter(SENTRY_DSN, 'share-link');

// Base of the public web player (route /share/[token], plan Task 5).
// Deliberately with no default: a guessed default would produce a response
// that looks like a link and is not one. If the variable is missing,
// `create` says so loudly (500 + log) instead of handing out a broken link.
// Local in supabase/functions/.env, documented in .env.example.
const SHARE_BASE_URL = (Deno.env.get('SHARE_BASE_URL') ?? '').replace(/\/$/, '');

// Validity of the issued read URLs: one hour, like the member read path
// (media-urls, READ_URL_VALIDITY_SECONDS). One response covers an entire
// film roll, the player preloads, pauses, jumps back. After expiry the only
// way back leads through this function's check chain, which re-checks
// revoked, expires_at, and trip status.
const READ_URL_VALIDITY_SECONDS = 3600;

type RequestBody = { action?: unknown; token?: unknown; trip_id?: unknown; valid_days?: unknown };

// CORS: the public web player runs in the browser on a DIFFERENT origin
// than the Supabase instance, without these headers `resolve` would fail in
// the browser at the preflight, even though the function itself responds
// correctly. The other two Edge Functions do not need this: they are only
// called from the native app, which has no same-origin rule.
//
// `*` is correct here, not just convenient: `resolve` is open to any origin
// by design (the token IS the authorization). No credentials are sent along
// (no Access-Control-Allow-Credentials, no cookies), a foreign script can do
// nothing with it that it could not also do with its own server request.
// `create`/`revoke` get the same headers: they hang on a JWT in the
// Authorization header, which a browser never sends along on its own across
// origins.
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });
}

// Error responses are German plain text for the app, never a raw provider
// error (those only end up in the server log via console.error).
function errorResponse(message: string, status: number): Response {
  return json({ error: message }, status);
}

// The one rejection `resolve` shows to the outside. Four reasons, one
// response, see LINK_REJECTION in resolution.ts.
function linkRejection(): Response {
  return errorResponse(LINK_REJECTION.message, LINK_REJECTION.status);
}

function s3Client(): AwsClient {
  return new AwsClient({
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
    region: S3_REGION,
    service: 's3',
  });
}

function s3ConfigComplete(): boolean {
  return Boolean(S3_ENDPOINT && S3_REGION && S3_BUCKET && S3_ACCESS_KEY && S3_SECRET_KEY);
}

// The method is part of the signature: SigV4 puts it as the first line of
// the canonical request. A URL created here is therefore only good for a
// GET, a PUT against it fails with SignatureDoesNotMatch. For the public
// read path that is the guarantee that a shared link can never be
// repurposed to overwrite someone else's moments.
async function presignedGetUrl(aws: AwsClient, key: string): Promise<string> {
  const url = new URL(`${S3_ENDPOINT}/${S3_BUCKET}/${key}`);
  url.searchParams.set('X-Amz-Expires', String(READ_URL_VALIDITY_SECONDS));
  const signed = await aws.sign(url.toString(), { method: 'GET', aws: { signQuery: true } });
  return signed.url;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Preflight. Has to come BEFORE the method check, the browser sends
  // OPTIONS, not POST.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return errorResponse('Nur POST erlaubt.', 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('share-link: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are missing.');
    await report(new Error('share-link: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are missing.'));
    return errorResponse('Server nicht konfiguriert.', 500);
  }

  const supabaseAdmin = createAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const store = createShareStore(supabaseAdmin);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Ungültige Anfrage.', 400);
  }

  const action = body.action;

  // =========================================================================
  // resolve, with NO JWT. The only branch that reads no Authorization
  // header. It branches off here, BEFORE any identity check, so nothing
  // below can bypass it.
  // =========================================================================
  if (action === 'resolve') {
    const token = body.token;
    // A missing field is a caller programming error, not an invalid token,
    // so it may get its own text. An EXISTING but nonsensical token, on the
    // other hand, gets LINK_REJECTION like any unknown one, otherwise the
    // shape check itself would be a signal.
    if (typeof token !== 'string' || token.length === 0) {
      return errorResponse('token fehlt.', 400);
    }
    if (!isTokenLengthPlausible(token)) {
      return linkRejection();
    }

    const { row, trip, error: readError } = await store.fetchTokenWithTrip(token);
    if (readError) {
      console.error('share-link: share_links select failed', readError);
      // The token itself does NOT go into the report, it is the
      // authorization for a public recap, not a diagnostic value (same
      // reasoning as with signed S3 URLs in the header comment of
      // errorReporter.ts).
      await report(readError);
      // Deliberately NO 500 with its own text: a database error during the
      // token lookup would otherwise be the only way a call could be told
      // apart from any other. It gets logged and treated like an unknown
      // token on the outside.
      return linkRejection();
    }

    const verdict = evaluateToken(row, trip, new Date());
    if (!verdict.allowed) {
      return errorResponse(verdict.message, verdict.status);
    }
    // Safe: evaluateToken only returns allowed:true when neither was null
    // (see its branches 1 and 4 there).
    const tokenRow = row!;
    const tripRow = trip!;

    if (!s3ConfigComplete()) {
      console.error('share-link: S3 environment variables incomplete.');
      await report(new Error('share-link: S3 environment variables incomplete.'));
      return errorResponse('Server nicht konfiguriert.', 500);
    }

    // trip_id comes from the TOKEN ROW, never from the request body. That
    // is where promise W1 lives: a share link only shows the trip it
    // belongs to. This action's body carries nothing else besides the token
    // that would still be read here.
    const tripId = tokenRow.trip_id;

    const { rows, lost, error: postsError } = await collectMoments(
      (from, withCount) => store.fetchMomentsPage(tripId, from, withCount),
    );
    if (postsError) {
      console.error('share-link: posts select failed', postsError);
      await report(postsError, { trip_id: tripId });
      return errorResponse('Momente konnten nicht geladen werden.', 500);
    }
    if (lost > 0) {
      console.error('share-link: resolve collected fewer moments than counted.', {
        trip_id: tripId,
        lost,
      });
      await report(new Error('share-link: resolve collected fewer moments than counted.'), {
        trip_id: tripId,
        lost,
      });
    }

    // valid_until is stamped BEFORE signing. Every signature expires from
    // its own X-Amz-Date, which is never earlier than this moment, so the
    // value is conservative (never later than the real expiry).
    const validUntil = new Date(Date.now() + READ_URL_VALIDITY_SECONDS * 1000).toISOString();

    let media;
    let skipped: number;
    try {
      const aws = s3Client();
      const result = await buildMedia(tripId, rows, (key) => presignedGetUrl(aws, key));
      media = result.media;
      skipped = result.skipped + lost;
      // result.skipped counts ONLY the storage_key deviations from
      // buildMedia (resolution.ts), separate from `lost` (paging loss,
      // already reported separately above). A storage_key comparison that
      // does not match is a potential tampering or bug signal (see comment
      // in resolution.ts) and deliberately stays a single, aggregated
      // report instead of one per moment.
      if (result.skipped > 0) {
        await report(
          new Error('share-link: öffentliche Momente wegen abweichendem Pfad ausgelassen.'),
          { trip_id: tripId, count: result.skipped },
        );
      }
    } catch (err) {
      console.error('share-link: signing the read URLs failed', err);
      await report(err, { trip_id: tripId });
      return errorResponse('Signieren fehlgeschlagen.', 502);
    }

    return json(buildResolveResponse(tripRow, media, validUntil, skipped), 200);
  }

  // =========================================================================
  // From here on: sign-in required only. Because verify_jwt = false, THIS
  // check is the only one, everyone gets through at the gateway. It
  // therefore sits BEFORE the action switch: a new branch someone hangs
  // underneath it later is automatically protected.
  // =========================================================================
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return errorResponse('Nicht angemeldet.', 401);
  }

  // getUser is the authority, not the token's content: it asks GoTrue
  // whether this JWT belongs to a real person. An anon or service-role key
  // carries no `sub` and fails here, even though both are syntactically
  // valid, correctly signed JWTs. This exact difference carries the
  // function, now that the gateway no longer pre-checks.
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return errorResponse('Nicht angemeldet.', 401);
  }
  const requestingUserId = userData.user.id;

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  if (action === 'create') {
    const tripId = body.trip_id;
    if (typeof tripId !== 'string' || tripId.length === 0) {
      return errorResponse('trip_id fehlt.', 400);
    }

    const expiry = computeExpiry(body.valid_days, new Date());
    if (!expiry.ok) {
      return errorResponse(expiry.message, 400);
    }

    if (!SHARE_BASE_URL) {
      console.error('share-link: SHARE_BASE_URL is missing, without it no valid link is produced.');
      await report(new Error('share-link: SHARE_BASE_URL is missing, without it no valid link is produced.'));
      return errorResponse('Server nicht konfiguriert.', 500);
    }

    const { data: trip, error: tripError } = await store.fetchTripForCreate(tripId);
    if (tripError) {
      console.error('share-link: trips select failed', tripError);
      await report(tripError, { trip_id: tripId, user_id: requestingUserId });
      return errorResponse('Reise konnte nicht geladen werden.', 500);
    }
    // The service role writes past RLS (`rolbypassrls`),
    // share_links_insert_owner (20260808130000) never gets evaluated for
    // this insert at all. And since 20260808140000 `authenticated` no
    // longer has any write right on share_links whatsoever: THIS check is
    // the only one still enforcing "only the owner, only a revealed trip".
    // It therefore lives as a pure function in management.ts and is checked
    // there with no Docker (management_test.ts), not only in the
    // integration test.
    const createVerdict = evaluateCreate(trip, requestingUserId);
    if (!createVerdict.allowed) {
      return errorResponse(createVerdict.message, createVerdict.status);
    }

    const { token, error: insertError } = await store.createLink(tripId, expiry.expiresAt);
    if (insertError || !token) {
      console.error('share-link: share_links insert failed', insertError);
      await report(insertError, { trip_id: tripId, user_id: requestingUserId });
      return errorResponse('Link konnte nicht erstellt werden.', 500);
    }

    // The fellow travellers learn that their recap now sits behind a public
    // URL, places of the moments included. AFTER the insert, never before:
    // a notification about a link that does not exist would be worse than
    // none at all. And with `await`, so the edge runtime does not end the
    // process before the send goes out; it cannot fail, `sendSharePush`
    // never throws (reasoning there).
    await sendSharePush(store, send, createVerdict.data, requestingUserId, 'created');

    return json({ token, url: `${SHARE_BASE_URL}/share/${token}` }, 200);
  }

  // -------------------------------------------------------------------------
  // revoke
  // -------------------------------------------------------------------------
  if (action === 'revoke') {
    const token = body.token;
    if (typeof token !== 'string' || token.length === 0) {
      return errorResponse('token fehlt.', 400);
    }

    const { data: owner, error: readError } = await store.fetchTokenOwner(token);
    if (readError) {
      console.error('share-link: share_links select for revoke failed', readError);
      // Here too the token itself does NOT go into the report, see the
      // reasoning in the `resolve` branch above.
      await report(readError, { user_id: requestingUserId });
      return errorResponse('Link konnte nicht geladen werden.', 500);
    }

    // ONE response for "token does not exist" and "token belongs to someone
    // else", the reasoning and the frozen constant sit in management.ts,
    // checked with no Docker in management_test.ts.
    const revokeVerdict = evaluateRevoke(owner, requestingUserId);
    if (!revokeVerdict.allowed) {
      return errorResponse(revokeVerdict.message, revokeVerdict.status);
    }

    // Idempotent: a second revoke is not an error. The update sets revoked
    // = true, whether it was already true before or not, the app gets the
    // same response both times. Deliberately no status criterion: revoking
    // has to work on an archived trip exactly the same.
    const { error: updateError } = await store.revokeLink(token);
    if (updateError) {
      console.error('share-link: share_links update failed', updateError);
      await report(updateError, { user_id: requestingUserId });
      return errorResponse('Link konnte nicht widerrufen werden.', 500);
    }

    // The all-clear. It belongs just as much as the notification when
    // creating: whoever learned their recap was shared should also learn
    // that it no longer is, otherwise a worry lingers that no longer
    // applies.
    //
    // Also on the second, idempotent revoke. The alternative, notifying
    // only on the first, lacks a foundation: `revokeLink` sets `revoked =
    // true` with no knowledge of whether it already was, and retrofitting
    // that would mean rebuilding the path for a notification that, in the
    // worst case, says the same right thing twice.
    await sendSharePush(
      store,
      send,
      { id: revokeVerdict.data.trip_id, name: revokeVerdict.data.name },
      requestingUserId,
      'revoked',
    );

    return json({ ok: true }, 200);
  }

  return errorResponse('Unbekannte Aktion.', 400);
});
