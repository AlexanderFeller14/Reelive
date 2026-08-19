// Deliberately mirrors mobile/src/features/moments/media.ts: the client
// needs the keys before the insert, this function does not trust it and
// re-derives them.
//
// Phase-4 final review, Important 5: the extension comes from
// posts.media_ext, i.e. from the row this function read itself, never from
// the request body. `expo-camera` records QuickTime (.mov) on iOS and .mp4
// on Android; without this distinction the iOS bytes would sit permanently
// under `.mp4` with content type video/mp4 in storage, and the key is
// immutable per moment.
//
// The list here is the second safeguard next to the check constraint from
// 20260807100000_post_media_ext.sql: anything not listed falls back to the
// default for the capture type. That way even a later-loosened constraint
// cannot smuggle a foreign path component past this function.
const ALLOWED_EXTENSIONS: Record<'photo' | 'video', readonly string[]> = {
  photo: ['jpg'],
  video: ['mp4', 'mov'],
};
const DEFAULT_EXTENSION: Record<'photo' | 'video', string> = { photo: 'jpg', video: 'mp4' };

// ---------------------------------------------------------------------------
// WARNING before anyone changes anything here: this is no longer a
// convenience helper, it is the STORAGE FORMAT.
// ---------------------------------------------------------------------------
// Since Phase 5 the `read` action also derives its path through here,
// instead of taking posts.storage_key as given (reasoning in index.ts). That
// makes this function the only place that knows where the bytes live, for
// ALL already-uploaded moments, retroactively.
//
// A change to the prefix, extension, or thumb suffix therefore invalidates
// every stored object: the rows keep pointing at the old path, the
// derivation at a new one, and `read` leaves out every affected moment (the
// comparison in index.ts catches it). This is not a data migration, it is a
// rename inside the bucket, for every object, before the new version goes
// live.
//
// Whoever really needs to change the scheme needs three things: the rename
// in storage, a rewrite of posts.storage_key/thumb_key, and a plan for the
// time in between (reading both schemes in parallel). Without that, the
// recap of every past trip comes back empty.
// ---------------------------------------------------------------------------
export function expectedKeys(
  tripId: string,
  postId: string,
  mediaType: 'photo' | 'video',
  mediaExt?: string | null,
): { storage_key: string; thumb_key: string } {
  const candidate = (mediaExt ?? '').toLowerCase();
  const ext = ALLOWED_EXTENSIONS[mediaType].includes(candidate) ? candidate : DEFAULT_EXTENSION[mediaType];
  return {
    storage_key: `trips/${tripId}/${postId}.${ext}`,
    // Thumbnails are always generated locally as JPEG (Spec §4), regardless
    // of the container the medium itself uses.
    thumb_key: `trips/${tripId}/${postId}_t.jpg`,
  };
}
