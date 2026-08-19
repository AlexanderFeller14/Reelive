import AsyncStorage from '@react-native-async-storage/async-storage';

// Remembers, per trip, whether the reveal staging (DESIGN-LANGUAGE §5, the
// second of the two permitted exceptions) has already been shown. Its actual
// purpose is promise V6 ("the recap works even if a push never arrives"):
// the trip detail screen reloads on focus anyway (reise/[id]/index.tsx) and
// detects a freshly revealed trip itself from `status !== 'active'`, it
// needs neither push nor deep link for that. This store only makes sure the
// one-time staging really only runs once, no matter how often the screen is
// focused afterwards.
//
// Key pattern like tripsCache.ts (fixed prefix + id, concatenated as a
// string). Unlike there (prefix + user id, because a shared device must
// never show A's trips to B), nothing here is security-relevant: a
// duplicate-shown animation is a cosmetic glitch, not a data leak. The key
// therefore deliberately carries only the trip id, exactly the interface
// from the Task-9 brief.

const KEY_PREFIX = 'reelive.reveal_gesehen.';

export async function hasSeenReveal(tripId: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + tripId);
    return raw !== null;
  } catch {
    return false;
  }
}

// A failed write (storage full or broken) doesn't lose anything beyond
// itself: the staging simply runs again the next time this trip is focused.
// A repeated animation is at most annoying, it never blocks the way to the
// recap itself, "Start recap" is there afterwards in every case, whether the
// staging ran or not (see reise/[id]/index.tsx).
export async function markRevealSeen(tripId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + tripId, '1');
  } catch {
    // See comment above.
  }
}
