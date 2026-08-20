// Reactions and comments in the recap player (Task 12). `reactions`/
// `comments`, their RLS policies and grants have existed since Phase 1
// (supabase/migrations/20260803090100_content_tables.sql,
// 20260803090500_social_rls.sql), no new schema is created here, just the
// call path. Same pattern as recapApi.ts/urlPool.ts: `Loaded<T>` local (not
// exported, see the comment there), errors as German plain text via
// `message()`.
import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, isOffline } from '@/lib/networkError';
import type { Comment, Reaction } from './types';

type Loaded<T> = { data: T; error: string | null };

function message(error: { message?: string } | null, fallback: string): string {
  return isOffline(error) ? OFFLINE_HINT : fallback;
}

// Practically unreachable (the player only runs behind status ===
// 'signedIn'), but a write attempt without a session must never simply be
// swallowed, same text as preview.tsx's OHNE_SITZUNG_MELDUNG
// (Task-13-fix-round-2), kept as its own literal here for consistency
// rather than an import across feature boundaries (moments/ vs. recap/).
const NOT_SIGNED_IN_MESSAGE = 'Du bist nicht angemeldet. Melde dich an und probier es nochmal.';

// Same pattern as momentsApi.currentAuthorId: the author/reactor id comes
// from the active session, not from a parameter, both RLS policies
// (reactions_insert/comments_insert) require `user_id = auth.uid()` anyway,
// a wrongly passed value would only fail at the policy, never actually
// create rows under someone else's name. The call path stays clean
// regardless: the column itself has no default, the value must be explicit
// in the payload.
async function currentUserId(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session?.user.id ?? null;
  } catch {
    // getSession() itself can reject (e.g. a storage error).
    return null;
  }
}

export async function fetchReactions(
  postIds: string[]
): Promise<Loaded<Record<string, Reaction[]>>> {
  if (postIds.length === 0) return { data: {}, error: null };

  const { data, error } = await supabase
    .from('reactions')
    .select('post_id, user_id, emoji')
    .in('post_id', postIds)
    // Deterministic order per moment, matters among other things for the
    // "others' reactions" list in the player (first reaction first).
    .order('created_at', { ascending: true });

  if (error || !data) {
    return {
      data: {},
      error: message(error, 'Die Reaktionen konnten nicht geladen werden. Probier es gleich nochmal.'),
    };
  }

  const byMoment: Record<string, Reaction[]> = {};
  for (const row of data as Reaction[]) {
    (byMoment[row.post_id] ??= []).push(row);
  }
  return { data: byMoment, error: null };
}

const REACTION_SET_ERROR = 'Deine Reaktion konnte nicht gespeichert werden. Probier es gleich nochmal.';
const REACTION_REMOVE_ERROR = 'Deine Reaktion konnte nicht entfernt werden. Probier es gleich nochmal.';

// `reactions` has the primary key (post_id, user_id, emoji), a second tap
// on the same emoji whose first request is still in flight (or a retry
// after a network error) would otherwise make a raw INSERT fail with
// Postgres 23505 (duplicate key). `.upsert(...,
// {ignoreDuplicates: true})` turns that into a server-side "INSERT ... ON
// CONFLICT DO NOTHING": an already-present triple counts as success, not an
// error. Deliberately NOT `ignoreDuplicates: false` (the default), which
// would produce an "ON CONFLICT DO UPDATE" that requires an UPDATE
// privilege in Postgres in addition to the existing INSERT grant (see the
// Postgres docs on INSERT ... ON CONFLICT). 20260803090500_social_rls.sql
// deliberately does NOT grant that privilege ("no update policy
// intended"), with the default behaviour every second tap on the same
// emoji would fail server-side on a missing GRANT.
//
// The actual protection against a FAST double tap (two requests practically
// at once) additionally lives in the player itself (see there,
// `pendingReaktionenRef`), this `ignoreDuplicates` is the second,
// server-side safeguard for the case where two requests go out anyway
// (e.g. a retry after a timeout whose original request still arrives).
export async function setReaction(postId: string, emoji: string): Promise<{ error: string | null }> {
  const userId = await currentUserId();
  if (!userId) return { error: NOT_SIGNED_IN_MESSAGE };

  const { error } = await supabase
    .from('reactions')
    .upsert(
      { post_id: postId, user_id: userId, emoji },
      { onConflict: 'post_id,user_id,emoji', ignoreDuplicates: true }
    );
  if (error) return { error: message(error, REACTION_SET_ERROR) };
  return { error: null };
}

// Not just relying on RLS (reactions_delete_own only allows `user_id =
// auth.uid()` anyway, but a delete without a post_id/emoji filter would, if
// one relied purely on the policy, accidentally hit ALL of one's own
// reactions the moment a filter here was ever forgotten). No matching row
// (already removed, a duplicate tap) is not an error, DELETE is
// idempotent.
export async function removeReaction(postId: string, emoji: string): Promise<{ error: string | null }> {
  const userId = await currentUserId();
  if (!userId) return { error: NOT_SIGNED_IN_MESSAGE };

  const { error } = await supabase
    .from('reactions')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', userId)
    .eq('emoji', emoji);
  if (error) return { error: message(error, REACTION_REMOVE_ERROR) };
  return { error: null };
}

const COMMENT_COLUMNS = 'id, post_id, user_id, text, created_at, profiles(display_name)';
type CommentRow = Omit<Comment, 'authorName'> & { profiles: { display_name: string } | null };

// Comments of ONE moment, deliberately not bundled like fetchReactions: the
// comment panel always shows only the one currently open moment, preloading
// for all 200 moments would be pure waste.
export async function fetchComments(postId: string): Promise<Loaded<Comment[]>> {
  const { data, error } = await supabase
    .from('comments')
    .select(COMMENT_COLUMNS)
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (error || !data) {
    return {
      data: [],
      error: message(error, 'Die Kommentare konnten nicht geladen werden. Probier es gleich nochmal.'),
    };
  }

  const comments = (data as unknown as CommentRow[]).map((row) => ({
    id: row.id,
    post_id: row.post_id,
    user_id: row.user_id,
    text: row.text,
    created_at: row.created_at,
    authorName: row.profiles?.display_name ?? '',
  }));
  return { data: comments, error: null };
}

// Exported so the player can use the same value for a live character
// counter in the input field, instead of guessing it a second time.
export const COMMENT_MIN_LENGTH = 1;
export const COMMENT_MAX_LENGTH = 500;
const COMMENT_EMPTY_ERROR = 'Schreib etwas, bevor du sendest.';
const COMMENT_TOO_LONG_ERROR = `Kommentare dürfen höchstens ${COMMENT_MAX_LENGTH} Zeichen haben.`;
const COMMENT_SEND_ERROR = 'Dein Kommentar konnte nicht gesendet werden. Probier es gleich nochmal.';

// Matches the database check `char_length(text) between 1 and 500`
// (supabase/migrations/20260803090100_content_tables.sql).
export async function writeComment(postId: string, text: string): Promise<{ error: string | null }> {
  const trimmed = text.trim();
  if (trimmed.length < COMMENT_MIN_LENGTH) return { error: COMMENT_EMPTY_ERROR };
  if (trimmed.length > COMMENT_MAX_LENGTH) return { error: COMMENT_TOO_LONG_ERROR };

  const userId = await currentUserId();
  if (!userId) return { error: NOT_SIGNED_IN_MESSAGE };

  const { error } = await supabase.from('comments').insert({ post_id: postId, user_id: userId, text: trimmed });
  if (error) return { error: message(error, COMMENT_SEND_ERROR) };
  return { error: null };
}
