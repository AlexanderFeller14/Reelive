import { toMapPoints } from '../mapPoints';
import type { RecapMoment } from '@/features/recap/types';

const moment = (part: Partial<RecapMoment> & { id: string }): RecapMoment => ({
  trip_id: 't1', author_id: 'u1', type: 'photo', duration_s: null, caption: null,
  captured_at: '2026-05-08T10:00:00Z', captured_tz: 'Europe/Lisbon',
  place_name: null, lat: null, lng: null, upload_status: 'uploaded',
  authorName: 'Mira', authorAvatarKey: null, ...part,
});

test('separates moments with a place from those without', () => {
  const { points, withoutPlace } = toMapPoints([
    moment({ id: 'a', lat: 38.71, lng: -9.13 }),
    moment({ id: 'b' }),
    moment({ id: 'c', lat: 38.69, lng: -9.21 }),
  ]);
  expect(points.map((p) => p.moment.id)).toEqual(['a', 'c']);
  expect(withoutPlace.map((m) => m.id)).toEqual(['b']);
});

// The index points into the SORTED overall list, not the filtered one,
// otherwise the player starts at the wrong moment.
test('the index counts over all moments, not just those with a place', () => {
  const { points } = toMapPoints([
    moment({ id: 'a', captured_at: '2026-05-08T09:00:00Z' }),
    moment({ id: 'b', captured_at: '2026-05-08T10:00:00Z', lat: 1, lng: 2 }),
  ]);
  expect(points[0].index).toBe(1);
});

// The map sorts itself instead of relying on the caller: captured_at
// ascending, id as a stable second criterion.
test('sorts by captured_at, not by input order', () => {
  const { points } = toMapPoints([
    moment({ id: 'late', captured_at: '2026-05-09T10:00:00Z', lat: 1, lng: 1 }),
    moment({ id: 'early', captured_at: '2026-05-08T10:00:00Z', lat: 2, lng: 2 }),
  ]);
  expect(points.map((p) => p.moment.id)).toEqual(['early', 'late']);
});

test('half a coordinate is not a coordinate', () => {
  const { points, withoutPlace } = toMapPoints([moment({ id: 'a', lat: 38.71, lng: null })]);
  expect(points).toHaveLength(0);
  expect(withoutPlace.map((m) => m.id)).toEqual(['a']);
});

test('the other half of a coordinate is not a coordinate either', () => {
  const { points, withoutPlace } = toMapPoints([moment({ id: 'a', lat: null, lng: -9.13 })]);
  expect(points).toHaveLength(0);
  expect(withoutPlace.map((m) => m.id)).toEqual(['a']);
});

test('an empty list gives empty results', () => {
  expect(toMapPoints([])).toEqual({ points: [], withoutPlace: [] });
});
