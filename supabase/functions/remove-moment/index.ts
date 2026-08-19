// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

// remove-moment: delete a single moment, ALONG WITH its media.
//
// ---------------------------------------------------------------------------
// Why this function exists
// ---------------------------------------------------------------------------
// Until now the client deleted the posts row directly
// (`supabase.from('posts').delete()`, features/recap/reportApi.ts). That
// removed the row, but the two objects in storage stayed put: the medium
// and its thumbnail. Afterwards nobody knows their path anymore, since it
// derives from the deleted row. They sit in the bucket forever and cost
// money, invisibly. For a moderation action it is additionally the
// opposite of what the action promises: the reported content disappears
// from the app, but not from storage.
//
// A client cannot do this itself: deleting objects requires the S3
// credentials, and those never belong in an app.
//
// ---------------------------------------------------------------------------
// Order: storage first, database after
// ---------------------------------------------------------------------------
// Same order and same reasoning as in delete-account/process.ts: an object
// with no database row is garbage nobody finds again. A row with no object
// is a tile that loads into nothing, but a second attempt cleans it up
// (deleting in storage is idempotent, an already-deleted key is not an
// error). Of the two failure directions, the first is the worse one,
// because it is invisible and irreversible.
//
// For a moderation action a second argument comes in: should the run abort
// after the storage step, the reported content is already no longer
// retrievable. That is the better intermediate state.
//
// And from this follows the check BEFORE the storage step (access.ts):
// were authorization only checked at the DELETE, a foreign post_id could be
// used to make someone else's moment unusable.
//
// ---------------------------------------------------------------------------
// The paths are DERIVED, never taken from the row
// ---------------------------------------------------------------------------
// `posts.storage_key` is client-written (see media-urls/keys.ts). A path
// taken from the column would turn this function into a tool for deleting
// arbitrary foreign objects: whoever writes a foreign path into the column
// while submitting and then removes their own moment would take the
// foreign object down with it. `expectedKeys` derives from trip_id, post_id,
// and type, exactly like media-urls, share-link, and delete-account.
import { AwsClient } from 'npm:aws4fetch@1';
import { createClient } from '@supabase/supabase-js';
import { expectedKeys } from '../media-urls/keys.ts';
import { createS3Deleter } from '../delete-account/store.ts';
import { canRemove, type PostRow, type TripRow } from './access.ts';
import { createErrorReporter } from '../_shared/errorReporter.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// Same five S3 variables as media-urls, share-link, and delete-account.
const S3_ENDPOINT = (Deno.env.get('S3_ENDPOINT') ?? '').replace(/\/$/, '');
const S3_REGION = Deno.env.get('S3_REGION') ?? '';
const S3_BUCKET = Deno.env.get('S3_BUCKET') ?? '';
const S3_ACCESS_KEY = Deno.env.get('S3_ACCESS_KEY') ?? '';
const S3_SECRET_KEY = Deno.env.get('S3_SECRET_KEY') ?? '';

const SENTRY_DSN = Deno.env.get('SENTRY_DSN') ?? '';
const report = createErrorReporter(SENTRY_DSN, 'remove-moment');

// ONE rejection for "does not exist" and for "you may not", byte-identical.
// Same stance as the four rejections of share-link/resolve: a function that
// tells the two apart answers the question "does this moment exist?" for
// any id, and that is information nobody who is not allowed to see it is
// owed.
const REJECTION = 'Dieser Moment lässt sich nicht entfernen.';

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(message: string, status: number): Response {
  return json({ error: message }, status);
}

function s3ConfigComplete(): boolean {
  return Boolean(S3_ENDPOINT && S3_REGION && S3_BUCKET && S3_ACCESS_KEY && S3_SECRET_KEY);
}

type RequestBody = { post_id?: unknown };

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return errorResponse('Nur POST erlaubt.', 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('remove-moment: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen.');
    await report(new Error('remove-moment: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen.'));
    return errorResponse('Server nicht konfiguriert.', 500);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Identity comes from the JWT, never from the body. `verify_jwt = true`
  // at the gateway is the first hurdle, this here the second: the anon key
  // alone satisfies the gateway, not this check.
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return errorResponse('Nicht angemeldet.', 401);

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt);
  if (userError || !userData?.user) return errorResponse('Nicht angemeldet.', 401);
  const requestingUserId = userData.user.id;

  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return errorResponse('Ungültige Anfrage.', 400);
  }
  const postId = typeof body.post_id === 'string' ? body.post_id.trim() : '';
  if (!postId) return errorResponse('post_id fehlt.', 400);

  if (!s3ConfigComplete()) {
    console.error('remove-moment: S3-Umgebungsvariablen unvollständig.');
    await report(new Error('remove-moment: S3-Umgebungsvariablen unvollständig.'), {
      user_id: requestingUserId,
    });
    return errorResponse('Server nicht konfiguriert.', 500);
  }

  // Read with the ADMIN client, not the person's own: the rule lives in
  // access.ts and is applied here, RLS on SELECT answers a different
  // question (who may SEE the moment) and does not line up with the one
  // that matters here. The admin client sees everything, so the rule has
  // to be complete, and that is exactly why it sits as a pure function
  // right next door.
  const { data: post, error: postError } = await supabaseAdmin
    .from('posts')
    .select('id, trip_id, author_id, type, media_ext')
    .eq('id', postId)
    .maybeSingle<PostRow>();
  if (postError) {
    console.error('remove-moment: posts-Select fehlgeschlagen', postError);
    await report(postError, { user_id: requestingUserId });
    return errorResponse('Der Moment konnte nicht geprüft werden.', 500);
  }
  // No dedicated 404: see REJECTION.
  if (!post) return errorResponse(REJECTION, 403);

  const { data: trip, error: tripError } = await supabaseAdmin
    .from('trips')
    .select('status, owner_id')
    .eq('id', post.trip_id)
    .maybeSingle<TripRow>();
  if (tripError) {
    console.error('remove-moment: trips-Select fehlgeschlagen', tripError);
    await report(tripError, { user_id: requestingUserId });
    return errorResponse('Der Moment konnte nicht geprüft werden.', 500);
  }
  if (!trip || !canRemove(post, trip, requestingUserId)) {
    return errorResponse(REJECTION, 403);
  }

  // Step 1: storage. Both objects, derived, never taken from the row.
  const { storage_key, thumb_key } = expectedKeys(
    post.trip_id,
    post.id,
    post.type,
    post.media_ext,
  );
  const deleteOne = createS3Deleter(
    new AwsClient({
      accessKeyId: S3_ACCESS_KEY,
      secretAccessKey: S3_SECRET_KEY,
      region: S3_REGION,
      service: 's3',
    }),
    S3_ENDPOINT,
    S3_BUCKET,
  );
  for (const key of [storage_key, thumb_key]) {
    const result = await deleteOne(key);
    if (!result.ok) {
      // The database stays untouched. A second attempt runs through cleanly,
      // because an already-deleted key is not an error.
      console.error('remove-moment: S3-DELETE fehlgeschlagen', result.status);
      await report(result.error ?? new Error(`S3 DELETE: HTTP ${result.status}`), {
        user_id: requestingUserId,
      });
      return errorResponse('Der Moment konnte nicht entfernt werden. Probier es gleich nochmal.', 502);
    }
  }

  // Step 2: the row. Reactions, comments, and reports hang off it via a
  // foreign key with ON DELETE CASCADE and go with it.
  const { error: deleteError } = await supabaseAdmin.from('posts').delete().eq('id', postId);
  if (deleteError) {
    console.error('remove-moment: posts-Delete fehlgeschlagen', deleteError);
    await report(deleteError, { user_id: requestingUserId });
    return errorResponse('Der Moment konnte nicht entfernt werden. Probier es gleich nochmal.', 500);
  }

  return json({ removed: true }, 200);
});
