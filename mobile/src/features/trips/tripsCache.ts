import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TripStatus } from './types';

// The local fallback for the camera screen and the moments counter.
//
// Why this exists (final review, Critical 1 / Important 6): "capturing works
// fully offline" is this phase's core promise, but the viewfinder only
// appears once an ongoing trip is known. Without a local store, fetchTrips()
// returned `{ data: [], error }` in flight mode, and instead of viewfinder
// and shutter there was an error page. Queue, compression and worker were
// all correct, and all unreachable.
//
// Deliberately stores only the bare minimum (id, name, status, date range,
// counter), not the whole trip row: the camera does not need member names,
// and what does not get stored also cannot go stale or needlessly linger on
// the device.
//
// Kept SEPARATE PER PERSON (the key carries the user id): on a shared
// device, B must never see A's trips offline. Without an id (`null`, session
// unreadable), neither reading nor writing happens, then there simply is no
// fallback instead of guessing.

const TRIPS_PREFIX = 'reelive.trips.';
const COUNTS_PREFIX = 'reelive.counters.';

// Exactly the fields the camera screen needs. `Trip` is a superset of this
// and can therefore be assigned directly (see toCached below).
export type CachedTrip = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: TripStatus;
  my_post_count: number;
};

const ALLOWED_STATUSES: readonly TripStatus[] = ['active', 'revealed', 'archived'];

export function toCached(trip: CachedTrip): CachedTrip {
  return {
    id: trip.id,
    name: trip.name,
    start_date: trip.start_date,
    end_date: trip.end_date,
    status: trip.status,
    my_post_count: trip.my_post_count,
  };
}

// Same caution as in queueDb.toJob: whatever comes back from storage has
// already been through an app update, an aborted write, or an older field
// shape. An incomplete row is discarded rather than emitted as a trip,
// otherwise the viewfinder would show a trip with no name.
function isCachedTrip(value: unknown): value is CachedTrip {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.start_date === 'string' &&
    typeof r.end_date === 'string' &&
    ALLOWED_STATUSES.includes(r.status as TripStatus) &&
    typeof r.my_post_count === 'number'
  );
}

export async function rememberTrips(
  userId: string | null,
  trips: CachedTrip[]
): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(
      TRIPS_PREFIX + userId,
      JSON.stringify(trips.map(toCached))
    );
  } catch {
    // A store that fails to persist costs at most the fallback on the next
    // flight mode, no reason to fail the camera screen.
  }
}

// `null` means "nothing held" and is thereby distinguishable from a (valid)
// empty store: only in the first case may the error page appear.
export async function rememberedTrips(userId: string | null): Promise<CachedTrip[] | null> {
  if (!userId) return null;
  try {
    const raw = await AsyncStorage.getItem(TRIPS_PREFIX + userId);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(isCachedTrip);
  } catch {
    return null;
  }
}

export async function rememberCounts(
  userId: string | null,
  counts: Record<string, number>
): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(COUNTS_PREFIX + userId, JSON.stringify(counts));
  } catch {
    // See rememberTrips.
  }
}

// An empty object as the fallback is enough here: the caller (counter.ts)
// adds the pending moments on top of it, and "no remembered state" is the
// same to it as "server state 0", unlike with the trips there is no error
// page that depends on it.
export async function rememberedCounts(userId: string | null): Promise<Record<string, number>> {
  if (!userId) return {};
  try {
    const raw = await AsyncStorage.getItem(COUNTS_PREFIX + userId);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const clean: Record<string, number> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value)) clean[id] = value;
    }
    return clean;
  } catch {
    return {};
  }
}
