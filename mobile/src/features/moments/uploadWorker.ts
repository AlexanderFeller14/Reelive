import { File } from 'expo-file-system';
import * as Network from 'expo-network';

import * as queueDb from './queueDb';
import * as queueLogic from './queueLogic';
import * as momentsApi from './momentsApi';
import * as media from './media';
import * as settings from './settings';
import type { QueueJob } from './types';

// The only place that changes jobs (Task-6-Brief). Every sub-step is
// persisted on its own, a crash between two steps must never repeat on the
// next run what's already been done (Spec §5, "no moment gets lost").

const INTERVAL_MS = 5_000;

// Task-13-Fix-Runde-1: a job that is waiting on network I/O while someone
// signs out (easily several seconds for a video) must not keep writing
// afterwards. start()/stop() count this generation up; every run remembers
// its own at the start, and processJob checks the generation again before
// every single write (insert, upload, update, confirmation, delete), not
// just once at the entrance, because the state can have changed between two
// await points. Fix-Runde-2 additionally captures authorship in
// QueueJob.author_id at enqueue time (see momentsApi.createMoment),
// covering the more common, race-free case a generation check alone can't
// catch.
let generation = 0;
function belongsToCurrentGeneration(myGeneration: number): boolean {
  return myGeneration === generation;
}

// Not the enum re-export (Network.NetworkStateType), but the raw string:
// getNetworkStateAsync() returns type: 'WIFI' at runtime as a string
// anyway, and that way the comparison stays independent of whatever a test
// mocks from expo-network.
const WIFI = 'WIFI';

// create table if not exists is idempotent, but doesn't need to run again
// on every 5-second tick. A failed attempt is NOT cached (no promise
// caching), otherwise the queue would stay dead for the rest of the session
// after a single init error.
let initialized = false;
async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  await queueDb.initQueue();
  initialized = true;
}

// Uploading via expo-file-system instead of fetch.
//
// The earlier version passed `{ uri }` as the fetch body and relied on
// React Native streaming the local file from it. That held for the old
// network stack; under React Native 0.86, fetch rejects that, and only at
// RUNTIME ON THE DEVICE: "TypeError: Unsupported BodyInit type". No test
// could see this, because global.fetch is mocked there and a mock accepts
// any body without complaint. Found on 2026-08-11 on an iPhone, where every
// submitted moment circled endlessly in the queue.
//
// `File.upload` is the intended way for this (SDK-57 docs) and streams the
// file natively, without reading it completely into memory first. For
// videos that's the difference between "running" and "crash due to
// memory".

// The local capture is gone (on 2026-08-13 on an iPhone: the app crashed on
// EVERY start as soon as such a job sat in the queue). `File.upload()`
// doesn't throw to JavaScript in this case, but lets a native exception
// through ("Cannot read file at file:///…/medium.jpg"), which ends the
// process with signal 6, the try/catch below never gets a chance. That's
// why it's checked beforehand. A dedicated error type, because this case is
// permanent like a rejection by the policy: a deleted file doesn't come
// back, retrying only leads into the same crash again.
export class LocalFileMissing extends Error {
  constructor(readonly uri: string) {
    super('Diese Aufnahme ist auf dem Gerät nicht mehr auffindbar.');
    this.name = 'LocalFileMissing';
  }
}

async function uploadPart(url: string, uri: string, contentType: string): Promise<void> {
  const file = new File(uri);
  if (!file.exists) throw new LocalFileMissing(uri);
  const response = await file.upload(url, {
    httpMethod: 'PUT',
    headers: { 'Content-Type': contentType },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error('Hochladen fehlgeschlagen.');
  }
}

// If it breaks off between recording and discarding, the job stays put and
// runs through here again (insert or replace makes that harmless).
async function discardJob(job: QueueJob, reason: string, myGeneration: number): Promise<void> {
  await queueDb.rememberDiscarded({
    id: job.post_id,
    trip_id: job.trip_id,
    author_id: job.author_id,
    grund: reason,
    verworfen_am: Date.now(),
  });
  if (!belongsToCurrentGeneration(myGeneration)) return;
  await queueDb.removeJob(job.id);
  media.removeMomentFiles(job.post_id);
}

async function processJob(job: QueueJob, now: number, myGeneration: number): Promise<void> {
  let current = job;
  try {
    if (!current.zeile_angelegt) {
      if (!belongsToCurrentGeneration(myGeneration)) return;
      const created = await momentsApi.createMoment(current);
      if (created.error) {
        if (created.permanentlyRejected) {
          // The trip got revealed in the meantime and captured_at lies
          // after the reveal: posts_insert_member rejects that forever
          // (Phase 1 only allows stragglers from before). Retrying never
          // helps, discard the job, record the reason, instead of retrying
          // it forever (Task-6-Brief §Step 4).
          if (!belongsToCurrentGeneration(myGeneration)) return;
          await discardJob(current, created.error, myGeneration);
          console.error(
            '[uploadWorker] moment permanently rejected by policy, job discarded',
            current.id,
            created.error
          );
          return;
        }
        throw new Error(created.error);
      }
      current = { ...current, zeile_angelegt: true };
      if (!belongsToCurrentGeneration(myGeneration)) return;
      await queueDb.updateJob(current);
    }

    const { urls, permanentlyRejected } = await momentsApi.signedUrls(current.post_id);
    if (!urls) {
      // Third permanent case (404, see momentsApi.signedUrls): the posts
      // row no longer exists server-side. Creating it again would be
      // wrong, the moment belongs to a state that no longer exists.
      if (permanentlyRejected) {
        if (!belongsToCurrentGeneration(myGeneration)) return;
        await discardJob(
          current,
          'Dieser Moment ist auf dem Server nicht mehr vorhanden.',
          myGeneration
        );
        console.error('[uploadWorker] moment vanished server-side, job discarded', current.id);
        return;
      }
      throw new Error('Signierte URLs konnten nicht geholt werden.');
    }

    if (!current.medium_geladen) {
      if (!belongsToCurrentGeneration(myGeneration)) return;
      // Content type from the storage key instead of the capture type
      // (Important 5): on iOS a video is QuickTime, not MP4. The bucket
      // checks the DECLARED type and would have accepted the wrong value
      // without complaint, permanently mislabeled objects, not fixable
      // after the upload.
      await uploadPart(
        urls.medium_url,
        current.medium_uri,
        media.contentTypeForKey(current.storage_key)
      );
      current = { ...current, medium_geladen: true };
      if (!belongsToCurrentGeneration(myGeneration)) return;
      await queueDb.updateJob(current);
    }

    if (!current.thumb_geladen) {
      if (!belongsToCurrentGeneration(myGeneration)) return;
      await uploadPart(urls.thumb_url, current.thumb_uri, 'image/jpeg');
      current = { ...current, thumb_geladen: true };
      if (!belongsToCurrentGeneration(myGeneration)) return;
      await queueDb.updateJob(current);
    }

    if (!belongsToCurrentGeneration(myGeneration)) return;
    const confirmed = await momentsApi.confirmUpload(current.post_id);
    if (confirmed.error) {
      // Final-Review, Important 4: medium_geladen/thumb_geladen used to
      // get set as soon as the PUT returned 2xx and never taken back. If
      // storage held a 0-byte or truncated object, confirm correctly
      // responded with "upload not yet complete", but the next run
      // skipped both uploads and only called confirm again. Forever,
      // every five seconds.
      if (confirmed.incomplete) {
        current = { ...current, medium_geladen: false, thumb_geladen: false };
      }
      throw new Error(confirmed.error);
    }

    // done ⇒ remove immediately instead of first persisting the state: an
    // extra update() before the delete() would be a redundant write.
    if (!belongsToCurrentGeneration(myGeneration)) return;
    await queueDb.removeJob(current.id);
    // Success path (Critical 2): first the row, then the files, in this
    // order, because a crash in between leaves at most an orphaned folder.
    // The other way around, a job would remain whose files are missing,
    // and the PUT would fail forever afterwards.
    media.removeMomentFiles(current.post_id);
  } catch (error) {
    // The failure counter is a write too: a finished generation must no
    // longer leave it behind (see comment above).
    if (!belongsToCurrentGeneration(myGeneration)) return;
    if (error instanceof LocalFileMissing) {
      await discardJob(current, error.message, myGeneration);
      console.error(
        '[uploadWorker] local capture missing, job discarded',
        current.id,
        error.uri
      );
      return;
    }
    const updated = queueLogic.afterFailure(current, now);
    await queueDb.updateJob(updated);
    console.error('[uploadWorker] job failed, will retry', current.id, error);
  }
}

// Deliberately no longer a single global flag (Task-13-Fix-Runde-2): a
// purely global flag that stop() resets (Round 1) would have allowed ANY
// overlap, including two runs of the same, still-running generation.
let runningGeneration: number | null = null;

// Exported and does exactly one select-plus-process run, that's the only
// way the loop is testable without a real timer (Task-6-Brief §Step 4).
export async function processOneJob(): Promise<void> {
  // Captured BEFORE every await of this run, which worker runtime it
  // belongs to, stop() can run in between while this run is still waiting
  // on network/SQLite (see processJob).
  const myGeneration = generation;
  if (runningGeneration === myGeneration) return;
  runningGeneration = myGeneration;
  try {
    await ensureInitialized();
    const [network, wifiOnly, jobs, currentAuthorId] = await Promise.all([
      Network.getNetworkStateAsync(),
      settings.wifiOnly(),
      queueDb.allJobs(),
      momentsApi.currentAuthorId(),
    ]);
    const onWifi = network.type === WIFI;
    const now = Date.now();
    const job = queueLogic.nextJob(jobs, now, onWifi, wifiOnly, currentAuthorId);
    if (!job) return;
    await processJob(job, now, myGeneration);
  } catch (error) {
    // Protection against a broken run (e.g. SQLite/network exception
    // BEFORE job selection): must never bring the interval loop to a halt.
    console.error('[uploadWorker] run failed', error);
  } finally {
    if (runningGeneration === myGeneration) runningGeneration = null;
  }
}

export async function enqueueJob(job: QueueJob): Promise<void> {
  await ensureInitialized();
  await queueDb.addJob(job);
}

export async function pending(): Promise<number> {
  await ensureInitialized();
  const jobs = await queueDb.allJobs();
  return queueLogic.pendingCount(jobs);
}

let intervalId: ReturnType<typeof setInterval> | null = null;
let networkSubscription: { remove: () => void } | null = null;

export function start(): void {
  if (intervalId !== null) return;
  generation += 1;
  intervalId = setInterval(() => {
    void processOneJob();
  }, INTERVAL_MS);
  networkSubscription = Network.addNetworkStateListener((state) => {
    if (state.isConnected) void processOneJob();
  });
}

export function stop(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  networkSubscription?.remove();
  networkSubscription = null;
  generation += 1;
}
