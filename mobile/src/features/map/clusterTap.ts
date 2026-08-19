import { viewportFor } from './viewport';
import { isSameSpot } from './clustering';
import type { Viewport, Cluster } from './types';

// What a tap on a cluster triggers, the rule shared by the app's map screen
// (recap/[id]/map.tsx) and the shared recap (share/[token].tsx). Two
// copies here were guaranteed to drift apart, and the one that drifted
// would be the one where the dead end below reopened.
//
// Spec §5.5: a tap flies INTO the cluster, as long as that achieves
// something. Only once zooming achieves nothing more does it open the
// sheet.
//
// "Achieves nothing more" meant, until the merge fix round, exclusively
// `isSameSpot`, bit-identical coordinates. The reasoning for that (Task 8)
// was: for ANY extent greater than zero, the on-screen distance grows with
// every tap (the visible span is at most halved) and eventually exceeds
// the 40-point cluster threshold.
//
// This proof assumes the map can zoom in arbitrarily far. It can't. In the
// browser it stops at zoom level 19 (`MAX_ZOOM` in MapSurface.web.tsx,
// that's as far as the OpenStreetMap tiles go), and `getBoundsZoom` caps
// it there. At that level, 8 meters are still around 34 screen points,
// which is LESS than the 40 at which two pins get drawn separately; a
// cluster only falls apart there from about 9 meters. Two shots at the
// same place regularly sit 3 to 8 meters apart due to GPS drift, and for
// them the tap was a dead end: haptics, camera flight to the same level,
// no change, no sheet, over and over.
//
// Natively there's the same limit, just at a different level (MapKit
// decides it itself). The answer therefore must not know a number, only
// the OBSERVATION: did the last tap on this cluster move the camera? If
// not, the next one won't either, and then it opens the sheet.

// The last zoom attempt: for WHICH cluster a flight happened and what was
// visible BEFORE the flight. The anchor identifies the cluster: it is its
// earliest moment (clustering.ts) and stays the same as long as the
// cluster exists, and while the camera stands still, the clustering
// doesn't change.
export type ZoomAttempt = { anchorId: string; before: Viewport };

// From what fraction of the visible span a camera movement counts as a
// movement. A real flight halves the span (50%) or shifts the center
// visibly; a flight against the limit changes exactly nothing. One percent
// is far from both and isn't a threshold a rounding error crosses.
const MOVEMENT_FRACTION = 0.01;

function longitudeDistance(a: number, b: number): number {
  return Math.abs((((a - b + 540) % 360) - 180));
}

export function cameraMoved(before: Viewport, after: Viewport): boolean {
  const latThreshold = before.latitudeDelta * MOVEMENT_FRACTION;
  const lngThreshold = before.longitudeDelta * MOVEMENT_FRACTION;
  return (
    Math.abs(after.latitude - before.latitude) > latThreshold ||
    longitudeDistance(after.longitude, before.longitude) > lngThreshold ||
    Math.abs(after.latitudeDelta - before.latitudeDelta) > latThreshold ||
    Math.abs(after.longitudeDelta - before.longitudeDelta) > lngThreshold
  );
}

// Where a tap on this cluster flies to. `null` is unreachable (a cluster
// has at least one point), but the type of `viewportFor` requires handling
// it.
export function zoomTarget(cluster: Cluster, visible: Viewport): Viewport | null {
  const enclosing = viewportFor(cluster.points);
  if (!enclosing) return null;
  return {
    ...enclosing,
    latitudeDelta: Math.min(enclosing.latitudeDelta, visible.latitudeDelta / 2),
    longitudeDelta: Math.min(enclosing.longitudeDelta, visible.longitudeDelta / 2),
  };
}

export function zoomExhausted(
  cluster: Cluster,
  visible: Viewport,
  last: ZoomAttempt | null
): boolean {
  if (isSameSpot(cluster)) return true;
  if (last === null || last.anchorId !== cluster.anchor.moment.id) return false;
  return !cameraMoved(last.before, visible);
}
