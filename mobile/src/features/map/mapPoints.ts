import { sortMoments } from '@/features/recap/days';
import type { RecapMoment } from '@/features/recap/types';
import type { MapPoint } from './types';

// Pulls out of a trip's moments the ones that carry a place, and keeps the
// others instead of dropping them: a map on which three moments are simply
// missing, without anyone finding out, lies about the trip (Spec K6).
//
// Callers must pass the PLAYABLE list (uploaded.filter((m) =>
// urls.has(m.id)), see player.tsx/uebersicht.tsx), not the raw moment
// list: `index` has to point into the same order the player plays, or it
// starts at the wrong moment.
export function toMapPoints(moments: RecapMoment[]): {
  points: MapPoint[];
  withoutPlace: RecapMoment[];
} {
  const sorted = sortMoments(moments);
  const points: MapPoint[] = [];
  const withoutPlace: RecapMoment[] = [];

  sorted.forEach((moment, index) => {
    if (moment.lat === null || moment.lng === null) {
      withoutPlace.push(moment);
      return;
    }
    points.push({ moment, lat: moment.lat, lng: moment.lng, index });
  });

  return { points, withoutPlace };
}
