// Web version of queueDb: no real database, so no SQLite mock needed. Only
// tests the contract that uploadWorker.ts, counter.ts, and
// reise/[id]/index.tsx expect via the namespace import (see queueDb.web.ts).
import {
  initQueue,
  addJob,
  allJobs,
  updateJob,
  removeJob,
  rememberDiscarded,
  discardedMoments,
  acknowledgeDiscarded,
} from '../queueDb.web';
import type { QueueJob, DiscardedMoment } from '../types';

const job: QueueJob = {
  id: 'j1', post_id: 'p1', trip_id: 't1', author_id: 'u1', typ: 'photo',
  medium_uri: 'file:///m.jpg', thumb_uri: 'file:///t.jpg',
  storage_key: 'trips/t1/p1.jpg', thumb_key: 'trips/t1/p1_t.jpg',
  caption: null, captured_at: '2026-08-01T10:00:00.000Z', captured_tz: 'Europe/Zurich',
  lat: null, lng: null, place_name: null, duration_s: null,
  zustand: 'wartet', versuche: 0, naechster_versuch: 0,
  zeile_angelegt: false, medium_geladen: false, thumb_geladen: false,
};

const discardedEntry: DiscardedMoment = {
  id: 'p1', trip_id: 't1', author_id: 'u1', grund: 'nach Reveal aufgenommen', verworfen_am: 0,
};

test('allJobs() returns an empty list instead of throwing, there is no queue on web', async () => {
  await expect(allJobs()).resolves.toEqual([]);
});

test('discardedMoments() returns an empty list instead of throwing', async () => {
  await expect(discardedMoments('t1', 'u1')).resolves.toEqual([]);
});

test.each([
  ['initQueue', () => initQueue()],
  ['addJob', () => addJob(job)],
  ['updateJob', () => updateJob(job)],
  ['removeJob', () => removeJob('j1')],
  ['rememberDiscarded', () => rememberDiscarded(discardedEntry)],
  ['acknowledgeDiscarded', () => acknowledgeDiscarded('t1', 'u1')],
])('%s never throws', async (_name, call) => {
  await expect(call()).resolves.toBeUndefined();
});
