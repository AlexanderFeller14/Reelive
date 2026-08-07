import { backoffMs, naechsterJob, nachFehlschlag, wartendeAnzahl } from '../queueLogic';
import type { QueueJob } from '../types';

const job = (over: Partial<QueueJob> = {}): QueueJob => ({
  id: 'j1', post_id: 'p1', trip_id: 't1', typ: 'photo',
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
])('backoffMs(%i) → %i', (versuche, erwartet) => {
  expect(backoffMs(versuche)).toBe(erwartet);
});

test('backoffMs ist bei 10 Minuten gedeckelt', () => {
  expect(backoffMs(20)).toBe(600_000);
  expect(backoffMs(100)).toBe(600_000);
});

test('naechsterJob nimmt den ältesten fälligen Job', () => {
  const jobs = [
    job({ id: 'a', naechster_versuch: 5_000 }),
    job({ id: 'b', naechster_versuch: 1_000 }),
  ];
  expect(naechsterJob(jobs, 10_000, true, false)?.id).toBe('b');
});

test('naechsterJob überspringt noch nicht fällige Jobs', () => {
  const jobs = [job({ id: 'a', naechster_versuch: 50_000 })];
  expect(naechsterJob(jobs, 10_000, true, false)).toBeNull();
});

test('naechsterJob überspringt laufende und fertige Jobs', () => {
  const jobs = [
    job({ id: 'a', zustand: 'laeuft' }),
    job({ id: 'b', zustand: 'fertig' }),
  ];
  expect(naechsterJob(jobs, 10_000, true, false)).toBeNull();
});

test('nurWlan pausiert auf Mobilfunk statt Jobs scheitern zu lassen', () => {
  const jobs = [job()];
  expect(naechsterJob(jobs, 10_000, false, true)).toBeNull();
  expect(naechsterJob(jobs, 10_000, true, true)?.id).toBe('j1');
  expect(naechsterJob(jobs, 10_000, false, false)?.id).toBe('j1');
});

test('nachFehlschlag zählt hoch und verschiebt den nächsten Versuch', () => {
  const nachher = nachFehlschlag(job({ versuche: 1 }), 10_000);
  expect(nachher.versuche).toBe(2);
  expect(nachher.naechster_versuch).toBe(10_000 + 8_000);
  expect(nachher.zustand).toBe('wartet');
});

test('nachFehlschlag verwirft einen Job nie', () => {
  let j = job();
  for (let i = 0; i < 50; i++) j = nachFehlschlag(j, 0);
  expect(j.zustand).toBe('wartet');
});

test('wartendeAnzahl zählt alles, was noch nicht fertig ist', () => {
  const jobs = [job({ zustand: 'wartet' }), job({ zustand: 'laeuft' }), job({ zustand: 'fertig' })];
  expect(wartendeAnzahl(jobs)).toBe(2);
});
