import { render, screen, fireEvent } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import type { RecapMoment } from '@/features/recap/types';
import type { MapPoint } from '@/features/map/types';

// expo-image is a native view, in the test a placeholder that forwards all
// props (`source`, `testID`, `onLoad`, `onError`) is enough. Same pattern as
// in recap/__tests__/overview.test.tsx and player.test.tsx; a real import
// fails during the test run already when loading the module
// (expo-image/src/observe.ts expects a native environment).
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

// Own maps mock instead of the global one from jest.setup.ts: it records
// EVERY value `tracksViewChanges` ever had. The detour is necessary because
// the value only stands at `true` for exactly ONE commit after a prop
// change, exactly the one that lets the pin redraw. React plays out render
// and effect within the same `act()`; in the end state it's back to `false`,
// and a test that only reads the end state couldn't tell "jumps back on"
// apart from "never jumped at all".
const mockTracksHistory: unknown[] = [];
jest.mock('react-native-maps', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => ReactActual.createElement(View, props, props.children),
    Marker: (props: Record<string, unknown>) => {
      mockTracksHistory.push(props.tracksViewChanges);
      return ReactActual.createElement(View, props, props.children);
    },
    Polyline: (props: Record<string, unknown>) => ReactActual.createElement(View, props),
    PROVIDER_DEFAULT: undefined,
  };
});

// Controllable like in recap/__tests__/map.test.tsx: AccessibilityInfo
// always reports "no reduction" during the test run, the branch in the
// skeleton circle would otherwise be dead code from the test's point of view.
let mockReducedMotion = false;
jest.mock('@/theme/useReducedMotion', () => ({ useReducedMotion: () => mockReducedMotion }));

import { MapPin, MapPinMarker } from '../MapPin';

function moment(overrides: Partial<RecapMoment> = {}): RecapMoment {
  return {
    id: 'p1', trip_id: 't1', author_id: 'u1', type: 'photo', duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Lisbon', place_name: 'Lissabon',
    lat: 38.71, lng: -9.14, upload_status: 'uploaded', authorName: 'Lea', authorAvatarKey: null,
    ...overrides,
  };
}

const photoMoment = moment();
const videoMoment = moment({ id: 'p2', type: 'video', duration_s: 12 });

const point: MapPoint = { moment: photoMoment, lat: 38.71, lng: -9.14, index: 0 };
const videoPoint: MapPoint = { moment: videoMoment, lat: 38.71, lng: -9.14, index: 0 };

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);
const wrapper = (ui: React.ReactElement) => <ThemeProvider>{ui}</ThemeProvider>;

// Takes out the recorded history and clears it, so every assertion refers to
// exactly the stretch since the last call.
function tracksSinceThen(): unknown[] {
  return mockTracksHistory.splice(0);
}

// The pulse can't be read off the rendered value: `Animated` flattens the
// opacity to a number and never touches it again under `useNativeDriver` in
// Jest. All that's observable is WHETHER a loop was started, and that's
// exactly what distinguishes the pulsing skeleton from a quiet surface.
let pulseSpy: jest.SpyInstance;

beforeEach(() => {
  mockTracksHistory.length = 0;
  mockReducedMotion = false;
  pulseSpy = jest.spyOn(Animated, 'loop');
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('shows the moment thumbnail', async () => {
  await wrap(<MapPin moment={photoMoment} thumbUrl="https://x/t.jpg" />);
  expect(screen.getByTestId('nadel-bild').props.source.uri).toBe('https://x/t.jpg');
});

// Fix round 1, item 1: THIS is the state you really see on a slow
// connection, the URL has long since arrived, the image hasn't. Before this,
// the skeleton hung on the missing URL and was thereby unreachable on the
// production path: the screen only sets a pin for moments that are in the
// cache.
test('while the image loads, the skeleton underneath it pulses', async () => {
  await wrap(<MapPin moment={photoMoment} thumbUrl="https://x/t.jpg" />);
  expect(screen.getByTestId('nadel-skelett')).toBeTruthy();
  expect(screen.getByTestId('nadel-bild')).toBeTruthy();
  expect(pulseSpy).toHaveBeenCalled();
});

test('once loaded, the skeleton is gone', async () => {
  await wrap(<MapPin moment={photoMoment} thumbUrl="https://x/t.jpg" />);
  await fireEvent(screen.getByTestId('nadel-bild'), 'load');
  expect(screen.queryByTestId('nadel-skelett')).toBeNull();
});

test('a new image source brings the skeleton back', async () => {
  const { rerender } = await wrap(<MapPin moment={photoMoment} thumbUrl="https://x/t.jpg" />);
  await fireEvent(screen.getByTestId('nadel-bild'), 'load');
  await rerender(wrapper(<MapPin moment={photoMoment} thumbUrl="https://x/neu.jpg" />));
  expect(screen.getByTestId('nadel-skelett')).toBeTruthy();
});

// Without an image source, the pin waits on nothing. It shows the same
// circle, but without a pulse: a pulse would promise that something's
// coming.
test('without an image source, a quiet circle stands still', async () => {
  await wrap(<MapPin moment={photoMoment} thumbUrl={null} />);
  expect(screen.getByTestId('nadel-skelett')).toBeTruthy();
  expect(screen.queryByTestId('nadel-bild')).toBeNull();
  expect(pulseSpy).not.toHaveBeenCalled();
});

// DESIGN-LANGUAGE §5/§9: "prefers-reduced-motion" applies to EVERY movement,
// not just the map screen's camera flights. The pulse under the pin is this
// component's one movement, and it runs without any input, until the §9
// review (Task 12) it carried no assertion.
//
// The circle stays visible regardless: "no movement" doesn't mean "no
// indication that an image is on its way".
test('with reduced motion the circle stands still instead of pulsing', async () => {
  mockReducedMotion = true;
  await wrap(<MapPin moment={photoMoment} thumbUrl="https://x/t.jpg" />);
  expect(screen.getByTestId('nadel-skelett')).toBeTruthy();
  expect(pulseSpy).not.toHaveBeenCalled();
});

test('a video additionally carries the play icon', async () => {
  await wrap(<MapPin moment={videoMoment} thumbUrl="https://x/t.jpg" />);
  expect(screen.getByTestId('nadel-video')).toBeTruthy();
});

test('a photo carries no play icon', async () => {
  await wrap(<MapPin moment={photoMoment} thumbUrl="https://x/t.jpg" />);
  expect(screen.queryByTestId('nadel-video')).toBeNull();
});

test('a group shows its count', async () => {
  await wrap(<MapPin moment={photoMoment} thumbUrl="https://x/t.jpg" count={4} />);
  expect(screen.getByText('4')).toBeTruthy();
});

test('a group of one shows no number', async () => {
  await wrap(<MapPin moment={photoMoment} thumbUrl="https://x/t.jpg" count={1} />);
  expect(screen.queryByText('1')).toBeNull();
});

test('reports ready as soon as the image has loaded', async () => {
  const onReady = jest.fn();
  await wrap(<MapPin moment={photoMoment} thumbUrl="https://x/t.jpg" onReady={onReady} />);
  expect(onReady).not.toHaveBeenCalled();
  await fireEvent(screen.getByTestId('nadel-bild'), 'load');
  expect(onReady).toHaveBeenCalled();
});

// An image that never arrives (expired URL, no network) must not leave the
// pin stuck in eternal redrawing, which costs a frame on every pin, every
// frame. After the failure, nothing about the appearance changes anymore.
test('reports ready when the image fails', async () => {
  const onReady = jest.fn();
  await wrap(<MapPin moment={photoMoment} thumbUrl="https://x/t.jpg" onReady={onReady} />);
  await fireEvent(screen.getByTestId('nadel-bild'), 'error');
  expect(onReady).toHaveBeenCalled();
});

// Fix round 1, item 3: without an image source the appearance is settled
// immediately, there's nothing left to wait for. If it didn't report here,
// the marker would redraw it forever on every frame.
test('without an image source, the pin is ready immediately', async () => {
  const onReady = jest.fn();
  await wrap(<MapPin moment={photoMoment} thumbUrl={null} onReady={onReady} />);
  expect(onReady).toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// MapPinMarker: when is the pin allowed to stop redrawing itself?
// ---------------------------------------------------------------------------

test('the pin keeps redrawing until its image is settled, and not after', async () => {
  await wrap(<MapPinMarker point={point} thumbUrl="https://x/t.jpg" />);
  expect(tracksSinceThen().at(-1)).toBe(true);
  await fireEvent(screen.getByTestId('nadel-bild'), 'load');
  expect(tracksSinceThen().at(-1)).toBe(false);
});

// Fix round 1, item 2: `ready` used to hang on the image alone. Task 7 passes
// `count={group.points.length}`, and that changes while zooming, while the
// anchor moment, and thus the image, stays the same. Without this assertion
// the counter pill would stay stuck on "4" even though the group has long
// since become two pins.
test('a changed count lets the pin redraw again', async () => {
  const { rerender } = await wrap(
    <MapPinMarker point={point} thumbUrl="https://x/t.jpg" count={4} />
  );
  await fireEvent(screen.getByTestId('nadel-bild'), 'load');
  expect(tracksSinceThen().at(-1)).toBe(false);

  await rerender(wrapper(<MapPinMarker point={point} thumbUrl="https://x/t.jpg" count={2} />));
  const history = tracksSinceThen();
  expect(history).toContain(true); // jumped back on, the new number gets drawn
  expect(history.at(-1)).toBe(false); // and settles again
});

// Fix round 1, item 4: the reset on a URL change was unbacked, it could have
// been removed without a single thing turning red.
test('a new image source lets the pin redraw again', async () => {
  const { rerender } = await wrap(<MapPinMarker point={point} thumbUrl="https://x/t.jpg" />);
  await fireEvent(screen.getByTestId('nadel-bild'), 'load');
  expect(tracksSinceThen().at(-1)).toBe(false);

  await rerender(wrapper(<MapPinMarker point={point} thumbUrl="https://x/neu.jpg" />));
  // Stays on until the new image has settled too, not just for one commit.
  expect(tracksSinceThen().at(-1)).toBe(true);
  await fireEvent(screen.getByTestId('nadel-bild'), 'load');
  expect(tracksSinceThen().at(-1)).toBe(false);
});

test('a changed moment type lets the pin redraw again', async () => {
  const { rerender } = await wrap(<MapPinMarker point={point} thumbUrl="https://x/t.jpg" />);
  await fireEvent(screen.getByTestId('nadel-bild'), 'load');
  expect(tracksSinceThen().at(-1)).toBe(false);

  await rerender(wrapper(<MapPinMarker point={videoPoint} thumbUrl="https://x/t.jpg" />));
  const history = tracksSinceThen();
  expect(history).toContain(true); // the play icon still has to land on the image
  expect(history.at(-1)).toBe(false);
});

// Fix round 1, item 5: once the marker view is rasterized, the pin is a
// single element for VoiceOver, whatever's inside is no longer reachable
// after that. The label therefore has to hang on the marker.
test('a single pin names the author and the time', async () => {
  await wrap(<MapPinMarker point={point} thumbUrl="https://x/t.jpg" />);
  expect(screen.getByLabelText('Moment von Lea um 10:00 öffnen')).toBeTruthy();
});

// The label has to name the action the tap REALLY triggers. Since Task 7 a
// tap on a group zooms into it (Spec §5.5), nothing gets opened.
// "at this place" would additionally be a lie: grouping happens by 40 screen
// points, and at a continent-wide view those are over 150 km.
test('a group names what the tap does: zoom in', async () => {
  await wrap(<MapPinMarker point={point} thumbUrl="https://x/t.jpg" count={4} />);
  expect(screen.getByLabelText('Auf 4 Momente heranzoomen')).toBeTruthy();
});

// And the group whose tap is no longer a zoom: either every moment sits on
// the exact same coordinate, or the map is at the limit of its zoom levels
// (features/map/clusterTap.ts). Either way the tap opens the sheet with the
// list, and the label has to say so. Which of the two reasons applies is
// known by the screen; the pin only gets told the outcome.
test('a group whose tap opens the sheet names exactly that: view', async () => {
  await wrap(
    <MapPinMarker point={point} thumbUrl="https://x/t.jpg" count={2} opensSheet />
  );
  expect(screen.getByLabelText('2 Momente an diesem Ort ansehen')).toBeTruthy();
});
