// Reporting and moderation (Task 8, Phase 6). Schema, RLS and grants have
// existed since Phase 1 resp. Task 1 of this phase, no new schema is
// created here, just the call path (same pattern as socialApi.ts):
//
//   reports (id, post_id, reporter_id, reason 1–500, created_at, erledigt_am)
//   - reports_insert:        every member, only in their own name, only
//                             what can_see_post allows (20260803090500_social_rls.sql)
//   - reports_select_owner:  only the owning person of the trip
//   - reports_update_owner:  only the owning person, and ONLY the column
//                             erledigt_am (column grant,
//                             20260808120000_reports_erledigt.sql), an
//                             update that sets erledigt_am AND another
//                             column at the same time fails as a WHOLE.
//                             This file therefore never sets anything but
//                             erledigt_am in the same call in dismissReport().
//   - posts_delete_after_reveal: after the reveal, the owning person may
//                             delete ANY moment, not just their own
//                             (20260803090300_sealing_rls.sql), moderation.
//                             reports.post_id → posts is ON DELETE CASCADE:
//                             a removed moment takes its report(s) with it
//                             automatically, this file never needs to
//                             acknowledge them separately.
import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, istOffline } from '@/lib/networkError';

type Loaded<T> = { data: T; error: string | null };

function message(error: { message?: string } | null, fallback: string): string {
  return istOffline(error) ? OFFLINE_HINT : fallback;
}

// Same pattern as socialApi.currentUserId: the reporter_id comes from the
// active session, never from a parameter, reports_insert requires
// reporter_id = auth.uid() anyway, a wrongly passed value would only fail
// at the policy, never actually create a report under someone else's name.
async function currentUserId(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

const NOT_SIGNED_IN_MESSAGE = 'Du bist nicht angemeldet. Melde dich an und probier es nochmal.';

// Matches the database check `char_length(reason) between 1 and 500`
// (20260803090100_content_tables.sql), checked BEFORE sending (brief,
// verbatim) so nobody runs into the raw Postgres error. Same trimming
// principle as COMMENT_MIN_LENGTH/-MAX_LENGTH in socialApi.ts: leading/
// trailing whitespace counts neither for the check nor for storage.
export const REPORT_MIN_LENGTH = 1;
export const REPORT_MAX_LENGTH = 500;
const REPORT_EMPTY_ERROR = 'Beschreib kurz, worum es geht, bevor du meldest.';
const REPORT_TOO_LONG_ERROR = `Deine Begründung darf höchstens ${REPORT_MAX_LENGTH} Zeichen haben.`;
const REPORT_SEND_ERROR = 'Deine Meldung konnte nicht gesendet werden. Probier es gleich nochmal.';

// Reports a moment. The moment itself stays visible unchanged, reporting is
// not hiding (brief, verbatim); only the owning person decides that, via
// dismissReport()/removeMoment() below.
export async function reportMoment(momentId: string, reason: string): Promise<{ error: string | null }> {
  const trimmed = reason.trim();
  if (trimmed.length < REPORT_MIN_LENGTH) return { error: REPORT_EMPTY_ERROR };
  if (trimmed.length > REPORT_MAX_LENGTH) return { error: REPORT_TOO_LONG_ERROR };

  const userId = await currentUserId();
  if (!userId) return { error: NOT_SIGNED_IN_MESSAGE };

  const { error } = await supabase
    .from('reports')
    .insert({ post_id: momentId, reporter_id: userId, reason: trimmed });
  if (error) return { error: message(error, REPORT_SEND_ERROR) };
  return { error: null };
}

export type Report = {
  id: string;
  post_id: string;
  reason: string;
  created_at: string;
};

const REPORTS_LOAD_ERROR = 'Die Meldungen konnten nicht geladen werden. Probier es gleich nochmal.';

// `posts!inner(trip_id)`: reports itself carries no trip_id, only post_id.
// PostgREST needs the `!inner` so the subsequent `.eq('posts.trip_id', …)`
// filter on the embedded table actually narrows down the outer reports
// rows (a normal embed, not marked as inner, doesn't filter the result list
// itself).
export async function fetchReports(tripId: string): Promise<Loaded<Report[]>> {
  const { data, error } = await supabase
    .from('reports')
    .select('id, post_id, reason, created_at, posts!inner(trip_id)')
    .eq('posts.trip_id', tripId)
    .is('erledigt_am', null)
    .order('created_at', { ascending: true });

  if (error || !data) {
    return { data: [], error: message(error, REPORTS_LOAD_ERROR) };
  }

  const reports = (
    data as unknown as { id: string; post_id: string; reason: string; created_at: string }[]
  ).map((row) => ({
    id: row.id,
    post_id: row.post_id,
    reason: row.reason,
    created_at: row.created_at,
  }));
  return { data: reports, error: null };
}

const RESOLVE_ERROR = 'Die Meldung konnte nicht verworfen werden. Probier es gleich nochmal.';

// The column grant (see file header comment) makes an update that also
// touches reason or post_id fail completely, this call must therefore never
// be merged with a second field.
export async function dismissReport(reportId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('reports')
    .update({ erledigt_am: new Date().toISOString() })
    .eq('id', reportId);
  if (error) return { error: message(error, RESOLVE_ERROR) };
  return { error: null };
}

const REMOVE_ERROR = 'Der Moment konnte nicht entfernt werden. Probier es gleich nochmal.';

// Goes through the edge function, not `from('posts').delete()` anymore. The
// direct path only deleted the row; the medium and its thumbnail stayed in
// storage forever, and afterwards nobody knew their path anymore, since it
// derives from the deleted row. For a moderation action that's the opposite
// of what the action promises: the reported content disappears from the
// app, but not from storage.
//
// Deleting from storage needs the S3 credentials, and those never belong in
// an app. The function checks the same rule that also enforces
// `posts_delete_after_reveal` (supabase/functions/moment-entfernen/
// zugriff.ts), and does so BEFORE the storage step.
export async function removeMoment(momentId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.functions.invoke('moment-entfernen', {
    body: { post_id: momentId },
  });
  if (!error) return { error: null };

  const httpError = error as { name?: string; context?: unknown };
  if (httpError?.name === 'FunctionsHttpError' && httpError.context instanceof Response) {
    const response = httpError.context;
    try {
      const body = (await response.clone().json()) as { fehler?: string };
      if (typeof body.fehler === 'string' && body.fehler.length > 0) return { error: body.fehler };
    } catch {
      // Antwort war kein JSON, generische Meldung unten.
    } finally {
      // The clone was read, the original wasn't, and an unread response
      // body keeps its stream open. That's invisible on the device, but not
      // in a test run: Jest reported a worker afterwards that didn't shut
      // down cleanly. Same cleanup as in konto-loeschen/store.ts (`await
      // antwort.body?.cancel()`).
      void response.body?.cancel().catch(() => {});
    }
  }
  const raw = error as { message?: string; context?: { message?: string } } | null;
  if (istOffline({ message: raw?.context?.message }) || istOffline(raw ?? null)) {
    return { error: OFFLINE_HINT };
  }
  return { error: REMOVE_ERROR };
}
