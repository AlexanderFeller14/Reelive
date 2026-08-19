const jobs: Record<string, unknown>[] = [];
jest.mock('../queueDb', () => ({
  initQueue: jest.fn(async () => {}),
  addJob: jest.fn(async (j: Record<string, unknown>) => { jobs.push(j); }),
  allJobs: jest.fn(async () => jobs),
  updateJob: jest.fn(async (j: Record<string, unknown>) => {
    const i = jobs.findIndex((x) => x.id === j.id);
    if (i >= 0) jobs[i] = j;
  }),
  removeJob: jest.fn(async (id: string) => {
    const i = jobs.findIndex((x) => x.id === id);
    if (i >= 0) jobs.splice(i, 1);
  }),
  // Final-Review, Important 9: a permanently discarded moment gets
  // recorded, so the app can explain it.
  rememberDiscarded: jest.fn(async () => {}),
}));
jest.mock('../momentsApi', () => ({
  createMoment: jest.fn(async () => ({ error: null })),
  signedUrls: jest.fn(async () => ({
    urls: { medium_url: 'https://s3/m', thumb_url: 'https://s3/t' },
    permanentlyRejected: false,
  })),
  confirmUpload: jest.fn(async () => ({ error: null })),
  // Task-13-Fix-Runde-2: the currently signed-in person, default matches
  // basis.author_id, individual tests override with mockResolvedValueOnce.
  currentAuthorId: jest.fn(async () => 'u1'),
}));
jest.mock('../settings', () => ({ wifiOnly: jest.fn(async () => false) }));
// Final-Review, Critical 2: the worker is the only place a job regularly
// leaves the queue, the files must go along on both paths.
jest.mock('../media', () => ({
  removeMomentFiles: jest.fn(),
  // Important 5: the content type of the PUT comes from the storage key,
  // not from the capture type (iOS videos are QuickTime, not MP4).
  contentTypeForKey: jest.fn((key: string) =>
    key.endsWith('.mov') ? 'video/quicktime' : key.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'
  ),
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, type: 'WIFI' })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

import { processOneJob, enqueueJob, start, stop, pending } from '../uploadWorker';
import * as momentsApi from '../momentsApi';
import * as queueDb from '../queueDb';
import * as media from '../media';
import * as Network from 'expo-network';
import type { QueueJob } from '../types';

const basis: QueueJob = {
  id: 'j1', post_id: 'p1', trip_id: 't1', author_id: 'u1', typ: 'photo',
  medium_uri: 'file:///m.jpg', thumb_uri: 'file:///t.jpg',
  storage_key: 'trips/t1/p1.jpg', thumb_key: 'trips/t1/p1_t.jpg',
  caption: null, captured_at: '2026-08-07T10:00:00.000Z', captured_tz: 'Europe/Zurich',
  lat: null, lng: null, place_name: null, duration_s: null,
  zustand: 'wartet', versuche: 0, naechster_versuch: 0,
  zeile_angelegt: false, medium_geladen: false, thumb_geladen: false,
};

// Uploaded via expo-file-system, not via fetch: React Native 0.86 rejects
// `{ uri }` as a fetch body (see uploadWorker.uploadPart). The fetch mock
// that used to sit here accepted any body without complaint and therefore
// never noticed that the real path doesn't even exist on the device.
const mockUpload = jest.fn(async () => ({ status: 200, body: '', headers: {} }));
const mockFileUris: string[] = [];
// On 2026-08-13 on the iPhone: if the local file is missing, `File.upload()`
// doesn't throw a JS exception that the try/catch in processJob could
// catch, but lets a native ObjC exception through ("Cannot read file at
// file:///…/medium.jpg"), and that kills the process with signal 6 before
// any JS gets a turn again. That's why the app crashed on EVERY start as
// soon as such a job sat in the queue. This mock can't reproduce the native
// crash — what's provable is only that the worker doesn't even attempt the
// upload when the file is missing. That's exactly what the tests below
// target.
const mockFile = { exists: true };
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => {
    mockFileUris.push(uri);
    return {
      upload: mockUpload,
      get exists() {
        return mockFile.exists;
      },
    };
  }),
}));
beforeEach(() => {
  jobs.length = 0;
  jest.clearAllMocks();
  mockFileUris.length = 0;
  mockFile.exists = true;
  mockUpload.mockResolvedValue({ status: 200, body: '', headers: {} });
  // jest.clearAllMocks() only resets call history, not an implementation
  // set via .mockImplementation()/.mockResolvedValue(), two tests below
  // deliberately hang createMoment on a controllable promise. Without this
  // explicit restoration it would leak into EVERY following test and hang
  // there forever (observed: timeout).
  (momentsApi.createMoment as jest.Mock).mockResolvedValue({ error: null });
  // Same reason: the shared-device tests would otherwise leave
  // 'person-a'/'person-b' behind here, and every subsequent test would no
  // longer find a matching sign-in for its u1 job. It then simply doesn't
  // run, without anything failing, which only becomes apparent when
  // checking for an effect like here instead of a rejection.
  (momentsApi.currentAuthorId as jest.Mock).mockResolvedValue('u1');
});

test('a complete run creates it, uploads both, confirms and cleans up', async () => {
  jobs.push({ ...basis });
  await processOneJob();
  expect(momentsApi.createMoment).toHaveBeenCalledTimes(1);
  expect(mockUpload).toHaveBeenCalledTimes(2);
  expect(momentsApi.confirmUpload).toHaveBeenCalledWith('p1');
  expect(queueDb.removeJob).toHaveBeenCalledWith('j1');
  // Critical 2: otherwise the medium and thumbnail of every uploaded moment
  // would stay behind forever, for video the full 30 seconds in 1080p.
  expect(media.removeMomentFiles).toHaveBeenCalledWith('p1');
});

test('a failure leaves the files in place, the next attempt needs them', async () => {
  mockUpload.mockResolvedValueOnce({ status: 500, body: '', headers: {} });
  jobs.push({ ...basis });
  await processOneJob();
  expect(media.removeMomentFiles).not.toHaveBeenCalled();
});

// Important 5: the bucket checks the DECLARED type. Uploading an iOS
// capture under video/mp4 results in a permanently mislabeled object.
test('the content type of the medium follows the storage key', async () => {
  jobs.push({ ...basis, typ: 'video', storage_key: 'trips/t1/p1.mov', duration_s: 8 });
  await processOneJob();
  const [mediumCall, thumbCall] = mockUpload.mock.calls as unknown as [
    [string, { headers: Record<string, string> }],
    [string, { headers: Record<string, string> }],
  ];
  expect(mediumCall[1].headers['Content-Type']).toBe('video/quicktime');
  // The thumbnail is always a JPEG.
  expect(thumbCall[1].headers['Content-Type']).toBe('image/jpeg');
});

// === Final-Review, Important 4: an incomplete object was a dead end ===
// medium_geladen/thumb_geladen got set as soon as the PUT returned 2xx, and
// never taken back. If storage holds a 0-byte or truncated object, confirm
// correctly responds with "upload not yet complete", but the next run
// skipped both uploads and only called confirm again. Forever, every five
// seconds.
test('reports the confirmation as incomplete, gets genuinely re-uploaded on the next attempt', async () => {
  (momentsApi.confirmUpload as jest.Mock).mockResolvedValueOnce({
    error: 'Upload ist noch nicht vollständig.',
    incomplete: true,
  });
  jobs.push({ ...basis });

  await processOneJob();

  const [stored] = jobs as unknown as QueueJob[];
  expect(stored.versuche).toBe(1);
  expect(stored.medium_geladen).toBe(false);
  expect(stored.thumb_geladen).toBe(false);
  // The posts row stays, only the uploads need to run again.
  expect(stored.zeile_angelegt).toBe(true);
  expect(queueDb.removeJob).not.toHaveBeenCalled();

  // Second run: both objects genuinely go out again.
  mockUpload.mockClear();
  stored.naechster_versuch = 0;
  await processOneJob();
  expect(mockUpload).toHaveBeenCalledTimes(2);
});

// Every OTHER failure of the confirmation (network down, Function
// unreachable) must not throw away the uploads, they're already done after
// all.
test('an ordinary confirmation failure keeps the completed uploads', async () => {
  (momentsApi.confirmUpload as jest.Mock).mockResolvedValueOnce({ error: 'Netz weg' });
  jobs.push({ ...basis });

  await processOneJob();

  const [stored] = jobs as unknown as QueueJob[];
  expect(stored.medium_geladen).toBe(true);
  expect(stored.thumb_geladen).toBe(true);
});

test('a restart does not create the row twice', async () => {
  jobs.push({ ...basis, zeile_angelegt: true, medium_geladen: true });
  await processOneJob();
  expect(momentsApi.createMoment).not.toHaveBeenCalled();
  expect(mockUpload).toHaveBeenCalledTimes(1); // only the thumbnail left
});

test('a failed upload counts up instead of losing the job', async () => {
  mockUpload.mockResolvedValueOnce({ status: 500, body: '', headers: {} });
  jobs.push({ ...basis });
  await processOneJob();
  const [stored] = jobs as unknown as QueueJob[];
  expect(stored.versuche).toBe(1);
  expect(stored.zustand).toBe('wartet');
  expect(queueDb.removeJob).not.toHaveBeenCalled();
});

test('nothing happens without a due job', async () => {
  jobs.push({ ...basis, naechster_versuch: Number.MAX_SAFE_INTEGER });
  await processOneJob();
  expect(momentsApi.createMoment).not.toHaveBeenCalled();
});

// Spec §8 / Task-6-Brief "trip gets revealed in the meantime": if
// captured_at lies after the reveal, posts_insert_member permanently
// rejects EVERY attempt (Phase 1 only allows stragglers from before),
// retrying never helps. That's different from a network error: only THIS
// rejection may throw the job out of the queue.
test('a permanent rejection by the policy does not get retried, but removed from the queue', async () => {
  (momentsApi.createMoment as jest.Mock).mockResolvedValueOnce({
    error: 'Dieser Moment wurde nach der Aufdeckung der Reise aufgenommen und kann nicht mehr eingesendet werden.',
    permanentlyRejected: true,
  });
  jobs.push({ ...basis });
  await processOneJob();
  expect(queueDb.removeJob).toHaveBeenCalledWith('j1');
  expect(momentsApi.signedUrls).not.toHaveBeenCalled();
  expect(mockUpload).not.toHaveBeenCalled();
  expect(queueDb.updateJob).not.toHaveBeenCalled();
  // Second way out of the queue, the files have to go along here too
  // (Critical 2).
  expect(media.removeMomentFiles).toHaveBeenCalledWith('p1');
});

// Spec §8: "discarded with an explanation". Until the fix wave, the worker
// deleted the job and wrote a console line, the affected person never
// learned that their capture is gone (Important 9).
test('a permanently discarded moment gets recorded with a reason before the job disappears', async () => {
  (momentsApi.createMoment as jest.Mock).mockResolvedValueOnce({
    error: 'Dieser Moment wurde nach der Aufdeckung der Reise aufgenommen und kann nicht mehr eingesendet werden.',
    permanentlyRejected: true,
  });
  jobs.push({ ...basis });

  await processOneJob();

  expect(queueDb.rememberDiscarded).toHaveBeenCalledWith({
    id: 'p1',
    trip_id: 't1',
    author_id: 'u1',
    grund:
      'Dieser Moment wurde nach der Aufdeckung der Reise aufgenommen und kann nicht mehr eingesendet werden.',
    verworfen_am: expect.any(Number),
  });
  // Order: record first, then discard. If it breaks off in between, the job
  // stays put and runs through here again, the other way around the moment
  // would be silently gone.
  const rememberCall = (queueDb.rememberDiscarded as jest.Mock).mock.invocationCallOrder[0];
  const removeCall = (queueDb.removeJob as jest.Mock).mock.invocationCallOrder[0];
  expect(rememberCall).toBeLessThan(removeCall);
});

// === The server-side vanished moment (2026-08-13) ===
// The local queue can outlive a database state: the job carries
// `zeile_angelegt`, the posts row is gone (reset of the development DB,
// deleted moment). The Function then permanently responds with 404, and
// without this distinction the job ran into nothing every ten minutes —
// seen on the device, three of them, until the app got uninstalled.
test('a server-side vanished moment gets discarded instead of retried forever', async () => {
  (momentsApi.signedUrls as jest.Mock).mockResolvedValueOnce({
    urls: null,
    permanentlyRejected: true,
  });
  jobs.push({ ...basis, zeile_angelegt: true });

  await processOneJob();

  expect(mockUpload).not.toHaveBeenCalled();
  expect(queueDb.removeJob).toHaveBeenCalledWith('j1');
  expect(queueDb.rememberDiscarded).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'p1', grund: expect.stringContaining('nicht mehr vorhanden') })
  );
  expect(media.removeMomentFiles).toHaveBeenCalledWith('p1');
});

// The boundary everything hinges on: an ordinary failure fetching the URLs
// (server down, network down) is NOT permanent and must not cost the
// moment.
test('a retryable failure fetching the URLs keeps the job', async () => {
  (momentsApi.signedUrls as jest.Mock).mockResolvedValueOnce({
    urls: null,
    permanentlyRejected: false,
  });
  jobs.push({ ...basis, zeile_angelegt: true });

  await processOneJob();

  expect(queueDb.removeJob).not.toHaveBeenCalled();
  expect(queueDb.rememberDiscarded).not.toHaveBeenCalled();
  expect(jobs[0].versuche).toBe(1);
});

// === The missing local file (2026-08-13, crash on the iPhone) ===
// Without this check, the job went into `File.upload()` and took the app
// down with it (see mock above). Retrying never helps: a deleted capture
// doesn't come back, otherwise the job would run into the same crash again
// on every app start until the app got uninstalled.
test('if the local capture is missing, it does not even attempt to upload', async () => {
  mockFile.exists = false;
  jobs.push({ ...basis, zeile_angelegt: true });

  await processOneJob();

  expect(mockUpload).not.toHaveBeenCalled();
  expect(queueDb.removeJob).toHaveBeenCalledWith('j1');
});

// Spec §8: "discarded with an explanation" — the same promise as for the
// rejection by the policy, it applies equally here: the moment is gone, and
// the affected person mustn't only notice that from the missing post in
// the recap.
test('the missing capture gets recorded with a reason before the job disappears', async () => {
  mockFile.exists = false;
  jobs.push({ ...basis, zeile_angelegt: true });

  await processOneJob();

  expect(queueDb.rememberDiscarded).toHaveBeenCalledWith({
    id: 'p1',
    trip_id: 't1',
    author_id: 'u1',
    grund: expect.stringContaining('nicht mehr'),
    verworfen_am: expect.any(Number),
  });
  const rememberCall = (queueDb.rememberDiscarded as jest.Mock).mock.invocationCallOrder[0];
  const removeCall = (queueDb.removeJob as jest.Mock).mock.invocationCallOrder[0];
  expect(rememberCall).toBeLessThan(removeCall);
});

// The thumbnail counts just the same: if the medium is still there but the
// preview image isn't, the second PUT failed on the same native exception.
test('a missing preview image also leads to discarding instead of a crash', async () => {
  jobs.push({ ...basis, zeile_angelegt: true, medium_geladen: true });
  mockFile.exists = false;

  await processOneJob();

  expect(mockUpload).not.toHaveBeenCalled();
  expect(queueDb.removeJob).toHaveBeenCalledWith('j1');
});

// An ordinary failure is not a rejection, it gets retried and must not be
// reported to anyone (Spec §8: upload errors stay invisible as long as the
// queue retries them).
test('a retryable failure does NOT get reported as discarded', async () => {
  mockUpload.mockResolvedValueOnce({ status: 500, body: '', headers: {} });
  jobs.push({ ...basis });
  await processOneJob();
  expect(queueDb.rememberDiscarded).not.toHaveBeenCalled();
});

test('enqueueJob puts the job in the queue', async () => {
  const queued: QueueJob = { ...basis, id: 'neu', post_id: 'p-neu' };
  await enqueueJob(queued);
  expect(queueDb.addJob).toHaveBeenCalledWith(queued);
  expect(jobs).toContainEqual(queued);
});

test('pending counts everything that is not done yet', async () => {
  jobs.push({ ...basis, id: 'a', zustand: 'wartet' }, { ...basis, id: 'b', zustand: 'fertig' });
  await expect(pending()).resolves.toBe(1);
});

test('start() is idempotent, stop() cleans up the interval and network listener', () => {
  jest.useFakeTimers();
  try {
    const remove = jest.fn();
    (Network.addNetworkStateListener as jest.Mock).mockReturnValue({ remove });

    start();
    start(); // second call must not create a second subscription
    expect(Network.addNetworkStateListener).toHaveBeenCalledTimes(1);

    stop();
    stop(); // second call must not unsubscribe again
    expect(remove).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

// Task-13-Fix-Runde-1: postsApi.momentAnlegen() only reads the authorship
// from the currently active session AT CALL TIME (not when enqueuing). If A
// signs out and B signs in on the same device while a job is still waiting
// on the network response (for a video easily several seconds), the
// capture must not get written afterwards, under whoever's session. The
// test builds exactly this moment: createMoment hangs, stop() happens in
// between, only THEN does the network response resolve.
test('a job stuck mid-write when signing out no longer writes anything afterwards', async () => {
  jobs.push({ ...basis });
  let resolveCreateMoment: (v: { error: string | null }) => void = () => {};
  let createMomentCalled: () => void = () => {};
  const wasCalled = new Promise<void>((resolve) => {
    createMomentCalled = resolve;
  });
  (momentsApi.createMoment as jest.Mock).mockImplementation(() => {
    createMomentCalled();
    return new Promise((resolve) => {
      resolveCreateMoment = resolve;
    });
  });

  start();
  const run = processOneJob();
  await wasCalled; // now hangs in createMoment, exactly the moment described by the review
  stop(); // signing out during the upload

  resolveCreateMoment({ error: null }); // the network response does come back after all now
  await run;

  // createMoment was still triggered under the valid (old) generation,
  // that's correct. But the result must no longer get persisted after
  // that: no posts_angelegt update, no removal from the queue.
  expect(momentsApi.createMoment).toHaveBeenCalledTimes(1);
  expect(queueDb.updateJob).not.toHaveBeenCalled();
  expect(queueDb.removeJob).not.toHaveBeenCalled();
});

// A still-winding-down, outdated run must not block an immediately
// following start() (e.g. switching to another person on the same
// device), the mutex hangs off the generation, not off a single global
// flag (Task-13-Fix-Runde-2).
test('a new run after stop() is not blocked by a still-winding-down old one (different generation)', async () => {
  jobs.push({ ...basis });
  let resolveCreateMoment: (v: { error: string | null }) => void = () => {};
  let createMomentCalled: () => void = () => {};
  const wasCalled = new Promise<void>((resolve) => {
    createMomentCalled = resolve;
  });
  (momentsApi.createMoment as jest.Mock).mockImplementation(() => {
    createMomentCalled();
    return new Promise((resolve) => {
      resolveCreateMoment = resolve;
    });
  });

  start();
  const firstRun = processOneJob();
  await wasCalled; // running === true, hangs in createMoment
  stop();

  jobs.length = 0; // otherwise the second run would pick up the same job again
  await processOneJob(); // must NOT pass as a no-op
  expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(2);

  resolveCreateMoment({ error: null }); // cleanly resolve the first run
  await firstRun;
});

// Task-13-Fix-Runde-2, THE DECISIVE CASE: no race, no concurrency at all. A
// moment merely sits in the queue (zustand: 'wartet', long due), nobody is
// mid-write. A signs out, B signs in, and ONLY AFTERWARDS does the next
// regular tick run, entirely under B's valid, fresh session. The generation
// check from Round 1 passes here TRIVIALLY (the generation compares itself
// to itself), only the author_id filter in nextJob (via currentAuthorId)
// prevents A's moment from being written under B's name.
test('a job that merely sits in the queue does NOT get written under a different, meanwhile signed-in person', async () => {
  jobs.push({ ...basis, author_id: 'person-a' });
  // No signing-out-mid-write needed: currentAuthorId() already returns
  // "person-b" on the first (and only) call, a simple, later tick.
  (momentsApi.currentAuthorId as jest.Mock).mockResolvedValue('person-b');

  await processOneJob();

  expect(momentsApi.createMoment).not.toHaveBeenCalled();
  expect(queueDb.updateJob).not.toHaveBeenCalled();
  expect(queueDb.removeJob).not.toHaveBeenCalled();
  // The job stays unchanged and pending, no failure counted.
  const [unchanged] = jobs as unknown as QueueJob[];
  expect(unchanged.versuche).toBe(0);
  expect(unchanged.zustand).toBe('wartet');
});

test('the same pending job runs through as soon as the matching person signs in again', async () => {
  jobs.push({ ...basis, author_id: 'person-a' });
  (momentsApi.currentAuthorId as jest.Mock).mockResolvedValue('person-a');

  await processOneJob();

  expect(momentsApi.createMoment).toHaveBeenCalledTimes(1);
  expect(queueDb.removeJob).toHaveBeenCalledWith('j1');
});

// On a shared device, jobs of several people may be pending, only the one
// matching the currently signed-in person gets processed, the other stays
// untouched.
test('on a shared device, only the job of the currently signed-in person gets processed', async () => {
  jobs.push(
    { ...basis, id: 'von-a', post_id: 'p-a', author_id: 'person-a' },
    { ...basis, id: 'von-b', post_id: 'p-b', author_id: 'person-b' }
  );
  (momentsApi.currentAuthorId as jest.Mock).mockResolvedValue('person-b');

  await processOneJob();

  expect(momentsApi.createMoment).toHaveBeenCalledTimes(1);
  expect(queueDb.removeJob).toHaveBeenCalledWith('von-b');
  expect(jobs.some((j) => j.id === 'von-a')).toBe(true); // left untouched
});

// Which file gets uploaded used to only sit in the fetch body (`{ uri }`)
// before the rebuild and wasn't checked by any test. Now the File
// constructor decides that, and a mix-up of medium and thumbnail wouldn't
// be visible from outside: both uploads went through, the recap afterwards
// showed two preview images or the full image twice.
test('exactly the job’s two files get uploaded, medium first', async () => {
  jobs.push({ ...basis });
  await processOneJob();

  expect(mockFileUris).toEqual(['file:///m.jpg', 'file:///t.jpg']);
});
