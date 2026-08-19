import type { Viewport, Cluster, MapPoint } from './types';

// Two pins closer than this cover each other: the thumbnail is 44 points
// wide, from around 40 points of distance the edges visibly overlap.
export const CLUSTER_DISTANCE_PT = 40;

type ScreenPoint = { x: number; y: number };

// Linear projection of the visible viewport onto the surface. Deliberately
// WITHOUT Mercator correction: this isn't about cartography, it's about the
// question "how far apart are these two pins on THIS screen", and the
// viewport is small enough that the distortion in it doesn't matter.
function toScreen(point: MapPoint, viewport: Viewport, width: number, height: number): ScreenPoint {
  const west = viewport.longitude - viewport.longitudeDelta / 2;
  const north = viewport.latitude + viewport.latitudeDelta / 2;
  const offset = (((point.lng - west) % 360) + 360) % 360;
  return {
    x: (offset / viewport.longitudeDelta) * width,
    y: ((north - point.lat) / viewport.latitudeDelta) * height,
  };
}

// Combines points that lie too close together on screen to show
// individually.
//
// Deliberately greedy and in input order rather than k-means or similar:
// the input is sorted by captured_at, so the result is deterministic and
// the anchor of every cluster is its earliest moment. A method with a
// random start would make the map look different on every render.
export function cluster(
  points: MapPoint[],
  viewport: Viewport,
  width: number,
  height: number,
  threshold: number = CLUSTER_DISTANCE_PT
): Cluster[] {
  const working: { cluster: Cluster; anchorScreen: ScreenPoint }[] = [];

  for (const point of points) {
    const screen = toScreen(point, viewport, width, height);
    const match = working.find(({ anchorScreen }) => {
      return Math.hypot(screen.x - anchorScreen.x, screen.y - anchorScreen.y) < threshold;
    });
    if (match) {
      match.cluster.points.push(point);
      continue;
    }
    working.push({ cluster: { anchor: point, points: [point] }, anchorScreen: screen });
  }

  return working.map((w) => w.cluster);
}

// A cluster that no zoom can separate any further (Task-8-Brief, Schritt 2b).
//
// The distance between two pins on screen is their geographic extent
// divided by the visible span (see toScreen above), and the span is at most
// halved on every tap on a cluster (map.tsx). For ANY extent greater than
// zero, the distance therefore grows with every tap and eventually exceeds
// the cluster threshold. Only at extent ZERO does it stay zero, through
// every zoom level. That's exactly when a tap would hit nothing, and the
// map screen shows the moments as a list instead.
//
// Deliberately NO tolerance band: a threshold ("closer than x meters")
// would be a claim about how far the map can even zoom in on the device,
// and that can't be backed up from here. Two moments a few meters apart are
// genuinely separated by the zoom after a few taps; showing them a list
// instead would be the worse mistake.
export function isSameSpot(cluster: Cluster): boolean {
  return cluster.points.every((p) => p.lat === cluster.anchor.lat && p.lng === cluster.anchor.lng);
}
