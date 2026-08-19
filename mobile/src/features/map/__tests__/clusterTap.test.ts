import { cameraMoved, zoomExhausted, zoomTarget } from '@/features/map/clusterTap';
import type { Viewport, Cluster, MapPoint } from '@/features/map/types';
import type { RecapMoment } from '@/features/recap/types';

function moment(id: string): RecapMoment {
  return {
    id,
    trip_id: 't1',
    author_id: 'a1',
    type: 'photo',
    duration_s: null,
    caption: null,
    captured_at: '2026-08-10T09:00:00.000Z',
    captured_tz: 'Europe/Zurich',
    place_name: 'Alfama',
    lat: 38.7139,
    lng: -9.1301,
    upload_status: 'uploaded',
    authorName: 'Lea',
    authorAvatarKey: null,
  };
}

function point(id: string, lat: number, lng: number, index = 0): MapPoint {
  return { moment: { ...moment(id), lat, lng }, lat, lng, index };
}

function cluster(points: MapPoint[]): Cluster {
  return { anchor: points[0], points };
}

const VISIBLE: Viewport = {
  latitude: 38.72,
  longitude: -9.14,
  latitudeDelta: 0.04,
  longitudeDelta: 0.04,
};

describe('cameraMoved', () => {
  test('the same viewport does not count as movement', () => {
    expect(cameraMoved(VISIBLE, { ...VISIBLE })).toBe(false);
  });

  test('a halved span is a movement', () => {
    expect(cameraMoved(VISIBLE, { ...VISIBLE, latitudeDelta: 0.02 })).toBe(true);
    expect(cameraMoved(VISIBLE, { ...VISIBLE, longitudeDelta: 0.02 })).toBe(true);
  });

  test('a shifted center is a movement', () => {
    expect(cameraMoved(VISIBLE, { ...VISIBLE, latitude: 38.73 })).toBe(true);
    expect(cameraMoved(VISIBLE, { ...VISIBLE, longitude: -9.13 })).toBe(true);
  });

  // The threshold hangs on the SPAN, not on a fixed number of degrees: the
  // same absolute offset is nothing on a continent-wide viewport and half
  // the map on a city block.
  test('a jitter below one percent of the span does not count', () => {
    // 0.04 x 1% = 0.0004, half of that is below it.
    expect(cameraMoved(VISIBLE, { ...VISIBLE, latitude: 38.7202 })).toBe(false);
    const tight = { ...VISIBLE, latitudeDelta: 0.0004, longitudeDelta: 0.0004 };
    // The same offset on a viewport a hundred times tighter is very much a
    // movement.
    expect(cameraMoved(tight, { ...tight, latitude: 38.7202 })).toBe(true);
  });

  test('across the 180th meridian, the shorter way is measured', () => {
    const atTheBorder: Viewport = {
      latitude: 0,
      longitude: 179.999,
      latitudeDelta: 0.04,
      longitudeDelta: 0.04,
    };
    // 0.002 degrees apart, but numerically 359.998, which is 5% of the
    // span and thus a movement, but not one of 360 degrees.
    expect(cameraMoved(atTheBorder, { ...atTheBorder, longitude: -179.999 })).toBe(true);
    // And the exact same point, once written as 180 and once as -180, is
    // not one.
    expect(
      cameraMoved({ ...atTheBorder, longitude: 180 }, { ...atTheBorder, longitude: -180 })
    ).toBe(false);
  });
});

describe('zoomTarget', () => {
  const close = cluster([point('p1', 38.7139, -9.1301), point('p2', 38.71408, -9.1301, 1)]);

  test('targets the center of the cluster', () => {
    const target = zoomTarget(close, VISIBLE);
    expect(target).not.toBeNull();
    expect(target!.latitude).toBeCloseTo((38.7139 + 38.71408) / 2, 6);
    expect(target!.longitude).toBeCloseTo(-9.1301, 6);
  });

  test('never flies out, at most to half the visible span', () => {
    const target = zoomTarget(close, VISIBLE)!;
    expect(target.latitudeDelta).toBeLessThanOrEqual(VISIBLE.latitudeDelta / 2);
    expect(target.longitudeDelta).toBeLessThanOrEqual(VISIBLE.longitudeDelta / 2);
  });

  test('a tight cluster is shown tighter than half the span', () => {
    // Starting from an already very close viewport, the cluster's own
    // extent wins, not the halving.
    const closeVisible = { ...VISIBLE, latitudeDelta: 4, longitudeDelta: 4 };
    const target = zoomTarget(close, closeVisible)!;
    expect(target.latitudeDelta).toBeLessThan(closeVisible.latitudeDelta / 2);
  });
});

describe('zoomExhausted', () => {
  const sameSpot = cluster([point('p1', 38.7139, -9.1301), point('p2', 38.7139, -9.1301, 1)]);
  // Roughly 20 meters apart: a cluster on THIS viewport, but not on the
  // same coordinate.
  const separable = cluster([point('p1', 38.7139, -9.1301), point('p2', 38.71408, -9.1301, 1)]);

  test('bit-identical coordinates: the sheet immediately, without an attempt', () => {
    expect(zoomExhausted(sameSpot, VISIBLE, null)).toBe(true);
  });

  test('a separable cluster gets no sheet on the first tap', () => {
    expect(zoomExhausted(separable, VISIBLE, null)).toBe(false);
  });

  // The core of the fix round: at MAX_ZOOM the camera stands still, and the
  // cluster wouldn't fall apart through any further level, even though its
  // points differ.
  test('if the last tap on THIS cluster moved nothing, the next opens the sheet', () => {
    const last = { anchorId: 'p1', before: VISIBLE };
    expect(zoomExhausted(separable, VISIBLE, last)).toBe(true);
  });

  test('if it did move the camera, zooming continues', () => {
    const last = { anchorId: 'p1', before: { ...VISIBLE, latitudeDelta: 0.08, longitudeDelta: 0.08 } };
    expect(zoomExhausted(separable, VISIBLE, last)).toBe(false);
  });

  // Another cluster sits elsewhere: the camera can fly there, even if the
  // zoom level is already at its limit, the CENTER moves.
  test('a stalled attempt of ANOTHER cluster does not block', () => {
    const other = cluster([point('q1', 38.75, -9.16), point('q2', 38.75018, -9.16, 1)]);
    const last = { anchorId: 'p1', before: VISIBLE };
    expect(zoomExhausted(other, VISIBLE, last)).toBe(false);
  });
});
