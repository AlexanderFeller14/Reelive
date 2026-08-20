// Access to the native module `modules/camera-zoom` (Swift, see
// CameraZoomModule.swift there). This file is the ONLY place that knows it.
//
// Why bother with our own Swift at all: `expo-camera` doesn't take a zoom
// factor, but a slider from 0 to 1 that iOS maps exponentially onto
// `activeFormat.videoMaxZoomFactor`, a number JavaScript can't read and
// which also changes between photo and video format. The module sets
// `videoZoomFactor` directly instead. It also supplies the device's switch
// points, from which the steps arise (see zoom.ts), and the mapping from
// device type to localized name: `expo-camera` selects lenses via
// `localizedName` (CameraSessionManager.swift:91), and that reads
// differently on a German iPhone than on an English one.
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { Lens, LensType } from './zoom';

// Native contract (Task 12): mirrors the dictionary `Function("lenses")`
// returns from CameraZoomModule.swift verbatim (`name`/`type`/`parts`/
// `switchPoints`), so these keys stay exactly as the native side sends
// them. `lenses()` below reshapes this into the public `Lens` type.
type NativeLens = {
  name: string;
  type: string;
  parts: string[];
  switchPoints: number[];
};

// Native contract (Task 12): method keys are dispatched by name against
// CameraZoomModule.swift's Function/AsyncFunction declarations and must
// keep their exact spelling; only the parameter labels (positional, no
// runtime meaning) are ours to translate.
type NativeZoomModule = {
  lenses(position: 'back' | 'front'): NativeLens[];
  zoomLimits(name: string): { min: number; max: number } | null;
  setZoom(name: string, factor: number, smooth: boolean): void;
  focus(x: number, y: number): Promise<void>;
};

// `undefined` means "not looked up yet", `null` means "not present here": on
// Android and in the Simulator that's the normal case, not an error.
let nativeModule: NativeZoomModule | null | undefined;

function getNativeModule(): NativeZoomModule | null {
  if (nativeModule === undefined) nativeModule = requireOptionalNativeModule<NativeZoomModule>('CameraZoom');
  return nativeModule;
}

const KNOWN_TYPES: LensType[] = [
  'ultraWide',
  'wide',
  'telephoto',
  'trueDepth',
  'triple',
  'dual',
  'dualWide',
];

// Apple can add a device type at any time. It has to be allowed through
// without an unknown string travelling onward as a type: the calculation
// in zoom.ts only ever asks for `ultraWide`, it treats everything else the
// same.
function toType(raw: string): LensType {
  return (KNOWN_TYPES as string[]).includes(raw) ? (raw as LensType) : 'unknown';
}

export function lenses(position: 'back' | 'front'): Lens[] {
  const native = getNativeModule();
  if (!native) return [];
  return native.lenses(position).map((lens) => ({
    name: lens.name,
    type: toType(lens.type),
    components: lens.parts.map(toType),
    switchPoints: lens.switchPoints,
  }));
}

/** Bounds in the device's own counting, not the displayed one. */
export function zoomLimits(name: string): { min: number; max: number } | null {
  return getNativeModule()?.zoomLimits(name) ?? null;
}

/** `smooth` ramps in (like the Camera app for a tap on a step), otherwise it's set hard and follows the finger. */
export function setZoom(name: string, factor: number, smooth: boolean): void {
  getNativeModule()?.setZoom(name, factor, smooth);
}

/**
 * Focus and exposure at the point, in window coordinates (pageX/pageY). The
 * conversion into device coordinates is handled natively by the preview
 * layer (including orientation and aspect-fill cropping), and it resets by
 * itself as soon as the scene changes (subject-area monitoring). That too
 * lives in our own module: expo-camera only knows the global autoFocus
 * mode, no focus point.
 */
export function focus(x: number, y: number): void {
  void getNativeModule()?.focus(x, y).catch(() => {});
}
