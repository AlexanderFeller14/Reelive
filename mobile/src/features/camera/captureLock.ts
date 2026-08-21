// While a capture is running (photo cycle or video) the tab bar must not be
// operable: a tab switch fires the focus cleanup in the middle of the
// running session (re-hanging mute would be a session reconfiguration, see
// the comment on the CameraView) and navigates away from a capture that is
// about to go to the preview.
//
// Since the tabs can be swiped, the same holds for the gesture, and there
// the lock is needed one step earlier: `swipeEnabled` is read while
// RENDERING, not at the moment of an event. A bare holder cannot serve that,
// the navigator has to RE-RENDER on the change, hence the subscription for
// useSyncExternalStore (same shape as cinemaStage.ts).
//
// The camera screen sets the flag. The tap still reads it synchronously
// (features/navigation/TabBar.tsx): the photo cycle lives in a ref, and a
// listener only reads at the moment of the event anyway.
let locked = false;
const listeners = new Set<() => void>();

export function lock(on: boolean): void {
  if (locked === on) return;
  locked = on;
  listeners.forEach((listener) => listener());
}

export function isLocked(): boolean {
  return locked;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
