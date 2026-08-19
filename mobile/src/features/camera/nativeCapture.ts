// Access to the native `KameraAufnahme` module (modules/kamera-zoom, file
// KameraAufnahmeModule.swift). This file is the ONLY place that knows it —
// same pattern as nativeZoom.ts. If the module is missing (Android,
// Simulator, old build) or the start fails, the helpers answer with
// false/null: the camera then takes the recordAsync path (fallback per spec
// 2026-08-14-instant-video-vorschau).
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';

// Native contract (Task 12): method keys are dispatched by name against
// KameraAufnahmeModule.swift's AsyncFunction declarations and must keep
// their exact spelling; only the parameter label (positional, no runtime
// meaning) and the return fields `uri`/`dauerS` (the exact dictionary keys
// the native side resolves the promise with) stay for the same reason.
type NativeCaptureModule = {
  aufnahmeStarten(maxSeconds: number): Promise<void>;
  aufnahmeStoppen(): Promise<{ uri: string; dauerS: number }>;
  dateiAbwarten(): Promise<void>;
  verwerfen(): Promise<void>;
};

// `undefined` means "not looked up yet", `null` means "not present here": on
// Android and in the Simulator that's the normal case, not an error.
let nativeModule: NativeCaptureModule | null | undefined;

function getNativeModule(): NativeCaptureModule | null {
  if (nativeModule === undefined) {
    nativeModule = requireOptionalNativeModule<NativeCaptureModule>('KameraAufnahme');
  }
  return nativeModule;
}

export function available(): boolean {
  return getNativeModule() !== null;
}

export async function startCapture(maxSeconds: number): Promise<boolean> {
  const m = getNativeModule();
  if (!m) return false;
  try {
    await m.aufnahmeStarten(maxSeconds);
    return true;
  } catch {
    return false;
  }
}

export async function stopCapture(): Promise<{ uri: string; dauerS: number } | null> {
  const m = getNativeModule();
  if (!m) return null;
  try {
    return await m.aufnahmeStoppen();
  } catch {
    return null;
  }
}

// Resolves once finishWriting is done — the counterpart to photo.file for
// the instant photo. Rejections (storage full) reach the caller unchanged,
// the submit catch surfaces them.
export function fileReady(): Promise<void> {
  const m = getNativeModule();
  if (!m) return Promise.resolve();
  return m.dateiAbwarten();
}

export function discard(): void {
  void getNativeModule()?.verwerfen().catch(() => {});
}

// The native instant preview (AVSampleBufferDisplayLayer): plays the ring
// buffer, then the file, and loops. Comes to life natively in Task 8/9.
export const InstantPreview = requireNativeViewManager('KameraAufnahme');
