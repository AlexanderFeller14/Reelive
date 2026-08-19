// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

// delete-account, storage duty and privacy promise in one function. Two
// actions:
//
//   counts  -> what the deletion dialog has to show before anyone agrees
//   delete  -> the deletion itself (default when `action` is missing)
//
// ---------------------------------------------------------------------------
// Identity comes from the JWT, NEVER from the body
// ---------------------------------------------------------------------------
// Besides the action, the body carries nothing at all here, no user_id, no
// trip_id. An account can only ever delete itself, and that is not a check
// that could be forgotten: there simply is no parameter through which a
// foreign identity could come in.
//
// `verify_jwt = true` in supabase/config.toml (unlike share-link, which
// sits at false because of its public read path): this function has no
// anonymous path, so the gateway is again the first of two hurdles. The
// handler still checks itself (supabaseAdmin.auth.getUser), the anon key
// alone is not enough for that.
//
// ---------------------------------------------------------------------------
// The order does NOT live in this file
// ---------------------------------------------------------------------------
// It sits in process.ts as a pure function, together with the key
// derivation, the guard for client-written paths, and the paging. Reason:
// the most important case, "the storage step fails, so the database is not
// touched at all", is hard to produce against a running stack, and a test
// that only exists in the integration run silently skips itself on any
// machine with no Docker (the heaviest finding of the Phase 5 review).
// process_test.ts always runs.
//
// What the deletion rests on, the cascades, individually counted against
// pg_constraint (14 foreign keys in schema public):
//
//   trips.owner_id      -> profiles     RESTRICT  <- the ONLY exception.
//                                                     Hence the step "delete
//                                                     own trips" before the
//                                                     auth user.
//   profiles.id         -> auth.users   CASCADE   <- hence deleteUser is
//                                                     enough at the end
//   posts.trip_id       -> trips        CASCADE   moments of the own trips,
//                                                  from ALL authors
//   posts.author_id     -> profiles     CASCADE   own moments everywhere
//                                                  else
//   trip_members.trip_id-> trips        CASCADE
//   trip_members.user_id-> profiles     CASCADE
//   share_links.trip_id -> trips        CASCADE
//   reactions.post_id   -> posts        CASCADE   (via the posts above)
//   reactions.user_id   -> profiles     CASCADE
//   comments.post_id    -> posts        CASCADE
//   comments.user_id    -> profiles     CASCADE
//   reports.post_id     -> posts        CASCADE
//   reports.reporter_id -> profiles     CASCADE
//   push_tokens.user_id -> profiles     CASCADE
//
// That is all nine tables in public. What does NOT cascade, because there
// is no foreign key: storage.objects, the objects in the bucket. That is
// exactly what the storage step clears, and exactly why it has to run
// first.
import { AwsClient } from 'npm:aws4fetch@1';
import { performDeletion, mediaKeys, pathBelongsToUs, collectAll, type PostRow, type Step } from './process.ts';
import { createAdminClient, createAccountStore, createPersonClient, createS3Deleter } from './store.ts';
import { createErrorReporter } from '../_shared/errorReporter.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
// Same five S3 variables as media-urls/share-link (see their index.ts),
// since the Phase 6 final review this function too deletes over the S3
// protocol, no longer over the Supabase storage API (the detailed
// reasoning sits in store.ts, header comment). Same bucket name as in
// supabase/config.toml, [storage.buckets.media].
const S3_ENDPOINT = (Deno.env.get('S3_ENDPOINT') ?? '').replace(/\/$/, '');
const S3_REGION = Deno.env.get('S3_REGION') ?? '';
const S3_BUCKET = Deno.env.get('S3_BUCKET') ?? '';
const S3_ACCESS_KEY = Deno.env.get('S3_ACCESS_KEY') ?? '';
const S3_SECRET_KEY = Deno.env.get('S3_SECRET_KEY') ?? '';

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

// Spec §9 / task brief "abschluss-fix-server": a thin error reporter over
// `fetch`, no package (reasoning and privacy rules in
// _shared/errorReporter.ts). Without SENTRY_DSN a complete no-op, the
// current, unchanged state of every local environment.
const SENTRY_DSN = Deno.env.get('SENTRY_DSN') ?? '';
const report = createErrorReporter(SENTRY_DSN, 'delete-account');

type RequestBody = { action?: unknown };

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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return errorResponse('Nur POST erlaubt.', 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    console.error('delete-account: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY fehlen.');
    await report(new Error('delete-account: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY fehlen.'));
    return errorResponse('Server nicht konfiguriert.', 500);
  }

  const supabaseAdmin = createAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return errorResponse('Nicht angemeldet.', 401);
  }
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return errorResponse('Nicht angemeldet.', 401);
  }
  const requestingUserId = userData.user.id;

  // An empty body is the normal case (interface contract: `POST` with
  // `{}`). No body at all should also go through, the deletion needs no
  // input.
  let body: RequestBody = {};
  try {
    const raw = await req.text();
    if (raw.trim().length > 0) body = JSON.parse(raw) as RequestBody;
  } catch {
    return errorResponse('Ungültige Anfrage.', 400);
  }

  const action = body.action ?? 'delete';
  if (action !== 'delete' && action !== 'counts') {
    return errorResponse('Unbekannte Aktion.', 400);
  }

  // `deleteOne` is built regardless of the action (cheap, just a closure,
  // no network call), but only ever called in the `delete` path. `counts`
  // needs no S3 configuration; the check for that therefore does NOT sit
  // here, but below, right before the storage step.
  const personClient = createPersonClient(SUPABASE_URL, ANON_KEY, jwt);
  const deleteOne = createS3Deleter(s3Client(), S3_ENDPOINT, S3_BUCKET);
  const store = createAccountStore(supabaseAdmin, personClient, deleteOne);

  const { data: ownTrips, error: tripsError } = await store.fetchOwnTrips(requestingUserId);
  if (tripsError) {
    console.error('delete-account: trips-Select fehlgeschlagen', tripsError);
    await report(tripsError, { user_id: requestingUserId });
    return errorResponse('Dein Konto konnte nicht geprüft werden.', 500);
  }
  const trips = ownTrips ?? [];
  const ownTripIds = trips.map((t) => t.id);

  // -------------------------------------------------------------------------
  // counts, what the dialog has to show
  // -------------------------------------------------------------------------
  if (action === 'counts') {
    const { data: counts, error: countsError } = await store.fetchCounts(requestingUserId, ownTripIds);
    if (countsError || !counts) {
      console.error('delete-account: Zählen fehlgeschlagen', countsError);
      await report(countsError, { user_id: requestingUserId });
      return errorResponse('Die Zahlen konnten nicht ermittelt werden.', 500);
    }
    return json(counts, 200);
  }

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------
  // Only checked here, not right at the top: `counts` needs no S3
  // configuration and should therefore still work when it is missing, only
  // `delete` deletes in storage. Without this check, a misconfigured S3
  // would only surface deep inside deleteObjects as a cryptic "Invalid
  // URL" error, instead of here as a clear 500 (same pattern as
  // media-urls/share-link).
  if (!s3ConfigComplete()) {
    console.error('delete-account: S3-Umgebungsvariablen unvollständig.');
    await report(new Error('delete-account: S3-Umgebungsvariablen unvollständig.'), { user_id: requestingUserId });
    return errorResponse('Server nicht konfiguriert.', 500);
  }

  // Step 1: determine what belongs to it. COMPLETELY, before anything gets
  // deleted, a moment that slips through here is no longer findable after
  // the cascade: its path derives from the posts row, and that is gone by
  // then. Hence the paging (max_rows = 1000) and hence the function aborts
  // if anything goes missing while collecting.
  const inOwn = await collectAll<PostRow>((from, withCount) =>
    store.fetchPostsPageInTrips(ownTripIds, from, withCount)
  );
  if (inOwn.error) {
    console.error('delete-account: posts-Select (eigene Reisen) fehlgeschlagen', inOwn.error);
    await report(inOwn.error, { user_id: requestingUserId });
    return errorResponse('Deine Reisen konnten nicht gelesen werden.', 500);
  }

  const elsewhere = await collectAll<PostRow>((from, withCount) =>
    store.fetchOwnPostsPageElsewhere(requestingUserId, ownTripIds, from, withCount)
  );
  if (elsewhere.error) {
    console.error('delete-account: posts-Select (fremde Reisen) fehlgeschlagen', elsewhere.error);
    await report(elsewhere.error, { user_id: requestingUserId });
    return errorResponse('Deine Momente konnten nicht gelesen werden.', 500);
  }

  // A loss while paging is a reason to abort here, not a footnote: were the
  // deletion to continue, the overlooked objects would stay in storage
  // forever, with nobody able to derive their path anymore.
  if (inOwn.lost > 0 || elsewhere.lost > 0) {
    console.error('delete-account: beim Einsammeln der Momente sind Zeilen verlorengegangen.', {
      user_id: requestingUserId,
      in_own_trips: inOwn.lost,
      elsewhere: elsewhere.lost,
    });
    await report(new Error('delete-account: beim Einsammeln der Momente sind Zeilen verlorengegangen.'), {
      user_id: requestingUserId,
      in_own_trips: inOwn.lost,
      elsewhere: elsewhere.lost,
    });
    return errorResponse('Deine Momente konnten nicht vollständig gelesen werden. Versuch es später noch einmal.', 500);
  }

  const keys = [
    ...mediaKeys(inOwn.rows),
    ...mediaKeys(elsewhere.rows),
  ];

  // cover_key and avatar_key are client-written text columns with NO
  // derivation, the guard in process.ts only lets them through when they sit
  // under a prefix demonstrably belonging to this deletion. Today not a
  // single value fits (the only ones that exist sit in supabase/seed.sql
  // and look like 'covers/norwegen.jpg'), and no code path writes these
  // columns at all. The moment a later feature introduces an owner-bound
  // scheme, the only safe one, the deletion applies on its own. Until
  // then, such a value stays put and gets reported, instead of an account
  // deletion becoming a tool against foreign objects (the detailed
  // reasoning sits with pathBelongsToUs).
  const allowedPrefixes = [
    ...ownTripIds.map((id) => `trips/${id}/`),
    `profiles/${requestingUserId}/`,
  ];
  const unresolvedPaths: string[] = [];
  const { data: avatarKey, error: avatarError } = await store.fetchAvatarKey(requestingUserId);
  if (avatarError) {
    console.error('delete-account: profiles-Select fehlgeschlagen', avatarError);
    await report(avatarError, { user_id: requestingUserId });
    return errorResponse('Dein Profil konnte nicht gelesen werden.', 500);
  }
  // The guard decides unchanged whether the path belongs to this deletion
  // (pathBelongsToUs, detailed reasoning there). Only the target differs:
  // the avatar sits in the `avatare` bucket, not the moments' S3 bucket,
  // and therefore gets deleted below as its own storage step instead of
  // being thrown into the key list here.
  let avatarToDelete: string | null = null;
  if (pathBelongsToUs(avatarKey, allowedPrefixes)) {
    avatarToDelete = avatarKey;
  } else if (avatarKey) {
    unresolvedPaths.push(avatarKey);
  }

  for (const candidate of trips.map((t) => t.cover_key)) {
    if (candidate === null || candidate === undefined || candidate.length === 0) continue;
    if (pathBelongsToUs(candidate, allowedPrefixes)) keys.push(candidate);
    else unresolvedPaths.push(candidate);
  }
  if (unresolvedPaths.length > 0) {
    console.error(
      'delete-account: cover_key/avatar_key liegen ausserhalb der eigenen Präfixe und bleiben liegen.',
      { user_id: requestingUserId, paths: unresolvedPaths },
    );
    // Only the COUNT goes to Sentry, never the paths themselves, they stay
    // in the server log (see console.error above). A storage path is not
    // moment content, but also not a diagnostic value an external service
    // needs; the count alone is enough to recognize the pattern.
    await report(
      new Error('delete-account: cover_key/avatar_key liegen ausserhalb der eigenen Präfixe und bleiben liegen.'),
      { user_id: requestingUserId, count: unresolvedPaths.length },
    );
  }

  // Steps 2-5: the order, as a pure function over named steps. Storage
  // first and alone; only after that the database, and there strictly in
  // sequence. Since the profile picture feature there are two storage
  // locations, see process.ts/performDeletion for the reasoning why this
  // became a list instead of one composite single step.
  const storage: Step[] = [
    { name: 'storage-media', run: () => store.deleteObjects(keys) },
    // After the media: should that step already fail, everything stays put
    // regardless, and the database is not touched.
    { name: 'storage-avatar', run: () => store.deleteAvatar(avatarToDelete) },
  ];
  const database: Step[] = [
    // BEFORE the cascade and in the person's own name, otherwise the invite
    // code of every trip she was a member of rotates, tearing everyone
    // else's link out from under them (see store.ts/leaveForeignTrips).
    { name: 'leave-foreign-trips', run: () => store.leaveForeignTrips(requestingUserId, ownTripIds) },
    // Resolves the schema's only on-delete-restrict relationship.
    { name: 'delete-own-trips', run: () => store.deleteOwnTrips(ownTripIds) },
    // Last: the cascade profiles.id -> auth.users clears the rest.
    { name: 'delete-auth-user', run: () => store.deleteAuthUser(requestingUserId) },
  ];

  const result = await performDeletion(storage, database);
  if (!result.ok) {
    console.error('delete-account: Löschung abgebrochen', {
      user_id: requestingUserId,
      step: result.failedAt,
      database_touched: result.databaseTouched,
      error: result.error,
    });
    // Exactly the case from point 1 of the final review: should the
    // storage step (or a database step after it) fail, W6/W7 would
    // otherwise stay visible only in the server log. `result.error` carries
    // the actual cause here; `report()` only reads `.message` from it (see
    // errorReporter.ts), never the raw error structure.
    await report(result.error, {
      user_id: requestingUserId,
      step: result.failedAt,
      database_touched: result.databaseTouched,
    });
    // One text for both cases: whether the database was already touched or
    // not changes nothing for the person about what she should do, try
    // again. Both paths are repeatable: deleting in storage is idempotent,
    // an already-deleted trip is a no-op, and deleteUser on an
    // already-deleted user fails without breaking anything. The difference
    // lives in the log, where it belongs.
    return errorResponse('Dein Konto konnte nicht vollständig gelöscht werden. Versuch es später noch einmal.', 500);
  }

  return json({ ok: true }, 200);
});
