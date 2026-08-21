// Access to the native `MultiCamera` module (modules/camera-zoom, file
// MultiCameraModule.swift). This file is the ONLY place that knows it, same
// pattern as nativeCapture.ts and nativeZoom.ts. If the module is missing
// (Android, Simulator, old build) or the setup fails twice in a row, the
// helpers answer with false/null: the screen then falls back to the
// expo-camera path for the rest of the session (runtime fallback, spec
// §8/§9).
import type { ComponentType } from 'react';
import { View, type ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { MultiCamTarget } from './zoom';

// Native contract (Task 12): the raw strings the Swift enum sends over the
// bridge (`PressureLevel.rawValue`). The Swift case identifiers moved to
// English (`.serious`/`.critical`) in this task, but their raw values are
// pinned to the pre-existing German strings on purpose, so this union stays
// unchanged.
type PressureLevel = 'nominal' | 'ernst' | 'kritisch';

// Native contract (Task 12): every method key below is dispatched by name
// against MultiCameraModule.swift's Function/AsyncFunction/Events
// declarations and must keep its exact spelling; only the parameter labels
// (positional, no runtime meaning) and the type's own name are ours to
// translate. Field names `uri`/`durationS`/`width`/`height`/`level` mirror
// the dictionary keys the native side actually sends/expects and stay for
// the same reason.
type NativeMultiCameraModule = {
  isAvailable(): boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  switchCamera(): Promise<'front' | 'back'>;
  setZoom(camera: string, factor: number, smooth: boolean): void;
  focus(x: number, y: number): Promise<void>;
  startRecording(maxSeconds: number): Promise<void>;
  stopRecording(): Promise<{ uri: string; durationS: number }>;
  takePhoto(flash: boolean): Promise<{ uri: string; width: number; height: number }>;
  flash(on: boolean): void;
  stabilization(on: boolean): void;
  addListener(
    eventName: 'pressureChanged',
    listener: (event: { level: PressureLevel }) => void
  ): { remove(): void };
};

// `undefined` means "not looked up yet", `null` means "not present here": on
// Android and in the Simulator that's the normal case, not an error.
let nativeModule: NativeMultiCameraModule | null | undefined;

function getNativeModule(): NativeMultiCameraModule | null {
  if (nativeModule === undefined) {
    nativeModule = requireOptionalNativeModule<NativeMultiCameraModule>('MultiCamera');
  }
  return nativeModule;
}

// Two consecutive setup failures switch off the MultiCam path for the rest
// of the session: no third attempt, `start` and `available` answer false
// right away afterwards. A success resets the counter, so a single slip
// doesn't switch it off yet.
const MAX_CONSECUTIVE_FAILURES = 2;
let consecutiveFailures = 0;
let failed = false;

export function available(): boolean {
  if (failed) return false;
  const m = getNativeModule();
  return m !== null && m.isAvailable();
}

// The session is asked for from two sides ever since the tabs can be swiped:
// the capture screen on focus, and the warm-up while a swipe is still under
// way (warmup.ts). A second `start()` on a RUNNING session would reach the
// native side as "already running", i.e. as a throw, and two throws in a row
// switch the MultiCam path off for the rest of the app session (see
// MAX_CONSECUTIVE_FAILURES above): two swipes would have cost the camera.
// The latch holds the running build-up instead, so whoever asks second gets
// the same promise and the native side is asked exactly once.
let startPromise: Promise<boolean> | null = null;

export function start(): Promise<boolean> {
  if (failed) return Promise.resolve(false);
  if (startPromise) return startPromise;
  const m = getNativeModule();
  if (!m) return Promise.resolve(false);
  startPromise = m
    .start()
    .then(() => {
      consecutiveFailures = 0;
      return true;
    })
    .catch(() => {
      // A failed build-up leaves nothing running, so nothing may be held
      // back: release the latch, otherwise a single slip would freeze the
      // camera until the next stop.
      startPromise = null;
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) failed = true;
      return false;
    });
  return startPromise;
}

export function stop(): void {
  startPromise = null;
  void getNativeModule()
    ?.stop()
    .catch(() => {});
}

export async function switchCamera(): Promise<'front' | 'back' | null> {
  const m = getNativeModule();
  if (!m) return null;
  try {
    return await m.switchCamera();
  } catch {
    return null;
  }
}

export function setZoom(target: MultiCamTarget, smooth: boolean): void {
  getNativeModule()?.setZoom(target.camera, target.factor, smooth);
}

export function focus(x: number, y: number): void {
  void getNativeModule()
    ?.focus(x, y)
    .catch(() => {});
}

// The video capture from our own session. Natively this produces the same
// kind of capture as the nativeCapture pipeline (same target pattern, same
// writer) and hangs off its `current`: everything downstream (fileReady,
// discard, instant preview) therefore keeps running unchanged through
// nativeCapture.ts, only WHO produces the capture changes here. Rejections
// ("already_running", "no_session") become false everywhere in this file, as
// elsewhere: the screen then shows its error pill.
export async function startCapture(maxSeconds: number): Promise<boolean> {
  const m = getNativeModule();
  if (!m) return false;
  try {
    await m.startRecording(maxSeconds);
    return true;
  } catch {
    return false;
  }
}

export async function stopCapture(): Promise<{ uri: string; durationS: number } | null> {
  const m = getNativeModule();
  if (!m) return null;
  try {
    return await m.stopRecording();
  } catch {
    return null;
  }
}

// The photo from our own session (spec §6). The MultiCam session has no
// photo output: the image is the next frame of the running stream, which
// the module drops into tmp as a JPEG. `flash` travels along because only
// the module knows WHEN it's allowed to grab after firing (exposure takes a
// moment to catch up). Rejections ("no_frame", "no_session") become
// null everywhere in this file, as elsewhere: the screen then shows its
// error pill.
export async function takePhoto(
  flash: boolean
): Promise<{ uri: string; width: number; height: number } | null> {
  const m = getNativeModule();
  if (!m) return null;
  try {
    return await m.takePhoto(flash);
  } catch {
    return null;
  }
}

// The continuous light (in the expo-camera branch that's the `enableTorch`
// prop). Synchronous like setZoom: our own session doesn't know props, it
// gets the switch as a call, and there's no response to wait for.
export function setFlash(on: boolean): void {
  getNativeModule()?.flash(on);
}

// Video stabilization for the whole stream; the photo frame grab inherits
// it. Synchronous like setFlash: a wish call with no response to wait for.
// The native default is on, so this only has to carry the toggle.
export function setStabilization(on: boolean): void {
  getNativeModule()?.stabilization(on);
}

// Returns the unsubscribe; without the module a no-op with nothing to
// unsubscribe.
export function onPressureChange(listener: (level: PressureLevel) => void): () => void {
  const m = getNativeModule();
  if (!m) return () => {};
  const subscription = m.addListener('pressureChanged', (event) => listener(event.level));
  return () => subscription.remove();
}

// The viewfinder of the MultiCam path (InstantPreview pattern). Two separate
// cases need the empty fallback view, and they trigger differently: Android
// and Jest don't know the native module at all, there `getNativeModule()`
// returns null, and the first guard kicks in right away, without ever
// calling `requireNativeViewManager`. The Simulator, on the other hand, has
// the module registered (`platforms: ["apple"]`), so the null guard does
// NOT kick in there. That `AVCaptureMultiCamSession.isMultiCamSupported` is
// false on the Simulator is only checked by `isAvailable()` inside the
// module, not by this guard here: on the Simulator the call therefore runs
// all the way to the try/catch, which only catches it if
// `requireNativeViewManager` actually throws there.
function getViewfinderComponent(): ComponentType<ViewProps> {
  if (getNativeModule() === null) return View;
  try {
    return requireNativeViewManager<ViewProps>('MultiCamera');
  } catch {
    return View;
  }
}

export const MultiCameraViewfinder: ComponentType<ViewProps> = getViewfinderComponent();
