import type { Viewport, MapPoint } from './types';

const PADDING = 1.4;
const MIN_SPAN = 0.01;

// The smallest longitude span that contains all points.
//
// The naive max - min calculation works everywhere except where the trip
// crosses the 180th meridian: for 179 and -179.5 it would give 358.5
// degrees and a center on the other side of the earth. Instead, the
// LARGEST GAP between two neighboring longitudes is found; what remains is
// the span we want.
function longitudeSpan(lngs: number[]): { center: number; span: number } {
  const sorted = [...lngs].sort((a, b) => a - b);
  let largestGap = -1;
  let afterGap = 0;
  for (let i = 0; i < sorted.length; i++) {
    const gap = (sorted[(i + 1) % sorted.length] - sorted[i] + 360) % 360;
    if (gap > largestGap) {
      largestGap = gap;
      afterGap = (i + 1) % sorted.length;
    }
  }
  // If all longitudes are equal (a single point, or several on the same
  // coordinate), EVERY gap is 0, including the wrap-around, since
  // (x - x + 360) % 360 is 0. Without this exit, `360 - 0` would give a
  // span of 360 degrees and a center on the antipode. Largest gap = 0 means
  // exactly "all equal": for two different values a < b, both gaps (b-a)
  // and (a-b+360) are greater than zero.
  if (largestGap === 0) return { center: sorted[0], span: 0 };

  const west = sorted[afterGap];
  const span = 360 - largestGap;
  // +180 before the modulo brings the value into [0, 360), then back to
  // [-180, 180). That the sum never goes negative is guaranteed by the exit
  // above: `west` lies in [-180, 180] and `span` is then strictly greater
  // than zero, so west + span/2 + 180 > 0.
  const center = ((west + span / 2 + 180) % 360) - 180;
  return { center, span };
}

// The region in which ALL given points are visible (Spec K2). `null` means
// there's nothing to show; the screen then decides on the empty state,
// instead of getting a made-up viewport.
export function viewportFor(points: MapPoint[]): Viewport | null {
  if (points.length === 0) return null;

  const lats = points.map((p) => p.lat);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const { center: longitude, span } = longitudeSpan(points.map((p) => p.lng));

  return {
    latitude: (minLat + maxLat) / 2,
    longitude,
    latitudeDelta: Math.max((maxLat - minLat) * PADDING, MIN_SPAN),
    longitudeDelta: Math.max(span * PADDING, MIN_SPAN),
  };
}
