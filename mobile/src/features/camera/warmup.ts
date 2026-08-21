// Whether the camera session should already be running although the capture
// tab does not hold focus yet. Since the tabs can be swiped, the screen
// arrives gradually instead of at once: the pager reports its position
// continuously, and as soon as the finger drags towards the capture tab the
// session starts, so the viewfinder stands when the screen gets there.
// Waiting for focus would mean dragging a black surface through the whole
// gesture.
//
// Same shape as cinemaStage.ts: the tab bar sets the flag (that is where the
// pager's position is available, features/navigation/TabBar.tsx), the camera
// screen reads it through useSyncExternalStore, so a change re-renders it.
let warm = false;
const listeners = new Set<() => void>();

// How close the pager's position has to come to the capture tab, measured in
// tab widths: 0.9 means the first tenth of the way is enough. The session
// needs a moment to build up (see multiCamera.start), so this fires early on
// purpose. The same number read from the other side means: whoever swipes
// AWAY from the camera only lets go of the flag once nine tenths of the way
// are done, so a swipe turned back halfway never kills a running session.
export const NEAR_ENOUGH = 0.9;

export function set(on: boolean): void {
  if (warm === on) return;
  warm = on;
  listeners.forEach((listener) => listener());
}

export function get(): boolean {
  return warm;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
