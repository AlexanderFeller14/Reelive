// Whether the capture tab is currently showing the VIEWFINDER. The shape of
// the tab bar (app/(tabs)/_layout.tsx) hangs off this: over the camera image
// it sits as a translucent cinema bar ON TOP of the image (DESIGN-LANGUAGE
// §1: UI on photos only translucent), so the viewfinder shows the same full
// area as the preview afterwards: before, the preview showed ~10% less
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
// the bar sits as an overlay over the image, expo-router doesn't export its
// height context (useBottomTabBarHeight) publicly, a deep import into
// build/ would be the more fragile dependency.
export const BAR_CONTENT_HEIGHT = 49;
export const BAR_TOP_PADDING = spacing.s;

export function barHeight(bottomInset: number): number {
  return BAR_CONTENT_HEIGHT + BAR_TOP_PADDING + bottomInset;
}

// The capture's shape: the writer puts every recording into a 1080x1920
// track (CameraCaptureModule), and photos come out of the same stream.
export const CAPTURE_ASPECT = 9 / 16;

// How tall the picture stands on screen, and thereby WHICH picture is seen.
// Filling the whole screen cost 18 % of the width on a tall device (the
// front camera carries 45,3 degrees across, only 37,7 of them reached the
// glass, measured 2026-08-21), and that missing strip still went into the
// recording, unseen. At this height the picture stands whole.
//
// It hangs at the tab bar's top edge, so nothing black stands between the
// picture and the bar; what is left over gathers above, where it merges with
// the status bar. On a screen too short for the full height the picture
// fills what there is and gets cropped, as it always did.
//
// Lives HERE next to barHeight for the same reason: the viewfinder
// (capture/index.tsx) and the preview (preview.tsx) both need it, and they
// must not drift apart. They did once: both drew with `cover` into
// differently tall areas, and the preview came out ~10 % narrower than the
// viewfinder (device finding 2026-08-18).
export function pictureHeight(width: number, height: number, bottomInset: number): number {
  return Math.min(width / CAPTURE_ASPECT, height - barHeight(bottomInset));
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
