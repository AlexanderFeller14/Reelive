// The access point wraps the native MultiCam module: if it's missing
// (Android, Simulator, old build) or the setup fails twice in a row, the
// helpers answer with false/null instead of throwing, the screen then falls
// back to expo-camera (runtime fallback, spec §8/§9).
const mockRemove = jest.fn();
// Native contract (Task 12): this mock stands in for the real native
// module, so its keys mirror MultiKameraModule.swift's Function/
// AsyncFunction/Events names exactly (istVerfuegbar/starten/stoppen/
// wechsleKamera/zoomSetzen/fokussiere/aufnahmeStarten/aufnahmeStoppen/
// fotoAufnehmen/blitz/addListener, event 'druckGeaendert', result fields
// uri/dauerS/breite/hoehe) — see the same note in multiCamera.ts.
const mockNativeModule = {
  istVerfuegbar: jest.fn(() => true),
  starten: jest.fn(async () => {}),
  stoppen: jest.fn(async () => {}),
  wechsleKamera: jest.fn(async () => 'front' as 'front' | 'back'),
  zoomSetzen: jest.fn((_camera: string, _factor: number, _smooth: boolean) => {}),
  fokussiere: jest.fn(async (_x: number, _y: number) => {}),
  aufnahmeStarten: jest.fn(async (_maxSeconds: number) => {}),
  aufnahmeStoppen: jest.fn(async () => ({ uri: 'file://multicam.mov', dauerS: 5.6 })),
  fotoAufnehmen: jest.fn(async (_flash: boolean) => ({
    uri: 'file:///tmp/reelive-foto-1.jpg',
    breite: 1080,
    hoehe: 1920,
  })),
  blitz: jest.fn((_on: boolean) => {}),
  addListener: jest.fn((_event: string, _listener: (payload: unknown) => void) => ({
    remove: mockRemove,
  })),
};
let mockAvailable = true;

// Counts calls to `requireNativeViewManager`, but passes them through to the
// real expo-modules-core implementation: MultiCameraViewfinder's guard is
// thereby checked against the real behavior, and the no-module case can
// still prove that the call is skipped.
const mockRequireNativeViewManagerCalls = jest.fn();

jest.mock('expo-modules-core', () => {
  const actual = jest.requireActual('expo-modules-core') as typeof import('expo-modules-core');
  return {
    ...actual,
    requireOptionalNativeModule: () => (mockAvailable ? mockNativeModule : null),
    requireNativeViewManager: (...args: Parameters<typeof actual.requireNativeViewManager>) => {
      mockRequireNativeViewManagerCalls(...args);
      return actual.requireNativeViewManager(...args);
    },
  };
});

// The module remembers the native access and the failure counter on first
// access, so every test has to start with a fresh registration state.
function multiCamera() {
  return require('../multiCamera') as typeof import('../multiCamera');
}

beforeEach(() => {
  jest.resetModules();
  // `resetAllMocks` instead of `clearAllMocks`: a permanent rejection set in
  // one case (see below, `mockRejectedValue` without `Once`) would otherwise
  // stay in place across the next case, because clearing only empties the
  // call list, not the stored implementation.
  jest.resetAllMocks();
  mockAvailable = true;
  mockNativeModule.istVerfuegbar.mockReturnValue(true);
  mockNativeModule.starten.mockResolvedValue(undefined);
  mockNativeModule.stoppen.mockResolvedValue(undefined);
  mockNativeModule.wechsleKamera.mockResolvedValue('front');
  mockNativeModule.zoomSetzen.mockImplementation(() => {});
  mockNativeModule.fokussiere.mockResolvedValue(undefined);
  mockNativeModule.aufnahmeStarten.mockResolvedValue(undefined);
  mockNativeModule.aufnahmeStoppen.mockResolvedValue({ uri: 'file://multicam.mov', dauerS: 5.6 });
  mockNativeModule.fotoAufnehmen.mockResolvedValue({
    uri: 'file:///tmp/reelive-foto-1.jpg',
    breite: 1080,
    hoehe: 1920,
  });
  mockNativeModule.blitz.mockImplementation(() => {});
  mockNativeModule.addListener.mockImplementation(() => ({ remove: mockRemove }));
});

describe('multiCamera: access to the MultiCam module', () => {
  it('available is false when the module is missing', () => {
    mockAvailable = false;
    expect(multiCamera().available()).toBe(false);
  });

  it('available asks the module (istVerfuegbar)', () => {
    const mc = multiCamera();
    mockNativeModule.istVerfuegbar.mockReturnValueOnce(false);
    expect(mc.available()).toBe(false);
    mockNativeModule.istVerfuegbar.mockReturnValueOnce(true);
    expect(mc.available()).toBe(true);
    expect(mockNativeModule.istVerfuegbar).toHaveBeenCalledTimes(2);
  });

  it('start resolves true on success', async () => {
    await expect(multiCamera().start()).resolves.toBe(true);
    expect(mockNativeModule.starten).toHaveBeenCalledTimes(1);
  });

  it('start resolves false on rejection and switches off for good after the second failure', async () => {
    mockNativeModule.starten.mockRejectedValue(new Error('aufbau_gescheitert'));
    const mc = multiCamera();

    await expect(mc.start()).resolves.toBe(false);
    await expect(mc.start()).resolves.toBe(false);
    expect(mockNativeModule.starten).toHaveBeenCalledTimes(2);

    // Third call: no further attempt, false right away.
    await expect(mc.start()).resolves.toBe(false);
    expect(mockNativeModule.starten).toHaveBeenCalledTimes(2);
    expect(mc.available()).toBe(false);
  });

  it('a success resets the failure counter', async () => {
    const mc = multiCamera();
    mockNativeModule.starten.mockRejectedValueOnce(new Error('aufbau_gescheitert'));

    await expect(mc.start()).resolves.toBe(false);
    await expect(mc.start()).resolves.toBe(true);

    mockNativeModule.starten.mockRejectedValueOnce(new Error('aufbau_gescheitert'));
    await expect(mc.start()).resolves.toBe(false);
    await expect(mc.start()).resolves.toBe(true);

    // All four attempts actually reached the module, none was skipped
    // because of a supposedly permanent failure.
    expect(mockNativeModule.starten).toHaveBeenCalledTimes(4);
  });

  it('setZoom passes camera, factor and smooth through to the module', () => {
    multiCamera().setZoom({ camera: 'weit', factor: 2.5 }, true);
    expect(mockNativeModule.zoomSetzen).toHaveBeenCalledWith('weit', 2.5, true);
  });

  it('switchCamera resolves the new direction, null without the module', async () => {
    mockNativeModule.wechsleKamera.mockResolvedValueOnce('back');
    await expect(multiCamera().switchCamera()).resolves.toBe('back');

    // Fresh registration state: the module access is module-local cached, a
    // mere flip of `mockAvailable` no longer reaches an already loaded
    // instance.
    jest.resetModules();
    mockAvailable = false;
    await expect(multiCamera().switchCamera()).resolves.toBeNull();
  });

  it('onPressureChange reports events and the unsubscribe cleans up', () => {
    const listener = jest.fn();
    const mc = multiCamera();
    const unsubscribe = mc.onPressureChange(listener);

    expect(mockNativeModule.addListener).toHaveBeenCalledWith(
      'druckGeaendert',
      expect.any(Function)
    );
    const forward = mockNativeModule.addListener.mock.calls[0][1] as (payload: {
      stufe: 'nominal' | 'ernst' | 'kritisch';
    }) => void;
    forward({ stufe: 'ernst' });
    expect(listener).toHaveBeenCalledWith('ernst');

    unsubscribe();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it('onPressureChange without the module returns an unsubscribe with no effect, addListener is never called', () => {
    mockAvailable = false;
    const listener = jest.fn();
    const unsubscribe = multiCamera().onPressureChange(listener);

    expect(() => unsubscribe()).not.toThrow();
    expect(mockNativeModule.addListener).not.toHaveBeenCalled();
  });

  // The MultiCam path's video capture (Task 5). It natively produces the
  // same kind of capture as the KameraAufnahme module, just without its
  // search for the expo-camera viewfinder; only the pass-through is visible
  // above here.
  it('startCapture passes the max duration through and reports success', async () => {
    await expect(multiCamera().startCapture(90)).resolves.toBe(true);
    expect(mockNativeModule.aufnahmeStarten).toHaveBeenCalledWith(90);
  });

  it('startCapture resolves false on rejection and without the module', async () => {
    // "laeuft_schon" or "keine_session": the screen should show the error
    // pill, not break on a rejection.
    mockNativeModule.aufnahmeStarten.mockRejectedValueOnce(new Error('keine_session'));
    await expect(multiCamera().startCapture(90)).resolves.toBe(false);

    jest.resetModules();
    mockAvailable = false;
    await expect(multiCamera().startCapture(90)).resolves.toBe(false);
  });

  it('stopCapture resolves file and duration, null on rejection and without the module', async () => {
    const mc = multiCamera();
    await expect(mc.stopCapture()).resolves.toEqual({
      uri: 'file://multicam.mov',
      dauerS: 5.6,
    });

    mockNativeModule.aufnahmeStoppen.mockRejectedValueOnce(new Error('keine_aufnahme'));
    await expect(mc.stopCapture()).resolves.toBeNull();

    jest.resetModules();
    mockAvailable = false;
    await expect(multiCamera().stopCapture()).resolves.toBeNull();
  });

  // The MultiCam path's photo (Task 6). It's natively produced by grabbing
  // the running stream (no second photo output, spec §6): the next frame of
  // the active camera becomes a JPEG and lands in tmp. Only the
  // pass-through, including the flash wish, is visible above here.
  it('takePhoto passes the flash wish through and resolves file and dimensions', async () => {
    await expect(multiCamera().takePhoto(true)).resolves.toEqual({
      uri: 'file:///tmp/reelive-foto-1.jpg',
      breite: 1080,
      hoehe: 1920,
    });
    expect(mockNativeModule.fotoAufnehmen).toHaveBeenCalledWith(true);
  });

  it('takePhoto resolves null on rejection and without the module', async () => {
    // "kein_frame" (the session delivers nothing more) or "keine_session":
    // the screen should show its error pill, not break on a rejection.
    mockNativeModule.fotoAufnehmen.mockRejectedValueOnce(new Error('kein_frame'));
    await expect(multiCamera().takePhoto(false)).resolves.toBeNull();

    jest.resetModules();
    mockAvailable = false;
    await expect(multiCamera().takePhoto(false)).resolves.toBeNull();
  });

  it('setFlash passes the switch through; without the module simply nothing happens', () => {
    const mc = multiCamera();
    mc.setFlash(true);
    expect(mockNativeModule.blitz).toHaveBeenCalledWith(true);
    mc.setFlash(false);
    expect(mockNativeModule.blitz).toHaveBeenLastCalledWith(false);

    jest.resetModules();
    mockAvailable = false;
    expect(() => multiCamera().setFlash(true)).not.toThrow();
    expect(mockNativeModule.blitz).toHaveBeenCalledTimes(2);
  });

  it('MultiCameraViewfinder without the module is the empty fallback view, requireNativeViewManager is never called', () => {
    mockAvailable = false;
    // Same fresh registration state as for the module access: `View` has to
    // come from the same `require` pass as `multiCamera`, or `toBe` would
    // compare two different react-native module instances against each
    // other.
    const rnView = (require('react-native') as typeof import('react-native')).View;
    const mc = multiCamera();

    expect(mc.MultiCameraViewfinder).toBe(rnView);
    expect(mockRequireNativeViewManagerCalls).not.toHaveBeenCalled();
  });
});
