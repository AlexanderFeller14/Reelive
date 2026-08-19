// Before the reveal, the counter is the only information about sealed
// moments at all (see Task-9-Auftrag), it must never jump backwards after
// an offline capture.
jest.mock('@/features/trips/tripsApi', () => ({
  eigeneZaehler: jest.fn(async () => ({ data: { t1: 5 }, error: null })),
}));
jest.mock('../queueDb', () => ({ allJobs: jest.fn(async () => []) }));
jest.mock('../momentsApi', () => ({ currentAuthorId: jest.fn(async () => 'u1') }));
jest.mock('@/features/trips/tripsCache', () => ({
  gemerkteZaehler: jest.fn(async () => ({})),
  zaehlerMerken: jest.fn(async () => {}),
}));

import { ownMomentCount } from '../counter';
import * as queueDb from '../queueDb';
import * as tripsApi from '@/features/trips/tripsApi';
import * as tripsCache from '@/features/trips/tripsCache';

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks only clears the call history, not the implementation set
  // via mockResolvedValue, restore the default values here.
  (tripsApi.eigeneZaehler as jest.Mock).mockResolvedValue({ data: { t1: 5 }, error: null });
  (tripsCache.gemerkteZaehler as jest.Mock).mockResolvedValue({});
});

test('without pending moments, only the server count is counted', async () => {
  await expect(ownMomentCount('t1')).resolves.toBe(5);
});

test('pending moments of the same trip get counted in', async () => {
  (queueDb.allJobs as jest.Mock).mockResolvedValueOnce([
    { trip_id: 't1', zustand: 'wartet' },
    { trip_id: 't1', zustand: 'laeuft' },
  ]);
  await expect(ownMomentCount('t1')).resolves.toBe(7);
});

test('pending moments of other trips do not get counted', async () => {
  (queueDb.allJobs as jest.Mock).mockResolvedValueOnce([{ trip_id: 't2', zustand: 'wartet' }]);
  await expect(ownMomentCount('t1')).resolves.toBe(5);
});

test('a trip without a server count (never submitted yet) starts at 0 instead of undefined', async () => {
  (queueDb.allJobs as jest.Mock).mockResolvedValueOnce([{ trip_id: 't9', zustand: 'wartet' }]);
  await expect(ownMomentCount('t9')).resolves.toBe(1);
});

// Fix-Runde 1: `my_post_counts()` already counts a posts row server-side
// as soon as it exists (zeile_angelegt: true), even before the media and
// thumbnail upload are confirmed.

test('a pending job with an already created row does NOT increase the count (already in the server count)', async () => {
  (queueDb.allJobs as jest.Mock).mockResolvedValueOnce([
    { trip_id: 't1', zustand: 'wartet', zeile_angelegt: true },
  ]);
  await expect(ownMomentCount('t1')).resolves.toBe(5);
});

test('a pending job WITHOUT a created row increases the count (still invisible to the server)', async () => {
  (queueDb.allJobs as jest.Mock).mockResolvedValueOnce([
    { trip_id: 't1', zustand: 'wartet', zeile_angelegt: false },
  ]);
  await expect(ownMomentCount('t1')).resolves.toBe(6);
});

test('a mix of both only counts in the jobs without a created row', async () => {
  (queueDb.allJobs as jest.Mock).mockResolvedValueOnce([
    { trip_id: 't1', zustand: 'wartet', zeile_angelegt: false },
    { trip_id: 't1', zustand: 'wartet', zeile_angelegt: true },
    { trip_id: 't1', zustand: 'laeuft', zeile_angelegt: true },
  ]);
  await expect(ownMomentCount('t1')).resolves.toBe(6);
});

test('the number stays monotonic across the whole flow: enqueued, row created, job removed', async () => {
  const mockServerCounter = tripsApi.eigeneZaehler as jest.Mock;
  const mockAllJobs = queueDb.allJobs as jest.Mock;

  // Before submitting: server knows 5, the queue is empty for this trip.
  mockServerCounter.mockResolvedValueOnce({ data: { t1: 5 }, error: null });
  mockAllJobs.mockResolvedValueOnce([]);
  await expect(ownMomentCount('t1')).resolves.toBe(5);

  // Enqueued: job pending, row not yet created, counts in locally.
  mockServerCounter.mockResolvedValueOnce({ data: { t1: 5 }, error: null });
  mockAllJobs.mockResolvedValueOnce([{ trip_id: 't1', zustand: 'wartet', zeile_angelegt: false }]);
  await expect(ownMomentCount('t1')).resolves.toBe(6);

  // Row created, media upload not yet confirmed (e.g. repeatedly failed):
  // the server already counts the row itself now, locally the job
  // therefore drops out of the count, the sum stays the same.
  mockServerCounter.mockResolvedValueOnce({ data: { t1: 6 }, error: null });
  mockAllJobs.mockResolvedValueOnce([{ trip_id: 't1', zustand: 'wartet', zeile_angelegt: true }]);
  await expect(ownMomentCount('t1')).resolves.toBe(6);

  // Upload confirmed, job removed from the queue.
  mockServerCounter.mockResolvedValueOnce({ data: { t1: 6 }, error: null });
  mockAllJobs.mockResolvedValueOnce([]);
  await expect(ownMomentCount('t1')).resolves.toBe(6);
});

// === Final-Review, Important 6: a failure is not "null" ===
// Previously tripsApi swallowed the rpc error and returned an empty
// mapping. Whoever had 40 sealed moments and took one in flight mode saw
// 0 + 1 = 1, the backwards jump that Spec §7 rules out, of all things in
// the offline case this phase exists for.

test('a successful fetch writes the server count forward', async () => {
  (tripsApi.eigeneZaehler as jest.Mock).mockResolvedValueOnce({ data: { t1: 40 }, error: null });
  await expect(ownMomentCount('t1')).resolves.toBe(40);
  expect(tripsCache.zaehlerMerken).toHaveBeenCalledWith('u1', { t1: 40 });
});

test('a failed fetch falls back to the last known count instead of 0', async () => {
  (tripsApi.eigeneZaehler as jest.Mock).mockResolvedValueOnce({ data: {}, error: 'Offline' });
  (tripsCache.gemerkteZaehler as jest.Mock).mockResolvedValueOnce({ t1: 40 });
  (queueDb.allJobs as jest.Mock).mockResolvedValueOnce([
    { trip_id: 't1', zustand: 'wartet', zeile_angelegt: false },
  ]);

  // 40 sealed moments, one of them freshly captured in flight mode: 41.
  // Before the fix, this used to be 1.
  await expect(ownMomentCount('t1')).resolves.toBe(41);
  // A failure must never overwrite the held-back count.
  expect(tripsCache.zaehlerMerken).not.toHaveBeenCalled();
});

test('without a held-back count, it stays at the pure queue share', async () => {
  (tripsApi.eigeneZaehler as jest.Mock).mockResolvedValueOnce({ data: {}, error: 'Offline' });
  (tripsCache.gemerkteZaehler as jest.Mock).mockResolvedValueOnce({});
  (queueDb.allJobs as jest.Mock).mockResolvedValueOnce([
    { trip_id: 't1', zustand: 'wartet', zeile_angelegt: false },
  ]);
  await expect(ownMomentCount('t1')).resolves.toBe(1);
});
