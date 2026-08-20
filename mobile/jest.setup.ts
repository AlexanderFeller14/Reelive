// Screen tests render individual screens, not the app, so the SafeAreaProvider
// from src/app/_layout.tsx never gets mounted there, and useSafeAreaInsets
// throws without it. The library ships its own mock for exactly this
// (insets 0, frame at iPhone size); it applies here for all test files, so
// nobody has to set it up individually.
//
// Insets 0 means: the tests run on a device WITHOUT a Dynamic Island, where
// useTopInset passes the designed spacing through unchanged. The math for
// devices WITH the island lives in src/theme/__tests__/useTopInset.test.tsx,
// which checks the hook directly with set insets.
// `.default`, because the mock rebuilds the library as a default export,
// without it the test run gets a { default: ... } and useSafeAreaInsets is
// not a function there.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default
);

// react-native-maps brings native views that don't exist in the test
// environment. The mock instead renders plain Views with the same props
// (incl. testID) and the same children, enough to check WHICH pins the
// screen sets and with what viewport it opens the map, without rendering an
// actual map.
//
// The mock lives here instead of in the test file, because it carries no
// knowledge of any single screen: it stands in for the gap left by the
// native library, and that gap is the same for every test file (the map
// screen today, MapPin and the shared map later).
//
// `animateToRegion`/`setRegion`/`fitToCoordinates` deliberately hang off the
// imperative handle instead of the prop object: the screen calls them via a
// ref, a mock without them would fail every camera move on an
// `undefined is not a function` instead of on an assertion.
//
// `setRegion` is the jump (Reduced Motion, DESIGN-LANGUAGE §5).
// `setNativeProps` is deliberately NOT here, even though MapView has the
// method: it forwards to `this.map`, and that ref is never attached to any
// element in react-native-maps 1.27.2 (`ref={this.map}` appears nowhere),
// the call is a silent no-op on the device. A mock that offered it would
// certify a camera movement that never happens: green test, motionless
// map.
jest.mock('react-native-maps', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  const MockMapView = ReactActual.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    ReactActual.useImperativeHandle(ref, () => ({
      animateToRegion: jest.fn(),
      setRegion: jest.fn(),
      fitToCoordinates: jest.fn(),
    }));
    return ReactActual.createElement(View, props, props.children);
  });
  return {
    __esModule: true,
    default: MockMapView,
    Marker: (props: Record<string, unknown>) => ReactActual.createElement(View, props, props.children),
    Polyline: (props: Record<string, unknown>) => ReactActual.createElement(View, props),
    PROVIDER_DEFAULT: undefined,
  };
});

// avatarUrl() (src/features/auth/avatar.ts) builds the public image URL from
// this variable. Without it, it returns null, and every test that expects a
// profile picture would in truth only be checking the initial-letter case.
// The value is made up and deliberately not a real address: nothing gets
// loaded, the tests only compare the assembled string.
process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'http://test.local:54321';

// @shopify/react-native-skia is a native drawing backend (JSI) that doesn't
// exist in the test environment, the same gap as react-native-maps above.
// The mock renders the drawing nodes as plain Views with the same props
// (incl. testID), enough to check WHAT a component draws and how it reacts
// to taps, without computing a single pixel. `useImage` returns an image
// already loaded at the size of the seal PNG (1254 x 1254), so components
// that wait for a loaded image don't wait forever in the test.
jest.mock('@shopify/react-native-skia', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  // Every drawing node gets a fixed testID after its kind (`skia-oval`,
  // `skia-vertices`, ...): the real Skia components don't know testID, but
  // this way tests can still find the nodes and check their props
  // (vertices, indices, image).
  const node = (kind: string) => (props: Record<string, unknown>) =>
    ReactActual.createElement(View, { testID: `skia-${kind}`, ...props }, props.children);
  return {
    __esModule: true,
    Canvas: node('canvas'),
    Group: node('group'),
    Oval: node('oval'),
    Vertices: node('vertices'),
    ImageShader: node('image-shader'),
    BlurMask: node('blur-mask'),
    useImage: () => ({ width: () => 1254, height: () => 1254 }),
    FilterMode: { Linear: 1, Nearest: 0 },
    MipmapMode: { None: 0, Nearest: 1, Linear: 2 },
  };
});
