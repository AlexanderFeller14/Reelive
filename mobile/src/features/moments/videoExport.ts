// Access to the native `VideoExport` module (modules/camera-zoom, file
// VideoExportModule.swift). This file is the ONLY place that knows it, same
// pattern as camera/multiCamera.ts. If the module is missing (Android, web,
// Jest, an old build) a video passes through unchanged: that is the state
// the app shipped in before this module existed.
import { requireOptionalNativeModule } from 'expo-modules-core';

// Native contract: every method and event key below is dispatched by name
// against VideoExportModule.swift and must keep its exact spelling.
type NativeVideoExportModule = {
  videoCodec(uri: string): Promise<string | null>;
  exportH264(uri: string, exportId: string): Promise<{ uri: string }>;
  addListener(
    eventName: 'exportProgress',
    listener: (event: { exportId: string; progress: number }) => void
  ): { remove(): void };
};

// `undefined` means "not looked up yet", `null` means "not present here".
let nativeModule: NativeVideoExportModule | null | undefined;

function getNativeModule(): NativeVideoExportModule | null {
  if (nativeModule === undefined) {
    nativeModule = requireOptionalNativeModule<NativeVideoExportModule>('VideoExport');
  }
  return nativeModule;
}

export function available(): boolean {
  return getNativeModule() !== null;
}

// The four-character code AVFoundation reports for H.264 tracks. Camera
// clips (CameraCaptureModule) and older library videos carry it; modern
// iPhones record HEVC ("hvc1") by default.
export const H264 = 'avc1';

export type EnsureH264Result = { uri: string; converted: boolean };

let exportCounter = 0;

// Hands back an H.264 file for the video: the file itself when it already
// is H.264, when the codec cannot be read (the export would be a blind
// guess), or when the module is missing; otherwise a fresh export in tmp
// that the caller owns and releases. `onProgress` gets 0..1 during an
// export only, and ends on 1.
export async function ensureH264(
  uri: string,
  onProgress: (progress: number) => void
): Promise<EnsureH264Result> {
  const m = getNativeModule();
  if (!m) return { uri, converted: false };
  let codec: string | null;
  try {
    codec = await m.videoCodec(uri);
  } catch (error) {
    console.warn('[videoExport] codec lookup failed', uri, error);
    return { uri, converted: false };
  }
  if (codec === null || codec === H264) return { uri, converted: false };
  exportCounter += 1;
  const exportId = `${Date.now()}-${exportCounter}`;
  // Several exports never run at once (the batch is sequential), but the
  // id keeps the events honest should that ever change.
  const subscription = m.addListener('exportProgress', (event) => {
    if (event.exportId === exportId) onProgress(Math.max(0, Math.min(1, event.progress)));
  });
  try {
    const result = await m.exportH264(uri, exportId);
    onProgress(1);
    return { uri: result.uri, converted: true };
  } finally {
    subscription.remove();
  }
}
