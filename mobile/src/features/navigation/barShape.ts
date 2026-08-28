// Which shape the tab bar wears on which route, and where the tabs may be
// swiped. Deliberately free of React: both answers used to sit as a nested
// ternary inside `screenOptions` (app/(tabs)/_layout.tsx), where every test
// had to render the navigator to reach them. As plain functions they stay
// testable while the navigator underneath changes.

/** 'hidden' = no bar at all, 'cinema' = translucent over the camera image, 'plain' = the light bar. */
export type BarShape = 'hidden' | 'cinema' | 'plain';

// The player is full screen (spec 8.2), and the segments arrive UNNORMALISED,
// as the file path spells them: ['(tabs)', 'recap', '[id]', 'player']. All
// three deeper segments are compared: only segments[1] would take the bar
// from every route in the recap tab, only the last one would take it from a
// 'player' segment somewhere else.
function isPlayerRoute(segments: string[]): boolean {
  return segments[1] === 'recap' && segments[2] === '[id]' && segments[3] === 'player';
}

export function barShape(segments: string[], selectedTab: string, viewfinderVisible: boolean): BarShape {
  if (isPlayerRoute(segments)) return 'hidden';
  // The cinema shape hangs off the CHOSEN tab, not off focus: the capture
  // preview covers the tab from outside the navigator (app/preview.tsx), and
  // reading focus here would drop the bar into its light shape invisibly and
  // make it jump on the first frame of the instant way back (device finding
  // 2026-08-18).
  if (selectedTab === 'capture' && viewfinderVisible) return 'cinema';
  return 'plain';
}

// The bar lies over the pager as an overlay in EVERY shape (TabBar.tsx), so
// the pager's height never changes with the chosen tab: the shape follows the
// COMMITTED navigation state, and a bar that took layout height in its plain
// shape made every scene a full bar height shorter until a swipe settled. The
// dragged-in camera scene then stood visibly too high and dropped into place
// at the end of the gesture (device finding 2026-08-28, "der Sucher ist beim
// Swipen höher"). The scenes keep their distance from the bar through scene
// padding instead (app/(tabs)/_layout.tsx), and this function says which
// scene gets it: the capture scene leans its picture on the bar's top edge
// and pads its light states itself, and the player is full screen (spec 8.2),
// so its scene reaches the bottom edge while the bar is hidden.
export function paddedScene(segments: string[], tab: string): boolean {
  if (tab === 'capture') return false;
  if (tab === 'recap' && isPlayerRoute(segments)) return false;
  return true;
}

// Swiping belongs to the four root screens only. One level deeper the iOS
// back swipe owns the same movement, and two gestures fighting over one
// finger is what makes navigation feel broken. `['(tabs)', <tab>]` is exactly
// the root of a tab: the `index` segment of the nested stacks does not
// appear. Anything outside the navigator (preview, auth) swipes nothing.
export function swipeAllowed(segments: string[]): boolean {
  return segments[0] === '(tabs)' && segments.length === 2;
}
