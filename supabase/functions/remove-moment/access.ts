// Who may remove a moment, as a pure function: no I/O, no client, no
// network. Pattern like media-urls/readAccess.ts, reveal-trip/reveal.ts,
// and delete-account/process.ts, and for the same reason: the decision
// something hangs on is checked with no Docker, the integration test is
// the second layer, never the only one.

export type PostRow = {
  id: string;
  trip_id: string;
  author_id: string;
  type: 'photo' | 'video';
  media_ext: string | null;
};

export type TripRow = {
  status: string;
  owner_id: string;
};

// Word for word the same as the RLS policy `posts_delete_after_reveal`
// (migration 20260803090300_sealing_rls.sql):
//
//   trip is 'revealed' AND (caller is the author OR the owner)
//
// The policy stays in place and is still checked by pgTAP. But it is no
// longer the only authority deciding, and that is why this rule sits here
// AGAIN: the function deletes the media in storage BEFORE it touches the
// row (reasoning in the handler). Were the authorization only checked at
// the DELETE, a foreign post_id could be used to make someone else's
// moment unusable: the objects would be gone, the DELETE would then fail
// at the policy, and what remained would be a row whose tiles load into
// nothing for every fellow traveller. A moderation function that can be
// used to destroy other people's moments is the opposite of moderation.
//
// Why "after the reveal": before that, the trip is sealed, nobody sees
// anyone else's moments, and there is nothing to report and nothing to
// moderate. A delete path open before the reveal would also be a channel
// through which the seal could be probed.
export function canRemove(post: PostRow, trip: TripRow, userId: string): boolean {
  if (trip.status !== 'revealed') return false;
  return post.author_id === userId || trip.owner_id === userId;
}
