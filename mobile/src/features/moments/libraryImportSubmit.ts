import * as media from './media';
import * as uploadWorker from './uploadWorker';
import { describePlace } from './placeAndTime';
import type { AcceptedMedia, PickedMedia } from './libraryImport';
import type { QueueJob } from './types';

export type ImportTarget = { tripId: string; authorId: string };
export type ImportOutcome = { submitted: number; failed: number };
export type ImportProgress = (done: number, total: number) => void;

// The queue path of preview.tsx, once per accepted element and strictly one
// after the other (memory: a photo prepare holds two re-encodes, a batch in
// parallel would stack them). A failing element costs only itself; the rest
// carries on, and the caller gets the counts for its summary.
export async function submitImports(
  accepted: AcceptedMedia[],
  target: ImportTarget,
  onProgress: ImportProgress
): Promise<ImportOutcome> {
  let submitted = 0;
  let failed = 0;
  for (const item of accepted) {
    if (await submitOne(item, target)) submitted += 1;
    else failed += 1;
    onProgress(submitted + failed, accepted.length);
  }
  return { submitted, failed };
}

async function submitOne(item: AcceptedMedia, target: ImportTarget): Promise<boolean> {
  const source = item.media.uri;
  const postId = media.newMomentId();
  let prepared: { medium: string; thumb: string } | null = null;
  try {
    prepared =
      item.media.kind === 'video' ? await media.prepareVideo(source) : await media.preparePhoto(source);
    // Durable copy BEFORE enqueuing (Final-Review, Critical 2): the picker
    // copy sits in tmp, which iOS may empty, while the queue holds moments
    // for days.
    const durable = await media.persistDurably(postId, prepared);
    const extension = media.mediaExtension(item.media.kind, prepared.medium);
    // The place comes from the element's own coordinates, never from the
    // current position: the moment was taken somewhere else.
    const place_name =
      item.lat != null && item.lng != null ? await describePlace(item.lat, item.lng) : null;
    const job: QueueJob = {
      id: postId,
      post_id: postId,
      trip_id: target.tripId,
      author_id: target.authorId,
      typ: item.media.kind,
      medium_uri: durable.medium,
      thumb_uri: durable.thumb,
      storage_key: media.storageKey(target.tripId, postId, extension),
      thumb_key: media.thumbKey(target.tripId, postId),
      caption: null,
      captured_at: item.captured_at,
      captured_tz: item.captured_tz,
      lat: item.lat,
      lng: item.lng,
      place_name,
      duration_s: item.duration_s,
      zustand: 'wartet',
      versuche: 0,
      naechster_versuch: Date.now(),
      zeile_angelegt: false,
      medium_geladen: false,
      thumb_geladen: false,
    };
    await uploadWorker.enqueueJob(job);
    media.discardFile(source);
    media.discardIntermediates(source, prepared);
    return true;
  } catch (error) {
    media.removeMomentFiles(postId);
    if (prepared) media.discardIntermediates(source, prepared);
    media.discardFile(source);
    console.error('[libraryImportSubmit] element failed', source, error);
    return false;
  }
}

// Refused elements never enter the queue, but their picker copies sit in
// tmp all the same.
export function discardRefused(refused: PickedMedia[]): void {
  for (const item of refused) media.discardFile(item.uri);
}
