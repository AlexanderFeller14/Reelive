import { useLayoutEffect, createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { motion, palette } from '@/theme/tokens';
import type { RecapMoment } from '@/features/recap/types';
import type {
  Viewport,
  Cluster,
  MapSurfaceHandle,
  MapSurfaceProps,
  MapPoint,
} from '@/features/map/types';

// The NATIVE version is checked here: jest resolves `.tsx` (the test
// run's platforms are ios/android/native), `.web.tsx` never comes into
// play here. That's intentional, this is where the CONTRACT lives, not
// Leaflet. The browser version fulfills the same contract with its own
// technology and has its own test file (MapSurface.web.test.tsx).

// Own react-native-maps mock instead of the global one from jest.setup.ts,
// for the same two reasons as in recap/__tests__/map.test.tsx: the
// global one rebuilds its imperative handle on every render and doesn't
// expose it, and every pin's tap has to be REMEMBERED, the last test below
// taps between commit and passive effect, which isn't possible via
// `fireEvent` because its `act()` plays both back together.
const mockAnimateToRegion = jest.fn();
const mockSetRegion = jest.fn();
const mockPresses = new Map<string, () => void>();
jest.mock('react-native-maps', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  const MockMapView = ReactActual.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    ReactActual.useImperativeHandle(ref, () => ({
      animateToRegion: mockAnimateToRegion,
      setRegion: mockSetRegion,
      fitToCoordinates: jest.fn(),
    }));
    return ReactActual.createElement(View, props, props.children);
  });
  return {
    __esModule: true,
    default: MockMapView,
    Marker: (props: Record<string, unknown>) => {
      if (typeof props.onPress === 'function') {
        mockPresses.set(String(props.testID), props.onPress as () => void);
      }
      return ReactActual.createElement(View, props, props.children);
    },
    Polyline: (props: Record<string, unknown>) => ReactActual.createElement(View, props),
    PROVIDER_DEFAULT: undefined,
  };
});
// expo-image is a native view, in the test a placeholder that passes
// through all props is enough. Same pattern as in map.test.tsx; without
// the mock, loading the module already fails, since the pin carries an
// image.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

import { MapSurface } from '../MapSurface';

function moment(overrides: Partial<RecapMoment> = {}): RecapMoment {
  return {
    id: 'p1', trip_id: 't1', author_id: 'u1', type: 'photo', duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Lisbon', place_name: 'Lissabon',
    lat: 38.71, lng: -9.14, upload_status: 'uploaded', authorName: 'Lea', authorAvatarKey: null,
    ...overrides,
  };
}

function point(id: string, lat: number, lng: number, index: number): MapPoint {
  return { moment: moment({ id, lat, lng }), lat, lng, index };
}

const pA = point('p1', 38.71, -9.14, 0);
const pB = point('p2', 38.72, -9.13, 1);
const clusterA: Cluster = { anchor: pA, points: [pA] };
const clusterB: Cluster = { anchor: pB, points: [pB] };
// Both moments at EXACTLY the same coordinate: the one cluster no zoom
// level separates (features/map/clustering.ts, `isSameSpot`).
const pSameSpot = point('p3', 38.71, -9.14, 2);
const sameSpot: Cluster = { anchor: pA, points: [pA, pSameSpot] };
// Two different coordinates: a cluster that can be zoomed apart.
const separable: Cluster = { anchor: pA, points: [pA, pB] };

const VIEWPORT: Viewport = {
  latitude: 38.715, longitude: -9.135, latitudeDelta: 0.02, longitudeDelta: 0.02,
};

const base: MapSurfaceProps = {
  initialViewport: VIEWPORT,
  clusters: [],
  line: [],
  thumbFor: () => null,
  onCluster: () => {},
  // The surface no longer calculates itself whether a tap opens the
  // sheet, it asks (features/map/types.ts). `false` is the normal case: a
  // cluster you can still fly into.
  opensSheet: () => false,
  onViewportChange: () => {},
  reducedMotion: false,
};

function wrap(props: Partial<MapSurfaceProps> = {}, ref?: React.Ref<MapSurfaceHandle>) {
  return render(
    <ThemeProvider>
      <MapSurface ref={ref} {...base} {...props} />
    </ThemeProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPresses.clear();
});

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

test('places one pin per cluster', async () => {
  await wrap({ clusters: [clusterA, clusterB] });
  expect(screen.getAllByTestId(/^map-pin/)).toHaveLength(2);
});

// The pin sits on the ANCHOR of the cluster, not on an average: the anchor
// is a real moment with a real coordinate (clustering.ts).
test('the pin sits on the coordinate of the anchor', async () => {
  await wrap({ clusters: [separable] });
  expect(screen.getByTestId('map-pin-p1').props.coordinate).toEqual({
    latitude: 38.71, longitude: -9.14,
  });
});

test('the pin of a cluster shows its count', async () => {
  await wrap({ clusters: [separable] });
  expect(screen.getByText('2')).toBeTruthy();
});

// `thumbFor` is asked for the ANCHOR, the pin carries its image, not that
// of any member.
test('the pin carries the image of its anchor', async () => {
  const thumbFor = jest.fn((postId: string) => `https://cdn.example/${postId}.jpg`);
  await wrap({ clusters: [separable], thumbFor });
  expect(thumbFor).toHaveBeenCalledWith('p1');
  expect(screen.getByTestId('pin-image').props.source.uri).toBe('https://cdn.example/p1.jpg');
});

// The label has to know the same switch as the tap: if it opens a sheet,
// the label announces that, if it flies in, likewise. If the label
// promises the wrong thing, it's exactly the person with only the label
// who hears it.
test('the pin of a cluster whose tap opens the sheet announces viewing', async () => {
  await wrap({ clusters: [sameSpot], opensSheet: () => true });
  expect(screen.getByLabelText('2 Momente an diesem Ort ansehen')).toBeTruthy();
});

test('the pin of a zoomable cluster announces the zoom', async () => {
  await wrap({ clusters: [separable], opensSheet: () => false });
  expect(screen.getByLabelText('Auf 2 Momente heranzoomen')).toBeTruthy();
});

// The case the earlier version failed on. It calculated the answer
// itself, with `isSameSpot`, and thereby knew only half the reason: since
// the merge fix round of Phase 7, a tap also opens the sheet when the map
// is at the limit of its zoom levels (features/map/clusterTap.ts). The
// moments here sit on DIFFERENT coordinates, `isSameSpot` says no, and the
// pin kept promising a zoom no tap would deliver anymore.
//
// That's why the cluster here is deliberately `separable`: all that
// counts is the screen's answer.
test('the surface does not calculate the answer itself, it asks', async () => {
  await wrap({ clusters: [separable], opensSheet: () => true });
  expect(screen.getByLabelText('2 Momente an diesem Ort ansehen')).toBeTruthy();
  expect(screen.queryByLabelText('Auf 2 Momente heranzoomen')).toBeNull();
});

// And the opposite direction: a cluster at the same spot whose answer is
// `false` gets the zoom label. Without this test, a version that also
// checks `isSameSpot` in addition to the prop and ORs the two together
// would stay green.
test('even a cluster at the same spot follows the answer, not its coordinates', async () => {
  await wrap({ clusters: [sameSpot], opensSheet: () => false });
  expect(screen.getByLabelText('Auf 2 Momente heranzoomen')).toBeTruthy();
});

test('asked with the WHOLE cluster, not just its anchor', async () => {
  const opensSheet = jest.fn(() => false);
  await wrap({ clusters: [separable], opensSheet });
  expect(opensSheet).toHaveBeenCalledWith(separable);
});

// ---------------------------------------------------------------------------
// What the surface reports upward
// ---------------------------------------------------------------------------

test('reports a tap on a cluster upward', async () => {
  const onCluster = jest.fn();
  await wrap({ clusters: [clusterA], onCluster });
  await fireEvent.press(screen.getByTestId(`map-pin-${clusterA.anchor.moment.id}`));
  expect(onCluster).toHaveBeenCalledWith(clusterA);
});

// Not just "some cluster": what's reported is the one the tapped pin
// belongs to. With two pins, a mix-up would otherwise go unnoticed.
test('reports the cluster whose pin was tapped', async () => {
  const onCluster = jest.fn();
  await wrap({ clusters: [clusterA, clusterB], onCluster });
  await fireEvent.press(screen.getByTestId('map-pin-p2'));
  expect(onCluster).toHaveBeenCalledTimes(1);
  expect(onCluster).toHaveBeenCalledWith(clusterB);
});

// The screen clusters by distances in SCREEN points and needs the
// viewport the map is currently showing for that, not the one it opened
// with.
test('reports the visible viewport after every map movement', async () => {
  const onViewportChange = jest.fn();
  await wrap({ clusters: [clusterA], onViewportChange });
  const tight = { latitude: 38.71, longitude: -9.14, latitudeDelta: 0.002, longitudeDelta: 0.002 };
  await fireEvent(screen.getByTestId('map-surface'), 'regionChangeComplete', tight);
  expect(onViewportChange).toHaveBeenCalledWith(tight);
});

test('opens with the given viewport', async () => {
  await wrap({ clusters: [clusterA] });
  expect(screen.getByTestId('map-surface').props.initialRegion).toEqual(VIEWPORT);
});

// ---------------------------------------------------------------------------
// The line
// ---------------------------------------------------------------------------

test('draws the line in the given order', async () => {
  const line = [
    { latitude: 38.71, longitude: -9.14 },
    { latitude: 38.72, longitude: -9.13 },
  ];
  await wrap({ clusters: [clusterA, clusterB], line });
  expect(screen.getByTestId('map-line').props.coordinates).toEqual(line);
});

test('the line is the accent at width 3', async () => {
  const line = [
    { latitude: 38.71, longitude: -9.14 },
    { latitude: 38.72, longitude: -9.13 },
  ];
  await wrap({ line });
  expect(screen.getByTestId('map-line').props.strokeColor).toBe(palette.accent);
  expect(screen.getByTestId('map-line').props.strokeWidth).toBe(3);
});

// A line needs two points, otherwise an overlay would sit on the map that
// connects nothing.
test('a single point yields no line', async () => {
  await wrap({ clusters: [clusterA], line: [{ latitude: 38.71, longitude: -9.14 }] });
  expect(screen.queryByTestId('map-line')).toBeNull();
});

// ---------------------------------------------------------------------------
// The camera
// ---------------------------------------------------------------------------

const TARGET: Viewport = {
  latitude: 38.71, longitude: -9.14, latitudeDelta: 0.004, longitudeDelta: 0.004,
};

test('flyTo() flies the map to the target', async () => {
  const handle = createRef<MapSurfaceHandle>();
  await wrap({ clusters: [clusterA] }, handle);
  handle.current?.flyTo(TARGET);
  expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);
  expect(mockAnimateToRegion).toHaveBeenCalledWith(TARGET, motion.duration.base);
});

// DESIGN-LANGUAGE §5 / Spec K12: with reduced motion it jumps instead of
// flying. `setRegion` is the jump.
test('with reduced motion, flyTo() jumps instead of flying', async () => {
  const handle = createRef<MapSurfaceHandle>();
  await wrap({ clusters: [clusterA], reducedMotion: true }, handle);
  handle.current?.flyTo(TARGET);
  expect(mockAnimateToRegion).not.toHaveBeenCalled();
  expect(mockSetRegion).toHaveBeenCalledTimes(1);
});

// "Jumps" alone isn't an assertion: a jump to 0/0 would be one too. The
// jump has to hit the same target as the flight.
test('the jump hits the same target as the flight', async () => {
  const handle = createRef<MapSurfaceHandle>();
  await wrap({ clusters: [clusterA], reducedMotion: true }, handle);
  handle.current?.flyTo(TARGET);
  expect(mockSetRegion).toHaveBeenCalledWith(TARGET);
});

// The surface moves its camera ONLY on command. Following the
// `initialViewport` prop would chase its own report: every movement
// reports a new viewport upward, which would come back from there, and
// the map would chase itself forever. That's exactly why the prop is
// named the way it is.
test('a new viewport prop does not move the camera by itself', async () => {
  const { rerender } = await wrap({ clusters: [clusterA] });
  await rerender(
    <ThemeProvider>
      <MapSurface {...base} clusters={[clusterA]} initialViewport={TARGET} />
    </ThemeProvider>
  );
  expect(mockAnimateToRegion).not.toHaveBeenCalled();
  expect(mockSetRegion).not.toHaveBeenCalled();
});

// A `flyTo` from the caller's layout effect, immediately after mounting.
// That's exactly how the shared player (Task 15) will use the surface: it
// jumps to the moment from the link on open, without waiting for a user
// action.
//
// Natively, the MapView's ref is already set at commit, so the command
// comes through. The browser version builds its map in a PASSIVE effect
// and would swallow the command without precautions, the same assertion
// therefore stands word for word in MapSurface.web.test.tsx.
function EarlyTarget({ handle }: { handle: React.RefObject<MapSurfaceHandle | null> }) {
  useLayoutEffect(() => {
    handle.current?.flyTo(TARGET);
  }, [handle]);
  return null;
}

test('a flyTo() from the caller\'s layout effect is not lost', async () => {
  const handle = createRef<MapSurfaceHandle>();
  await render(
    <ThemeProvider>
      <MapSurface {...base} clusters={[clusterA]} ref={handle} />
      <EarlyTarget handle={handle} />
    </ThemeProvider>
  );
  expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);
  expect(mockAnimateToRegion).toHaveBeenCalledWith(TARGET, motion.duration.base);
});

// ---------------------------------------------------------------------------
// The tap right after a camera flight
// ---------------------------------------------------------------------------
//
// The surface remembers the cluster state for the next tap in a ref. It's
// written in a LAYOUT effect, not a passive one: a passive one only runs
// after the commit, and in the window in between a tap would still read
// the old state. That's exactly what happens after a camera flight, the
// cluster has fallen apart, the new pin is already there, and tapping it
// immediately would not be found in the old state.
//
// `fireEvent` doesn't hit that window, because its `act()` plays render
// and effects back together. But it exists in the order of layout
// effects: React plays them in tree order, siblings left to right, and
// ALL before the first passive effect. A neighbor to the RIGHT of the
// surface that itself taps in a layout effect hits exactly the moment the
// surface has committed and its passive effect is still pending.
function Tapper({ round, pin }: { round: number; pin: string }) {
  useLayoutEffect(() => {
    // On the first render, the new pin doesn't exist yet.
    if (round === 0) return;
    mockPresses.get(pin)?.();
  }, [round, pin]);
  return null;
}

test('a tap immediately after a cluster falls apart is not swallowed', async () => {
  const onCluster = jest.fn();
  const tree = (round: number, clusters: Cluster[]) => (
    <ThemeProvider>
      <MapSurface {...base} clusters={clusters} onCluster={onCluster} />
      <Tapper round={round} pin="map-pin-p2" />
    </ThemeProvider>
  );
  // Precondition: p2 is a member of the cluster around p1, so has no pin
  // of its own, the tap below applies to one that didn't exist on the
  // render before.
  const { rerender } = await render(tree(0, [separable]));
  expect(screen.queryByTestId('map-pin-p2')).toBeNull();

  await rerender(tree(1, [clusterA, clusterB]));

  expect(onCluster).toHaveBeenCalledTimes(1);
  expect(onCluster).toHaveBeenCalledWith(clusterB);
});

// And the flip side of the same ref: because the cluster state is NOT in
// the tap handler's dependencies, no pin gets a new `onPress` on a map
// movement. Otherwise the `memo` on the marker (MapPin.tsx) would be
// pointless and every pin would send its coordinate across the bridge
// again, even though nothing about it changed.
test('new clusters do not give the pins a new onPress', async () => {
  const onCluster = jest.fn();
  const { rerender } = await wrap({ clusters: [clusterA], onCluster });
  const before = screen.getByTestId('map-pin-p1').props.onPress;

  // A new array with the same content: exactly what every map movement
  // produces (the screen clusters again on every reported viewport).
  await rerender(
    <ThemeProvider>
      <MapSurface {...base} clusters={[clusterA]} onCluster={onCluster} />
    </ThemeProvider>
  );
  expect(screen.getByTestId('map-pin-p1').props.onPress).toBe(before);
});
