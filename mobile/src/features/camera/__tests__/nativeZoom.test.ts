// Access to the native module (modules/camera-zoom). What's checked here is
// NOT the Swift: that doesn't exist in the test and just as little on the
// Simulator, because there's no camera there. What's checked is that the
// app asserts nothing exactly when there's nothing to assert: without a
// native module, no lenses, no bounds, and a zoom call that doesn't throw
// anything off.
const mockLenses = jest.fn();
const mockZoomLimits = jest.fn();
const mockSetZoom = jest.fn();
let mockAvailable = true;

// Only replace this one function, the rest stays real: the
// `jest.resetModules()` below kicks off Expo's Winter runtime (the `fetch`
// global is lazy-loaded), and that needs `requireNativeModule` from the same
// package.
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: () =>
    mockAvailable
      ? { lenses: mockLenses, zoomLimits: mockZoomLimits, setZoom: mockSetZoom }
      : null,
}));

// The module remembers the native access on first access, so every test has
// to start with a fresh registration state.
function nativeZoom() {
  return require('../nativeZoom') as typeof import('../nativeZoom');
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockAvailable = true;
});

test('reports the device lenses', () => {
  mockLenses.mockReturnValue([
    { name: 'Rückseitige Dreifach-Kamera', type: 'triple', parts: ['ultraWide', 'wide', 'telephoto'], switchPoints: [2, 8] },
  ]);
  expect(nativeZoom().lenses('back')).toEqual([
    { name: 'Rückseitige Dreifach-Kamera', type: 'triple', components: ['ultraWide', 'wide', 'telephoto'], switchPoints: [2, 8] },
  ]);
  expect(mockLenses).toHaveBeenCalledWith('back');
});

test('a lens type this app doesn\'t know is called "unknown"', () => {
  // Apple can add a device type at any time. It has to be allowed through
  // here without an unknown string travelling through the code as a type.
  mockLenses.mockReturnValue([{ name: 'Neue Kamera', type: 'builtInIrgendwas', parts: ['wide', 'nochNeuer'], switchPoints: [] }]);
  expect(nativeZoom().lenses('back')).toEqual([
    { name: 'Neue Kamera', type: 'unknown', components: ['wide', 'unknown'], switchPoints: [] },
  ]);
});

test('without a native module (Android, Simulator), there are no lenses', () => {
  mockAvailable = false;
  expect(nativeZoom().lenses('back')).toEqual([]);
});

test('without a native module there are no zoom limits', () => {
  mockAvailable = false;
  expect(nativeZoom().zoomLimits('Rückkamera')).toBeNull();
});

test('without a native module a zoom call goes nowhere, instead of throwing', () => {
  mockAvailable = false;
  expect(() => nativeZoom().setZoom('Rückkamera', 4, true)).not.toThrow();
  expect(mockSetZoom).not.toHaveBeenCalled();
});

test('passes the zoom with factor and ramp through to the device', () => {
  nativeZoom().setZoom('Rückseitige Dreifach-Kamera', 8, true);
  expect(mockSetZoom).toHaveBeenCalledWith('Rückseitige Dreifach-Kamera', 8, true);
});
