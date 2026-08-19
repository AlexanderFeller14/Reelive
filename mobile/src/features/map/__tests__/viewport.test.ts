import { viewportFor } from '../viewport';
import type { MapPoint } from '../types';

const point = (lat: number, lng: number): MapPoint =>
  ({ lat, lng, index: 0, moment: { id: `${lat},${lng}` } } as unknown as MapPoint);

test('no points means no viewport', () => {
  expect(viewportFor([])).toBeNull();
});

test('a single point gets a fixed radius', () => {
  const a = viewportFor([point(38.71, -9.13)])!;
  expect(a.latitude).toBeCloseTo(38.71, 5);
  expect(a.longitude).toBeCloseTo(-9.13, 5);
  expect(a.latitudeDelta).toBeGreaterThan(0);
  expect(a.longitudeDelta).toBeGreaterThan(0);
});

test('two points sit centered in the viewport and fit with padding', () => {
  const a = viewportFor([point(38.70, -9.20), point(38.72, -9.10)])!;
  expect(a.latitude).toBeCloseTo(38.71, 5);
  expect(a.longitude).toBeCloseTo(-9.15, 5);
  expect(a.latitudeDelta).toBeGreaterThan(0.02);
  expect(a.longitudeDelta).toBeGreaterThan(0.10);
});

// The case where the naive calculation (min/max) fails: Fiji straddles the
// 180th meridian. min/max would give a span of 359 degrees and a center in
// Africa.
test('crossing the 180th meridian keeps the viewport tight', () => {
  const a = viewportFor([point(-17.8, 179.0), point(-17.9, -179.5)])!;
  expect(a.longitudeDelta).toBeLessThan(5);
  expect(Math.abs(a.longitude)).toBeGreaterThan(175);
});

// The bug Task 3 found while implementing this: for identical longitudes,
// the gap search found a 0-degree gap and turned that into a span of 360,
// the center landed on the antipode.
test('several points on the same coordinate stay there', () => {
  const a = viewportFor([point(38.71, -9.13), point(38.71, -9.13)])!;
  expect(a.longitude).toBeCloseTo(-9.13, 5);
  expect(a.latitude).toBeCloseTo(38.71, 5);
});

test('the center stays within the valid range', () => {
  const a = viewportFor([point(-17.8, 179.0), point(-17.9, -179.5)])!;
  expect(a.longitude).toBeGreaterThanOrEqual(-180);
  expect(a.longitude).toBeLessThanOrEqual(180);
});

// Three points, two equally large gaps (170 degrees each): the core of the
// method. The smallest enclosing span is 190 degrees, and on a tie the
// first gap found wins, the result must be deterministic, not just any
// valid one.
test('three points with equally large gaps give a fixed result', () => {
  const a = viewportFor([point(0, -170), point(0, 0), point(0, 170)])!;
  expect(a.longitude).toBeCloseTo(95, 5);
  expect(a.longitudeDelta).toBeCloseTo(190 * 1.4, 5);
});
