import { isSameSpot, cluster, CLUSTER_DISTANCE_PT } from '../clustering';
import type { Viewport, MapPoint } from '../types';

const point = (id: string, lat: number, lng: number, index = 0): MapPoint =>
  ({ lat, lng, index, moment: { id } } as unknown as MapPoint);

// 0.1 degrees over 400 points width: one degree is 4000 points, one
// thousandth of a degree is thus 4 points.
const VIEWPORT: Viewport = {
  latitude: 0, longitude: 0, latitudeDelta: 0.1, longitudeDelta: 0.1,
};
const WIDTH = 400;
const HEIGHT = 400;

test('points far apart stay separate', () => {
  const clusters = cluster(
    [point('a', 0.04, 0.04), point('b', -0.04, -0.04)],
    VIEWPORT, WIDTH, HEIGHT
  );
  expect(clusters).toHaveLength(2);
  expect(clusters.every((c) => c.points.length === 1)).toBe(true);
});

test('points close together become one cluster', () => {
  const clusters = cluster(
    [point('a', 0, 0), point('b', 0.001, 0.001), point('c', 0.002, 0)],
    VIEWPORT, WIDTH, HEIGHT
  );
  expect(clusters).toHaveLength(1);
  expect(clusters[0].points.map((p) => p.moment.id)).toEqual(['a', 'b', 'c']);
});

// The anchor represents the cluster. It's the FIRST in input order, and
// that order is sorted by captured_at, so the cluster carries the
// thumbnail of the earliest moment.
test('the anchor is the earliest moment of the cluster', () => {
  const clusters = cluster(
    [point('early', 0, 0, 3), point('late', 0.001, 0, 7)],
    VIEWPORT, WIDTH, HEIGHT
  );
  expect(clusters[0].anchor.moment.id).toBe('early');
});

test('identical coordinates land in one cluster', () => {
  const clusters = cluster(
    [point('a', 12.34, 56.78), point('b', 12.34, 56.78)],
    { latitude: 12.34, longitude: 56.78, latitudeDelta: 0.1, longitudeDelta: 0.1 },
    WIDTH, HEIGHT
  );
  expect(clusters).toHaveLength(1);
});

test('a single point yields a cluster with one point', () => {
  const clusters = cluster([point('a', 0, 0)], VIEWPORT, WIDTH, HEIGHT);
  expect(clusters).toEqual([{ anchor: expect.anything(), points: [expect.anything()] }]);
});

test('no points means no clusters', () => {
  expect(cluster([], VIEWPORT, WIDTH, HEIGHT)).toEqual([]);
});

// Zooming in breaks a cluster apart, exactly what happens when someone
// taps it (Spec §5.5).
test('a tight viewport breaks up the cluster', () => {
  const points = [point('a', 0, 0), point('b', 0.001, 0.001)];
  const tight: Viewport = { ...VIEWPORT, latitudeDelta: 0.002, longitudeDelta: 0.002 };
  expect(cluster(points, VIEWPORT, WIDTH, HEIGHT)).toHaveLength(1);
  expect(cluster(points, tight, WIDTH, HEIGHT)).toHaveLength(2);
});

test('the threshold is in screen points and adjustable', () => {
  const points = [point('a', 0, 0), point('b', 0.004, 0)];
  expect(cluster(points, VIEWPORT, WIDTH, HEIGHT, 4)).toHaveLength(2);
  expect(cluster(points, VIEWPORT, WIDTH, HEIGHT, CLUSTER_DISTANCE_PT)).toHaveLength(1);
});

// A wrapped viewport, as viewportFor delivers for a trip crossing the date
// line. Previously the eastern point shot off into the millions and was
// never clustered.
test('clusters correctly across the date line', () => {
  const wrapped: Viewport = {
    latitude: -17.85, longitude: -180, latitudeDelta: 0.2, longitudeDelta: 0.2,
  };
  const clusters = cluster(
    [point('west', -17.85, 179.999), point('east', -17.85, -179.999)],
    wrapped, WIDTH, HEIGHT
  );
  expect(clusters).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Task 8, step 2b: clusters that no zoom can separate
// ---------------------------------------------------------------------------

// The distance between two pins on screen is their geographic extent
// divided by the visible span, and the span halves with every tap (see
// map.tsx). At extent zero the distance stays zero, through EVERY zoom
// level. Tapping such a cluster would otherwise hit nothing; the map
// screen opens the sheet for it instead.
test('a cluster at exactly one coordinate is at the same spot', () => {
  const [cluster0] = cluster(
    [point('a', 12.34, 56.78), point('b', 12.34, 56.78)],
    { latitude: 12.34, longitude: 56.78, latitudeDelta: 0.1, longitudeDelta: 0.1 },
    WIDTH, HEIGHT
  );
  expect(isSameSpot(cluster0)).toBe(true);
});

// The trivial, and most common, case: a cluster of exactly one point. It
// too can't be pulled apart, and the map screen routes it into the sheet
// via the same question as coincident moments (map.tsx). If the answer
// came out `false` here, tapping a single pin would open nothing anymore.
test('a single point is at the same spot', () => {
  const [cluster0] = cluster([point('a', 0, 0)], VIEWPORT, WIDTH, HEIGHT);
  expect(isSameSpot(cluster0)).toBe(true);
});

// The more important opposite case: here zooming DOES achieve something.
// If this cluster also counted as "at the same spot", the map would open a
// sheet instead of zooming in, and the zoom path (Spec §5.5) would be dead.
test('a ten-thousandth of a degree difference is no longer the same spot', () => {
  const [cluster0] = cluster(
    [point('a', 12.34, 56.78), point('b', 12.34, 56.7801)],
    { latitude: 12.34, longitude: 56.78, latitudeDelta: 0.1, longitudeDelta: 0.1 },
    WIDTH, HEIGHT
  );
  expect(cluster0.points).toHaveLength(2);
  expect(isSameSpot(cluster0)).toBe(false);
});

// Three points, two of which coincide: zooming does achieve something, the
// third separates. What remains is a cluster that really is at the same
// spot, and only that one opens the sheet. If this returned `true` already,
// the user would be offered a list even though the map can still resolve
// the case itself.
test('when only TWO of three points coincide, it is not the same spot', () => {
  const [cluster0] = cluster(
    [point('a', 0, 0), point('b', 0, 0), point('c', 0.001, 0)],
    VIEWPORT, WIDTH, HEIGHT
  );
  expect(cluster0.points).toHaveLength(3);
  expect(isSameSpot(cluster0)).toBe(false);
});
