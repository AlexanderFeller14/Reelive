import { backoffMs, nextJob, afterFailure, pendingCount } from '../queueLogic';
import type { QueueJob } from '../types';

const job = (over: Partial<QueueJob> = {}): QueueJob => ({
  id: 'j1', post_id: 'p1', trip_id: 't1', author_id: 'u1', typ: 'photo',
  medium_uri: 'file:///m.jpg', thumb_uri: 'file:///t.jpg',
  storage_key: 'trips/t1/p1.jpg', thumb_key: 'trips/t1/p1_t.jpg',
  caption: null, captured_at: '2026-08-07T10:00:00.000Z', captured_tz: 'Europe/Zurich',
  lat: null, lng: null, place_name: null, duration_s: null,
  zustand: 'wartet', versuche: 0, naechster_versuch: 0,
  zeile_angelegt: false, medium_geladen: false, thumb_geladen: false,
  ...over,
});

test.each([
  [0, 2_000],
  [1, 4_000],
  [2, 8_000],
  [3, 16_000],
])('backoffMs(%i) → %i', (attempts, expected) => {
  expect(backoffMs(attempts)).toBe(expected);
});

test('backoffMs is capped at 10 minutes', () => {
  expect(backoffMs(20)).toBe(600_000);
  expect(backoffMs(100)).toBe(600_000);
});

test('nextJob takes the oldest due job', () => {
  const jobs = [
    job({ id: 'a', naechster_versuch: 5_000 }),
    job({ id: 'b', naechster_versuch: 1_000 }),
  ];
  expect(nextJob(jobs, 10_000, true, false, 'u1')?.id).toBe('b');
});

test('nextJob skips jobs that are not due yet', () => {
  const jobs = [job({ id: 'a', naechster_versuch: 50_000 })];
  expect(nextJob(jobs, 10_000, true, false, 'u1')).toBeNull();
});

test('nextJob skips running and done jobs', () => {
  const jobs = [
    job({ id: 'a', zustand: 'laeuft' }),
    job({ id: 'b', zustand: 'fertig' }),
  ];
  expect(nextJob(jobs, 10_000, true, false, 'u1')).toBeNull();
});

test('wifiOnly pauses on mobile data instead of letting jobs fail', () => {
  const jobs = [job()];
  expect(nextJob(jobs, 10_000, false, true, 'u1')).toBeNull();
  expect(nextJob(jobs, 10_000, true, true, 'u1')?.id).toBe('j1');
  expect(nextJob(jobs, 10_000, false, false, 'u1')?.id).toBe('j1');
});

// Task-13-Fix-Runde-2: the DECISIVE case needs NO race. A job merely sits
// in the queue (zustand: 'wartet', long due), A signs out, B signs in, and
// the next regular tick runs entirely under B's valid, fresh session.
// Without the author_id filter, nextJob would select this job anyway, and
// createMoment would write it under B's name.
describe('nextJob only selects jobs of the currently signed-in person', () => {
  test('a job of another person does NOT get selected, even though it is long due, no race needed', () => {
    const jobs = [job({ id: 'a', author_id: 'person-a', naechster_versuch: 0 })];
    // "person-b" is signed in now, the job belongs to "person-a", it stays
    // put, doesn't get discarded, and doesn't get counted as a failure.
    expect(nextJob(jobs, 10_000, true, false, 'person-b')).toBeNull();
  });

  test('as soon as the matching person is signed in again, the same job gets selected', () => {
    const jobs = [job({ id: 'a', author_id: 'person-a', naechster_versuch: 0 })];
    expect(nextJob(jobs, 10_000, true, false, 'person-a')?.id).toBe('a');
  });

  test('on a shared device, each person only selects their own jobs, regardless of age', () => {
    const jobs = [
      job({ id: 'alt-von-a', author_id: 'person-a', naechster_versuch: 0 }),
      job({ id: 'neu-von-b', author_id: 'person-b', naechster_versuch: 5_000 }),
    ];
    expect(nextJob(jobs, 10_000, true, false, 'person-b')?.id).toBe('neu-von-b');
    expect(nextJob(jobs, 10_000, true, false, 'person-a')?.id).toBe('alt-von-a');
  });

  // Legacy data (migration from before Task 13) or a failed session lookup:
  // currentAuthorId() then returns null. A job never matches against null,
  // isComplete() in queueDb already ensures that author_id is never null
  // in a QueueJob anyway, but the logic here doesn't rely on that and is
  // defensively correct.
  test('currentAuthorId === null selects no job, not even one with author_id null', () => {
    const jobs = [job({ id: 'a', author_id: null as unknown as string, naechster_versuch: 0 })];
    expect(nextJob(jobs, 10_000, true, false, null)).toBeNull();
  });
});

test('afterFailure counts up and postpones the next attempt', () => {
  const updated = afterFailure(job({ versuche: 1 }), 10_000);
  expect(updated.versuche).toBe(2);
  expect(updated.naechster_versuch).toBe(10_000 + 8_000);
  expect(updated.zustand).toBe('wartet');
});

test('afterFailure never discards a job', () => {
  let j = job();
  for (let i = 0; i < 50; i++) j = afterFailure(j, 0);
  expect(j.zustand).toBe('wartet');
});

test('pendingCount counts everything that is not done yet', () => {
  const jobs = [job({ zustand: 'wartet' }), job({ zustand: 'laeuft' }), job({ zustand: 'fertig' })];
  expect(pendingCount(jobs)).toBe(2);
});
