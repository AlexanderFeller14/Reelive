import * as media from './media';
import * as uploadWorker from './uploadWorker';
import { describePlace } from './placeAndTime';
import { ensureH264 } from './videoExport';
import type { AcceptedMedia, PickedMedia } from './libraryImport';
import type { QueueJob } from './types';

export type ImportTarget = { tripId: string; authorId: string };
export type ImportOutcome = { submitted: number; failed: number };
export type ImportProgress = (done: number, total: number) => void;

// What one element is doing right now, for the review screen's tiles
// (spec 2026-08-28-fotos-import-pruefung): the H.264 export with its
// progress, the local preparation, and the outcome.
export type ImportItemEvent =
  | { stage: 'converting'; progress: number }
  | { stage: 'preparing' }
  | { stage: 'done' }
  | { stage: 'failed' };
export type ImportItemListener = (index: number, event: ImportItemEvent) => void;

// The queue path of preview.tsx, once per accepted element and strictly one
// after the other (memory: a photo prepare holds two re-encodes, a batch in
// parallel would stack them). A failing element costs only itself; the rest
// carries on, and the caller gets the counts for its summary.
export async function submitImports(
  accepted: AcceptedMedia[],
  target: ImportTarget,
  onProgress: ImportProgress,
  onItem: ImportItemListener = () => {}
): Promise<ImportOutcome> {
  let submitted = 0;
  let failed = 0;
  for (const [index, item] of accepted.entries()) {
    const ok = await submitOne(item, target, (event) => onItem(index, event));
    if (ok) submitted += 1;
    else failed += 1;
    onProgress(submitted + failed, accepted.length);
  }
  return { submitted, failed };
}

async function submitOne(
  item: AcceptedMedia,
  target: ImportTarget,
  report: (event: ImportItemEvent) => void
): Promise<boolean> {
  const source = item.media.uri;
  const postId = media.newMomentId();
  let prepared: { medium: string; thumb: string } | null = null;
  // The H.264 export, when one happened: an intermediate the batch owns,
  // released with the other intermediates (success) or by hand (failure
  // before `prepared` exists).
  let converted: string | null = null;
  try {
    if (item.media.kind === 'video') {
      // Library videos arrive as the picker copied them (HEVC on modern
      // iPhones); the export makes them playable in the web player. Camera
      // clips and older videos are H.264 already and pass straight through.
      const result = await ensureH264(source, (progress) => report({ stage: 'converting', progress }));
      if (result.converted) converted = result.uri;
      report({ stage: 'preparing' });
      prepared = await media.prepareVideo(result.uri);
    } else {
      report({ stage: 'preparing' });
      prepared = await media.preparePhoto(source);
    }
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
    // Releases the export and the still frame: both differ from `source`.
    media.discardIntermediates(source, prepared);
    report({ stage: 'done' });
    return true;
  } catch (error) {
    media.removeMomentFiles(postId);
    if (prepared) media.discardIntermediates(source, prepared);
    else if (converted) media.discardFile(converted);
    media.discardFile(source);
    console.error('[libraryImportSubmit] element failed', source, error);
    report({ stage: 'failed' });
    return false;
  }
}

// Refused elements never enter the queue, but their picker copies sit in
// tmp all the same.
export function discardRefused(refused: PickedMedia[]): void {
  for (const item of refused) media.discardFile(item.uri);
}
