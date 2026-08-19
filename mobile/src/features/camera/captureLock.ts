// While a capture is running (photo cycle or video) the tab bar must not be
// operable: a tab switch fires the focus cleanup in the middle of the
// running session (re-hanging mute would be a session reconfiguration, see
// the comment on the CameraView) and navigates away from a capture that is
// about to go to the preview.
//
// The camera screen sets the flag, the tab navigator reads it synchronously
// in the tabPress listener (app/(tabs)/_layout.tsx). Deliberately no state
// and no context: the photo cycle lives in a ref (no re-render a prop change
// could hang off), and a listener only reads at the moment of the event
// anyway. Same holder pattern as handoff.ts.
let locked = false;

export function lock(on: boolean): void {
  locked = on;
}

export function isLocked(): boolean {
  return locked;
}
