// The access point wraps the native module: if it's missing (Android,
// Simulator, old build), it answers with false/null instead of throwing —
// the camera then falls back to the recordAsync path (spec: fallback).
// Native contract (Task 12): this mock stands in for the real native
// module, so its keys mirror CameraCaptureModule.swift's AsyncFunction
// names exactly (startRecording/stopRecording/awaitFile/discard, result
// fields uri/durationS), see the same note in nativeCapture.ts.
const mockNativeModule = {
  startRecording: jest.fn(async (_s: number) => {}),
  stopRecording: jest.fn(async () => ({ uri: 'file://a.mov', durationS: 3.2 })),
  awaitFile: jest.fn(async () => {}),
  discard: jest.fn(async () => {}),
};
let mockAvailable = true;

// Only replace this one function, the rest stays real: the
// `jest.resetModules()` below kicks off Expo's Winter runtime (the `fetch`
// global is lazy-loaded), and that needs `requireNativeModule` from the same
// package.
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: () => (mockAvailable ? mockNativeModule : null),
}));

// The module remembers the native access on first access, so every test has
// to start with a fresh registration state.
function nativeCapture() {
  return require('../nativeCapture') as typeof import('../nativeCapture');
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockAvailable = true;
});

test('startCapture resolves true when the module starts', async () => {
  await expect(nativeCapture().startCapture(90)).resolves.toBe(true);
  expect(mockNativeModule.startRecording).toHaveBeenCalledWith(90);
});

test('without the module, startCapture resolves false instead of throwing', async () => {
  mockAvailable = false;
  await expect(nativeCapture().startCapture(90)).resolves.toBe(false);
});

test('a native start failure becomes false (fallback), not a crash', async () => {
  mockNativeModule.startRecording.mockRejectedValueOnce(new Error('already running'));
  await expect(nativeCapture().startCapture(90)).resolves.toBe(false);
});

test('stopCapture passes uri and durationS through', async () => {
  await expect(nativeCapture().stopCapture()).resolves.toEqual({
    uri: 'file://a.mov',
    durationS: 3.2,
  });
});

test('if stopping fails, null comes back (the camera then shows the error path)', async () => {
  mockNativeModule.stopRecording.mockRejectedValueOnce(new Error('kein writer'));
  await expect(nativeCapture().stopCapture()).resolves.toBeNull();
});

test('fileReady passes the rejection of the write through unchanged', async () => {
  const error = new Error('storage full');
  mockNativeModule.awaitFile.mockRejectedValueOnce(error);
  await expect(nativeCapture().fileReady()).rejects.toBe(error);
});
