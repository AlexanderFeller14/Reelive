// Whether the capture tab is currently showing the VIEWFINDER. The shape of
// the tab bar (app/(tabs)/_layout.tsx) hangs off this: over the camera image
// it sits as a translucent cinema bar ON TOP of the image (DESIGN-LANGUAGE
// §1: UI on photos only translucent), so the viewfinder shows the same full
// area as the preview afterwards — before, the preview showed ~10% less
// image width than the viewfinder, because both drew with `cover` into
// differently tall areas (device finding 2026-08-18, "more cropped than
// before I shoot"). The light states of the same tab (missing permission, no
// trip) keep the normal light bar.
//
// The camera screen sets the flag (the same condition as its StatusBar
// switch), the tab navigator reads it. Unlike captureLock, a holder alone
// isn't enough: the bar has to RE-RENDER on the change, so there is a
// subscription here for useSyncExternalStore.
import { spacing } from '@/theme/tokens';

let visible = false;
const listeners = new Set<() => void>();

// The UIKit default height of the tab bar content (49 points; expo-router's
// renderer constant TABBAR_HEIGHT_UIKIT, not exported, hence tracked here
// separately; only portrait matters, the app is locked to it per app.json)
// plus one grid step of air above the icons (§3). The formula lives HERE
// because both sides need it: _layout.tsx makes the bar exactly this tall,
// and the camera screen lifts its bottom controls by the same amount once
// the bar sits as an overlay over the image — expo-router doesn't export its
// height context (useBottomTabBarHeight) publicly, a deep import into
// build/ would be the more fragile dependency.
export const BAR_CONTENT_HEIGHT = 49;
export const BAR_TOP_PADDING = spacing.s;

export function barHeight(bottomInset: number): number {
  return BAR_CONTENT_HEIGHT + BAR_TOP_PADDING + bottomInset;
}

export function set(on: boolean): void {
  if (visible === on) return;
  visible = on;
  listeners.forEach((listener) => listener());
}

export function get(): boolean {
  return visible;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
