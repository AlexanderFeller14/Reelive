import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, isOffline } from '@/lib/networkError';
import * as media from './media';
import type { QueueJob } from './types';

// Translates a postgrest error into a German plain-text message (DESIGN-LANGUAGE
// §6: errors explain cause and remedy). Same pattern as tripsApi/profileApi.
function message(error: { message?: string } | null, fallback: string): string {
  return isOffline(error) ? OFFLINE_HINT : fallback;
}

// functions-js wraps a genuine network error in FunctionsFetchError and
// replaces the message with a fixed English sentence ("Failed to send a
// request to the Edge Function"), isOffline() would never match that. The
// original fetch error message sits in the `context` of the exception
// though, see node_modules/@supabase/functions-js FunctionsClient. Both
// places are checked before falling back to the generic message.
function functionMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string; context?: { message?: string } } | null;
  if (isOffline({ message: err?.context?.message })) return OFFLINE_HINT;
  return message(err ?? null, fallback);
}

const PRIMARY_KEY_VIOLATION = '23505';

// RLS rejection (Postgres 42501). Unlike every other failure, retrying isn't
// worthwhile here: posts_insert_member (supabase/migrations/20260803090300_sealing_rls.sql)
// only lets stragglers through after the reveal, whose captured_at lies
// before the reveal. If it lies after, the policy permanently rejects EVERY
// attempt (Task-6-Brief, "trip gets revealed in the meantime").
//
// WARNING, Fix-Runde 1: the SQLSTATE 42501 alone ("insufficient_privilege") is
// NOT unambiguous, Postgres assigns the same code for a missing GRANT
// ("permission denied for table …") too, e.g. when a future migration adds
// another insert column without carrying the column grant from
// 20260803090600_role_hardening.sql forward. The code alone would in that
// case have deleted EVERY pending moment of EVERY user instead of retrying
// it. A second signal is needed, produced by Postgres itself (not the app):
// the RLS WITH CHECK violation ALWAYS carries exactly the text "new row
// violates row-level security policy for table …", language-independent,
// because it comes from the C code, not from a translatable format string.
// The grant message instead reads "permission denied for …". Only BOTH
// signals together (code AND this text) count as a permanent rejection.
// When in doubt: retry, don't discard, a wrongly retried job costs
// bandwidth, a wrongly deleted one a memory that will never exist again.
const RLS_REJECTION_CODE = '42501';
const RLS_REJECTION_PATTERN = /row-level security policy/i;

function isRlsRejection(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === RLS_REJECTION_CODE && RLS_REJECTION_PATTERN.test(error.message ?? '');
}

// Reads the currently active author identity from the session. Used by the
// worker BEFORE job selection (queueLogic.nextJob), so that a job whose
// stored author_id doesn't match the currently signed-in person never gets
// selected in the first place, Task-13-Fix-Runde-2. createMoment below no
// longer determines the identity itself (see there), that was the gap: it
// used to come from the session at the time of writing, not at the time of
// enqueuing.
export async function currentAuthorId(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session?.user.id ?? null;
  } catch {
    // getSession() itself can reject (e.g. storage error, see AuthProvider).
    return null;
  }
}

export async function createMoment(
  job: QueueJob
): Promise<{ error: string | null; permanentlyRejected?: boolean }> {
  // Authorship now comes from the job itself (captured when enqueuing, see
  // QueueJob.author_id and preview.tsx) instead of from the CURRENTLY active
  // session, otherwise a moment that merely sat in the queue could land
  // under the name of the next signed-in person (Task-13-Fix-Runde-2).
  // uploadWorker already only selects jobs of the currently signed-in person
  // via currentAuthorId()+nextJob, so this insert deliberately trusts the
  // stored identity.
  const { error } = await supabase.from('posts').insert({
    id: job.post_id,
    trip_id: job.trip_id,
    author_id: job.author_id,
    type: job.typ,
    // Important 5: the Edge Function derives its key from EXACTLY THIS
    // column, the client determines the extension this way, but only
    // within the check constraint from the migration, and only on insert
    // (an update on posts hasn't been available to authenticated since
    // Phase 1).
    media_ext: media.extensionFrom(job.storage_key),
    storage_key: job.storage_key,
    thumb_key: job.thumb_key,
    duration_s: job.duration_s,
    caption: job.caption,
    captured_at: job.captured_at,
    captured_tz: job.captured_tz,
    lat: job.lat,
    lng: job.lng,
    place_name: job.place_name,
  });

  if (!error) return { error: null };
  if (error.code === PRIMARY_KEY_VIOLATION) return { error: null };
  if (isRlsRejection(error)) {
    return {
      error: 'Dieser Moment wurde nach der Aufdeckung der Reise aufgenommen und kann nicht mehr eingesendet werden.',
      permanentlyRejected: true,
    };
  }
  return { error: message(error, 'Der Moment konnte nicht angelegt werden. Probier es gleich nochmal.') };
}

// The plain text the Function sends along in the body, plus its HTTP
// status. Without both, the log only shows "Edge Function returned a
// non-2xx status code", which applies equally to every conceivable cause:
// missing container, rejected policy, unknown post. On 2026-08-13 exactly
// this fuzziness cost an hour of debugging.
// Deliberately NOT `instanceof Response` (found on 2026-08-13 on the
// iPhone): the response @supabase/functions-js passes along in `context` is
// under Hermes not the same class as the global `Response`, the check
// silently failed and every HTTP error landed in the generic branch. It
// never showed up in the Jest run, because both sides use the same
// `Response` from jsdom there, the test was green, the device wasn't. What
// gets checked instead is what's actually needed: a status and a readable
// body.
type ResponseLike = {
  status: number;
  clone?: () => ResponseLike;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

function asResponse(context: unknown): ResponseLike | null {
  if (!context || typeof context !== 'object') return null;
  const candidate = context as ResponseLike;
  if (typeof candidate.status !== 'number') return null;
  if (typeof candidate.json !== 'function' && typeof candidate.text !== 'function') return null;
  return candidate;
}

// The plain text the Function sends along in the body, plus its HTTP
// status. Without both, the log only shows "Edge Function returned a
// non-2xx status code", which applies equally to every conceivable cause:
// missing container, rejected policy, unknown post. On 2026-08-13 exactly
// this fuzziness cost an hour of debugging.
async function functionPlainText(error: unknown): Promise<string> {
  const httpError = error as { message?: string; context?: unknown };
  const response = asResponse(httpError?.context);
  if (!response) return httpError?.message ?? String(error);

  const readable = typeof response.clone === 'function' ? response.clone() : response;
  try {
    if (typeof readable.json === 'function') {
      const body = (await readable.json()) as { error?: string } | null;
      if (typeof body?.error === 'string') return `${response.status} ${body.error}`;
    }
  } catch {
    // Not JSON, the raw text does the job too.
  }
  try {
    const raw = typeof response.clone === 'function' ? response.clone() : response;
    if (typeof raw.text === 'function') return `${response.status} ${await raw.text()}`;
  } catch {
    // Body already read or not readable.
  }
  return String(response.status);
}

// 404 "moment not found": the Function reads the posts row itself and finds
// none. That's final, a row that doesn't exist doesn't spontaneously
// reappear. In practice this happens when the local queue outlives a
// database state (reset of the development DB, deleted moment): the job
// carries `zeile_angelegt`, server-side there's nothing there. Without this
// distinction it would run into nothing every ten minutes until the app got
// uninstalled.
const NOT_FOUND_STATUS = 404;

export type SignedUrls = { medium_url: string; thumb_url: string };

export async function signedUrls(
  momentId: string
): Promise<{ urls: SignedUrls | null; permanentlyRejected: boolean }> {
  const { data, error } = await supabase.functions.invoke('media-urls', {
    body: { action: 'sign', post_id: momentId },
  });
  if (error || !data) {
    console.error('[momentsApi] signedUrls failed', momentId, await functionPlainText(error));
    const response = asResponse((error as { context?: unknown })?.context);
    return { urls: null, permanentlyRejected: response?.status === NOT_FOUND_STATUS };
  }
  return { urls: data as SignedUrls, permanentlyRejected: false };
}

// If the Function responds with 409, the storage has no complete object (0
// bytes or truncated, see objectSize in the Function). That's the only
// failure where RE-UPLOADING helps instead of just re-confirming, the
// worker has to be able to tell them apart (Important 4).
const INCOMPLETE_STATUS = 409;

export async function confirmUpload(
  momentId: string
): Promise<{ error: string | null; incomplete?: boolean }> {
  const { data, error } = await supabase.functions.invoke('media-urls', {
    body: { action: 'confirm', post_id: momentId },
  });
  if (error) {
    // On an HTTP error the Function sends its German plain text along in the
    // response body, which arrives via FunctionsHttpError in the `context`.
    // The response is recognized by its shape, not via `instanceof
    // Response`, see asResponse() above, the class check silently failed
    // on the device and made this whole branch unreachable.
    const response = asResponse((error as { context?: unknown })?.context);
    if (response) {
      const incomplete = response.status === INCOMPLETE_STATUS;
      try {
        const readable = typeof response.clone === 'function' ? response.clone() : response;
        const body = (await readable.json?.()) as { error?: string } | null;
        if (typeof body?.error === 'string') return { error: body.error, incomplete };
      } catch {
        // Response wasn't JSON, generic message, the status still counts.
      }
      if (incomplete) {
        return { error: 'Der Upload ist noch nicht vollständig. Er wird gleich erneut versucht.', incomplete };
      }
    }
    return { error: functionMessage(error, 'Der Upload konnte nicht bestätigt werden. Probier es gleich nochmal.') };
  }
  if (!(data as { ok?: boolean } | null)?.ok) {
    return { error: 'Der Upload konnte nicht bestätigt werden. Probier es gleich nochmal.' };
  }
  return { error: null };
}
