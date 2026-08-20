// The viewfinder's zoom steps. Pure computation, no React, no native module,
// both come in from outside (see nativeZoom.ts and ZoomSelector.tsx).
//
// Why this file computes at all instead of just knowing numbers: `expo-camera`
// doesn't take a zoom factor, but a slider from 0 to 1, which iOS maps
// exponentially onto `activeFormat.videoMaxZoomFactor`
// (CameraSessionManager.swift:221). This upper bound isn't readable from
// JavaScript and also changes with the camera format, i.e. between photo
// and video. A hardcoded "4×" would be 2× on one device, 8× on another.
// That's why the native module sets the factor directly, and why the steps
// come from the device instead of a maintained table.

export type LensType =
  | 'ultraWide'
  | 'wide'
  | 'telephoto'
  | 'trueDepth'
  | 'triple'
  | 'dual'
  | 'dualWide'
  | 'unknown';

export type Lens = {
  /** Localized device name, exactly the string `selectedLens` expects. */
  name: string;
  type: LensType;
  /** For virtual devices, the lenses it contains, from widest to longest. */
  components: LensType[];
  /** Factors at which iOS switches to the next lens. */
  switchPoints: number[];
};

export type ZoomDevice = {
  /** Goes to `selectedLens`. */
  name: string;
  /** Display factor that corresponds to the native factor 1.0: 0.5 or 1. */
  base: number;
  /** Display factors of the row, ascending. */
  steps: number[];
};

// Picks, out of all cameras of one facing direction, the one that combines
// the most lenses. That's the virtual multi-lens camera: iOS switches
// between the lenses inside it by itself, seamlessly and without rebuilding
// the session, the reason the pinch doesn't stutter across the steps.
//
// The steps are the device's own switch-over points
// (`virtualDeviceSwitchOverVideoZoomFactors`), i.e. exactly the factors at
// which the lens change happens. They're the same numbers Apple offers in
// the Camera app, and so they line up automatically on every future iPhone.
//
// The native factor 1.0 always means the WIDEST lens. If that's an
// ultra-wide, the same view is called "0.5×" in Apple's counting. The
// conversion key sits in the first switch point: that's where the wide-angle
// lens, which carries display 1×, takes over.
export function zoomDevice(lenses: Lens[]): ZoomDevice | null {
  let best: Lens | null = null;
  for (const lens of lenses) {
    if (!best || lens.components.length > best.components.length) best = lens;
  }
  // Without a switch point there's only one lens and so nothing to choose,
  // iPhone SE, every front camera, and Android, which reports no lenses at all.
  if (!best || best.switchPoints.length === 0) return null;

  const base = best.components[0] === 'ultraWide' ? 1 / best.switchPoints[0] : 1;
  return {
    name: best.name,
    base,
    steps: [1, ...best.switchPoints].map((factor) => factor * base),
  };
}

/** Converts the displayed factor into the device's own counting. */
export function nativeFactor(display: number, base: number): number {
  return display / base;
}

// The device delivers the bounds in ITS OWN counting
// (`minAvailableVideoZoomFactor` / `maxAvailableVideoZoomFactor`), which is
// why the base is threaded in here rather than left to the caller: otherwise
// every clamping call site would have to get the conversion right on its own.
export function clamp(
  display: number,
  bounds: { min: number; max: number },
  base: number
): number {
  return Math.min(Math.max(display, bounds.min * base), bounds.max * base);
}

// From here on the decimal place is dropped. Two digits plus comma plus a
// digit would be five characters, and the step is a small circle: the
// Camera app draws the same line.
const WITHOUT_DECIMAL_FROM = 10;

// One decimal place, and only when it says something: "1×" instead of
// "1.0×". Comma instead of period, because the surface is German
// (DESIGN-LANGUAGE §6).
export function label(factor: number): string {
  const rounded =
    factor >= WITHOUT_DECIMAL_FROM ? Math.round(factor) : Math.round(factor * 10) / 10;
  return `${String(rounded).replace('.', ',')}×`;
}

// The pinch measures the distance between the two fingers. Its ratio to the
// distance at touch-down is the factor by which the zoom changes, so a
// single distance is enough, with no knowledge of where on the image it sits.
export function fingerDistance(fingers: { pageX: number; pageY: number }[]): number | null {
  if (fingers.length < 2) return null;
  return Math.hypot(fingers[1].pageX - fingers[0].pageX, fingers[1].pageY - fingers[0].pageY);
}

// Which step currently applies: the largest one the factor has reached.
// Between two steps the smaller one thus stays active and carries the
// running value, that's how the Camera app does it too, while the pinch is
// running.
export function activeStep(factor: number, steps: number[]): number {
  let active = steps[0];
  for (const step of steps) {
    if (step <= factor) active = step;
  }
  return active;
}

// The shutter's drag zoom (Snapchat pattern): hold and pull upward. `pull`
// is the finger movement since touch-down (positive upward, pt), `start` the
// display factor at capture start, `distances` the stretches that cover the
// full range: upward to the maximum, downward to the minimum (the shutter
// sits almost at the bottom, there isn't much room there, hence two separate
// stretches).
//
// Exponential rather than linear: zoom is multiplicative. Mapped linearly,
// half the stretch would sit between 30× and 60×, even though that's ONE
// doubling step, that feels sluggish at the top and jumpy at the bottom.
// This way every centimeter of travel carries the same factor.
export function dragFactor(
  pull: number,
  start: number,
  bounds: { min: number; max: number },
  base: number,
  distances: { up: number; down: number }
): number {
  const target =
    pull >= 0
      ? start * Math.pow((bounds.max * base) / start, Math.min(pull / distances.up, 1))
      : start * Math.pow((bounds.min * base) / start, Math.min(-pull / distances.down, 1));
  return clamp(target, bounds, base);
}

// Native contract (Task 12): 'wide'/'ultrawide' are passed positionally into
// MultiCameraModule.swift's `setZoom` and compared there against its own
// `cameraNames` list, they must stay exactly as the native side expects.
export type MultiCamCamera = 'front' | 'wide' | 'ultrawide';
export type MultiCamTarget = { camera: MultiCamCamera; factor: number };

export function multiCamTarget(
  display: number,
  facing: 'back' | 'front',
  hasUltraWide: boolean
): MultiCamTarget {
  if (facing === 'front') return { camera: 'front', factor: Math.max(display, 1) };
  // The ultra-wide covers exactly half the field-of-view factor of the wide
  // lens, iOS counts it as 1.0 at display 0.5.
  if (display < 1 && hasUltraWide) return { camera: 'ultrawide', factor: display * 2 };
  return { camera: 'wide', factor: Math.max(display, 1) };
}
