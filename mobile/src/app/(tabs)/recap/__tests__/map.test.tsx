import { useLayoutEffect } from 'react';
import {
  Animated,
  Dimensions,
  StyleSheet,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { act, render, screen, fireEvent, within } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { motion, palette } from '@/theme/tokens';
import type { MediaUrl } from '@/features/recap/urlPool';
import type { RecapMoment } from '@/features/recap/types';
import type { Viewport } from '@/features/map/types';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = true;
let mockId = 't1';
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: () => mockCanGoBack }),
  useLocalSearchParams: () => ({ id: mockId }),
}));
jest.mock('@/features/recap/recapApi', () => ({ fetchRecapMoments: jest.fn() }));
// `jest.requireActual` below pulls @/lib/supabase in with it, so its mock has
// to sit right here (same pattern as player.test.tsx). `retryHelps` stays
// real: it is the rule deciding whether a second try can achieve anything.
jest.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock('@/features/recap/urlPool', () => ({
  ...jest.requireActual('@/features/recap/urlPool'),
  getPool: jest.fn(),
}));
jest.mock('@/lib/errorReporter', () => ({ reportError: jest.fn() }));
jest.mock('@/features/trips/tripsApi', () => ({ fetchTrip: jest.fn() }));
// expo-image is a native view, a placeholder forwarding all props is enough
// here. Without the mock the module does not even load
// (expo-image/src/observe.ts expects a native environment).
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});
// Spy WITH the real implementation: the pins below still come out of the real
// computation, but the list the screen feeds in has to be assertable. It is
// the one place on this screen where a mistake would stay silent, because
// `point.index` later travels to the player as `start` and counts into the
// filtered playlist. Fed the raw moment list, the pins would sit at the same
// coordinates and every jump would land on the wrong moment.
jest.mock('@/features/map/mapPoints', () => {
  const actual = jest.requireActual('@/features/map/mapPoints');
  return { toMapPoints: jest.fn(actual.toMapPoints) };
});
let mockReducedMotion = false;
jest.mock('@/theme/useReducedMotion', () => ({ useReducedMotion: () => mockReducedMotion }));
const mockHaptics = jest.fn(() => Promise.resolve());
jest.mock('expo-haptics', () => ({ selectionAsync: () => mockHaptics() }));
// Own maps mock instead of the global one from jest.setup.ts, for two reasons
// that both hang on the imperative handle:
//
// 1. The global mock rebuilds its `jest.fn()` on every render and never hands
//    them out, so no assertion can reach them.
// 2. `tracksViewChanges` is `true` for exactly ONE commit after a prop change,
//    the one that redraws the pin. React plays render and effect inside the
//    same `act()`, and the end state is `false` again, so a test reading only
//    the end state could not tell "turned back on" from "never turned on".
//    Same detour as in components/__tests__/MapPin.test.tsx.
const mockAnimateToRegion = jest.fn();
const mockSetRegion = jest.fn();
const mockTracksHistory: { id: unknown; tracks: unknown }[] = [];
// Every pin's onPress, remembered AT RENDER TIME. The last test of this file
// needs it to tap exactly between commit and passive effect, which `fireEvent`
// cannot do because its `act()` plays both together.
const mockPresses = new Map<string, () => void>();
jest.mock('react-native-maps', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  const MapViewMock = ReactActual.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    ReactActual.useImperativeHandle(ref, () => ({
      animateToRegion: mockAnimateToRegion,
      setRegion: mockSetRegion,
      fitToCoordinates: jest.fn(),
    }));
    return ReactActual.createElement(View, props, props.children);
  });
  return {
    __esModule: true,
    default: MapViewMock,
    Marker: (props: Record<string, unknown>) => {
      mockTracksHistory.push({ id: props.testID, tracks: props.tracksViewChanges });
      if (typeof props.onPress === 'function') {
        mockPresses.set(String(props.testID), props.onPress as () => void);
      }
      return ReactActual.createElement(View, props, props.children);
    },
    Polyline: (props: Record<string, unknown>) => ReactActual.createElement(View, props),
    PROVIDER_DEFAULT: undefined,
  };
});

import RecapMap from '../[id]/map';
import { SHEET_SCROLL_RATIO } from '@/components/Sheet';
import { fetchRecapMoments } from '@/features/recap/recapApi';
import { getPool } from '@/features/recap/urlPool';
import { reportError } from '@/lib/errorReporter';
import { fetchTrip } from '@/features/trips/tripsApi';
import { toMapPoints } from '@/features/map/mapPoints';
import type { Trip } from '@/features/trips/types';

function moment(overrides: Partial<{
  id: string;
  captured_at: string;
  captured_tz: string;
  lat: number | null;
  lng: number | null;
  upload_status: 'pending' | 'uploaded';
  authorName: string;
  place_name: string | null;
  caption: string | null;
}>) {
  return {
    id: 'p0', trip_id: 't1', author_id: 'u1', type: 'photo' as const, duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Lisbon', place_name: 'Lissabon',
    lat: 38.71, lng: -9.14,
    upload_status: 'uploaded' as const, authorName: 'Lea', authorAvatarKey: null,
    ...overrides,
  };
}

// Two moments in Lisbon that get one pin, and three that must not get one,
// each for a different reason:
//
// - p5 is 'uploaded' but has no url in the pool. It lies in TOKYO and
//   chronologically BEFORE everything else, both on purpose: up front so an
//   index counted over the unfiltered list shifts everything behind it, in
//   Tokyo so a viewport counting it in visibly spans half the planet.
// - p4 is still uploading ('pending') and lies in SYDNEY for the same reason.
//   It deliberately has a url in the pool (see POOL_OK), otherwise
//   `urls.has(m.id)` would sort it out already and the `upload_status` filter
//   would be covered by no test at all.
// - p3 is visible but has no place (lat/lng null). It belongs in the playlist
//   (and therefore in the index count) but not on the map.
const withoutUrlM = moment({ id: 'p5', captured_at: '2026-08-10T07:00:00.000Z', lat: 35.68, lng: 139.69 });
const m1 = moment({ id: 'p1', captured_at: '2026-08-10T09:00:00.000Z', lat: 38.71, lng: -9.14 });
const m2 = moment({ id: 'p2', captured_at: '2026-08-10T18:00:00.000Z', lat: 38.72, lng: -9.13 });
const pendingM = moment({
  id: 'p4', captured_at: '2026-08-10T20:00:00.000Z', lat: -33.86, lng: 151.21, upload_status: 'pending',
});
const m3 = moment({ id: 'p3', captured_at: '2026-08-11T10:00:00.000Z', lat: null, lng: null });

// Already sorted chronologically, the way fetchRecapMoments delivers them.
const COMPLETE = [withoutUrlM, m1, m2, pendingM, m3];

// ---------------------------------------------------------------------------
// Two moments that share a pin
// ---------------------------------------------------------------------------
//
// Every number below hangs on the window size of the test run: jest-expo
// reports 750 x 1334 points. At a span of 0.01 degrees one degree of
// longitude is 75'000 points and one of latitude 133'400, so a ten thousandth
// of a degree is 7.5 respectively 13.3 points. The two moments therefore lie
// about 15 points apart, below CLUSTER_DISTANCE_PT (40).
//
// The id stays p2 so POOL_OK still fits unchanged: it is the same second
// moment as above, one street further instead of one district.
const m2Near = moment({ id: 'p2', captured_at: '2026-08-10T18:00:00.000Z', lat: 38.7101, lng: -9.1401 });
const CLOSE_TOGETHER = [m1, m2Near];

// Zoomed in: at a span of 0.002 degrees the same two moments lie about 76
// points apart and the cluster falls apart.
const NARROW = { latitude: 38.71005, longitude: -9.14005, latitudeDelta: 0.002, longitudeDelta: 0.002 };
// And one in between: about 31 points apart, the cluster holds, but the
// viewport is already NARROWER than the minimum span of `viewportFor`
// (0.01 degrees). This is exactly where an unbounded target led outwards.
const MEDIUM = { ...NARROW, latitudeDelta: 0.005, longitudeDelta: 0.005 };

// Return type spelled out as MediaUrl: `thumb_url` is `string | null` there,
// and without it POOL_OK would inherit a too narrow `string`, so a pool
// without a thumbnail could not be passed in at all (see POOL_WITHOUT_THUMB).
function image(id: string): MediaUrl {
  return { post_id: id, medium_url: `https://cdn.example/${id}-medium.jpg`, thumb_url: `https://cdn.example/${id}-thumb.jpg` };
}

// p4 is deliberately in here although it is still uploading: that way the
// `upload_status` filter is the ONLY one left that sorts it out, and each of
// the screen's two filter conditions has its own counter example (p4 for
// `upload_status`, p5 for `urls.has`). That the edge function `media-urls`
// only signs for uploaded moments anyway is no argument against it: the
// screen must not rely on that, and no test of this screen would know of it.
const POOL_OK = {
  urls: new Map([['p1', image('p1')], ['p2', image('p2')], ['p3', image('p3')], ['p4', image('p4')]]),
  gueltigBis: Date.now() + 999_999,
  ausgelassen: 1,
};

// The generic load error, word for word the same as in urlPool.ts and
// recapApi.ts: a snapshot without a `reason`, where a second try is right.
const LOAD_ERROR = 'Die Momente konnten nicht geladen werden. Probier es gleich nochmal.';

const POOL_WITHOUT_THUMB = {
  ...POOL_OK,
  urls: new Map<string, MediaUrl>([
    ...POOL_OK.urls,
    ['p1', { post_id: 'p1', medium_url: image('p1').medium_url, thumb_url: null }],
  ]),
};

// A pool as an older version of the function can deliver it: `medium_url` is
// missing entirely. `MediaUrl` promises a `string` there, but urlPool.ts
// copies the field through unchecked, so the type lies. That is why the way
// around it is a cast: it mirrors what arrives at runtime, not what the type
// claims.
const POOL_WITHOUT_ANY_IMAGE = {
  ...POOL_OK,
  urls: new Map<string, MediaUrl>([
    ...POOL_OK.urls,
    ['p1', { post_id: 'p1', thumb_url: null } as unknown as MediaUrl],
  ]),
};

const wrap = () => render(<ThemeProvider><RecapMap /></ThemeProvider>);

// The trip the day numbers are counted from. `start_date` is the only value
// this screen needs of it, the rest stands here because `Trip` demands it.
const TRIP: Trip = {
  id: 't1', name: 'Lissabon Städtetrip', start_date: '2026-08-10', end_date: '2026-08-14',
  status: 'revealed', owner_id: 'u1', members: [], member_count: 1, my_post_count: 0,
};

function loadSuccess(moments = COMPLETE, pool = POOL_OK, trip: Partial<Trip> = {}) {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...TRIP, ...trip }, error: null });
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: moments, error: null });
  (getPool as jest.Mock).mockResolvedValue({ pool, error: null, reason: null });
}

// Takes the recorded values of ONE pin out and empties the history. Filtered
// by id because a second pin joins when a cluster falls apart, and that one
// is naturally drawn fresh.
function tracksSince(id: string): unknown[] {
  const own = mockTracksHistory.filter((e) => e.id === id).map((e) => e.tracks);
  mockTracksHistory.length = 0;
  return own;
}

beforeEach(() => {
  jest.clearAllMocks();
  // A baseline for the trip query that every test can overwrite:
  // `clearAllMocks` only clears the calls, not the implementation set last.
  (fetchTrip as jest.Mock).mockResolvedValue({ data: TRIP, error: null });
  mockCanGoBack = true;
  mockId = 't1';
  mockReducedMotion = false;
  mockTracksHistory.length = 0;
  mockPresses.clear();
  // The window size is module wide state and the last test below changes it.
  // Without this reset every test after it would compute with a different
  // screen, and the distances in screen points that all clustering rests on
  // would no longer hold.
  Dimensions.set({ window: ORIGINAL_WINDOW, screen: ORIGINAL_SCREEN });
});

test('sets one pin per moment that has a place', async () => {
  loadSuccess();
  await wrap();
  expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(2);
  expect(screen.getByTestId('karte-nadel-p1')).toBeTruthy();
  expect(screen.getByTestId('karte-nadel-p2')).toBeTruthy();
});

test('the pin sits on exactly the coordinate of its moment', async () => {
  loadSuccess();
  await wrap();
  const pin = await screen.findByTestId('karte-nadel-p2');
  expect(pin.props.coordinate).toEqual({ latitude: 38.72, longitude: -9.13 });
});

test('moments without a place get no pin', async () => {
  loadSuccess();
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  expect(screen.queryByTestId('karte-nadel-p3')).toBeNull();
});

// Deliberately TWO tests instead of one with two assertions: the screen
// filters on two conditions, and each needs a test that goes red on its own.
// In a shared test there would be no reading off which of the two is missing.
test('a moment still uploading gets no pin, even with a url in the pool', async () => {
  loadSuccess();
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  expect(screen.queryByTestId('karte-nadel-p4')).toBeNull();
});

test('a moment without an image in the pool gets no pin', async () => {
  loadSuccess();
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  expect(screen.queryByTestId('karte-nadel-p5')).toBeNull();
});

test('every pin carries the thumbnail of its own moment', async () => {
  loadSuccess();
  await wrap();
  const pin = await screen.findByTestId('karte-nadel-p2');
  expect(within(pin).getByTestId('nadel-bild').props.source.uri).toBe(image('p2').thumb_url);
});

test('with the thumbnail missing the pin takes the medium image', async () => {
  loadSuccess(COMPLETE, POOL_WITHOUT_THUMB);
  await wrap();
  const pin = await screen.findByTestId('karte-nadel-p1');
  expect(within(pin).getByTestId('nadel-bild').props.source.uri).toBe(image('p1').medium_url);
});

test('without any image source the pin shows no image node', async () => {
  loadSuccess(COMPLETE, POOL_WITHOUT_ANY_IMAGE);
  await wrap();
  const pin = await screen.findByTestId('karte-nadel-p1');
  expect(within(pin).queryByTestId('nadel-bild')).toBeNull();
  expect(within(pin).getByTestId('nadel-skelett')).toBeTruthy();
});

test('without any image source the pin still stops drawing itself', async () => {
  loadSuccess(COMPLETE, POOL_WITHOUT_ANY_IMAGE);
  await wrap();
  const pin = await screen.findByTestId('karte-nadel-p1');
  expect(pin.props.tracksViewChanges).toBe(false);
});

// The marker is rasterised, so whatever stands inside the pin is no longer
// reachable for VoiceOver afterwards. The label has to hang on the marker.
test('every pin carries a label for VoiceOver', async () => {
  loadSuccess();
  await wrap();
  const pin = await screen.findByTestId('karte-nadel-p1');
  expect(pin.props.accessibilityLabel).toBe('Moment von Lea um 10:00 öffnen');
});

// The point where this screen tips over technically: `tracksViewChanges`
// controls whether react-native-maps keeps redrawing the pin. Permanently
// `true` means every pin re-renders on every frame and the map stutters as
// soon as more than a handful lie on it. Permanently `false` means the pin
// freezes in the state it had when first drawn, and that is the empty circle,
// because the image only arrives afterwards. Both faults look the same when
// only one of the two moments is checked, which is why both stand here.
test('the pin keeps being redrawn until its image is there, and no longer after that', async () => {
  loadSuccess();
  await wrap();
  const pin = await screen.findByTestId('karte-nadel-p1');
  expect(pin.props.tracksViewChanges).toBe(true);

  await fireEvent(within(pin).getByTestId('nadel-bild'), 'load');
  expect(screen.getByTestId('karte-nadel-p1').props.tracksViewChanges).toBe(false);
});

test('a finished pin switches off only itself', async () => {
  loadSuccess();
  await wrap();
  const pin = await screen.findByTestId('karte-nadel-p1');
  await fireEvent(within(pin).getByTestId('nadel-bild'), 'load');
  expect(screen.getByTestId('karte-nadel-p2').props.tracksViewChanges).toBe(true);
});

// ---------------------------------------------------------------------------
// Clustering, and what a tap on a cluster triggers
// ---------------------------------------------------------------------------

test('moments lying close together share a single pin', async () => {
  loadSuccess(CLOSE_TOGETHER);
  await wrap();
  const pins = await screen.findAllByTestId(/^karte-nadel/);
  expect(pins).toHaveLength(1);
  expect(screen.getByText('2')).toBeTruthy();
});

test('zooming in breaks the cluster into single pins', async () => {
  loadSuccess(CLOSE_TOGETHER);
  await wrap();
  expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(1);

  await fireEvent(screen.getByTestId('karte-flaeche'), 'regionChangeComplete', NARROW);
  expect(screen.getAllByTestId(/^karte-nadel/)).toHaveLength(2);
  expect(screen.queryByText('2')).toBeNull();
});

// The counter pill has to FOLLOW along while zooming. That is not the same as
// the test above: that one reads the React tree, which is right even when the
// pin on the map has long since frozen. On the device the fault would show as
// a cluster still reading "2" although it has become two pins. Here it is
// observable only through the recorded `tracksViewChanges` history.
test('when the cluster falls apart its pin is drawn anew', async () => {
  loadSuccess(CLOSE_TOGETHER);
  await wrap();
  const pin = await screen.findByTestId('karte-nadel-p1');
  await fireEvent(within(pin).getByTestId('nadel-bild'), 'load');
  expect(tracksSince('karte-nadel-p1').at(-1)).toBe(false);

  await fireEvent(screen.getByTestId('karte-flaeche'), 'regionChangeComplete', NARROW);
  const history = tracksSince('karte-nadel-p1');
  expect(history).toContain(true);
  expect(history.at(-1)).toBe(false);
});

// Centre of the cluster, and narrower than the viewport it was tapped from
// (0.01 degrees, the minimum span of `viewportFor`). As a function so BOTH
// branches of the camera move really carry the same assertions: a jump that
// only goes "somewhere" is no fulfilled reduced motion case.
function expectTargetOnTheCluster(target: Viewport) {
  expect(target.latitude).toBeCloseTo(38.71005, 4);
  expect(target.longitude).toBeCloseTo(-9.14005, 4);
  expect(target.latitudeDelta).toBeLessThan(0.01);
  expect(target.longitudeDelta).toBeLessThan(0.01);
}

test('a tap on a cluster travels into it', async () => {
  loadSuccess(CLOSE_TOGETHER);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));

  expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);
  const [target, duration] = mockAnimateToRegion.mock.calls[0];
  expectTargetOnTheCluster(target);
  expect(duration).toBe(motion.duration.base);
});

test('a tap on a cluster answers with selection haptics', async () => {
  loadSuccess(CLOSE_TOGETHER);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(mockHaptics).toHaveBeenCalledTimes(1);
});

test('a tap on a single pin does not knock', async () => {
  loadSuccess();
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(mockHaptics).not.toHaveBeenCalled();
});

// `viewportFor` has a minimum span of about 1.1 km, meant for the first
// opening so a single moment is not zoomed in to the maximum. Taken as the
// target unbounded, a tap on a cluster from an already close viewport led
// outwards: the map zoomed OUT although the tap is supposed to lead in.
test('a tap on a cluster never zooms out', async () => {
  loadSuccess(CLOSE_TOGETHER);
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  await fireEvent(screen.getByTestId('karte-flaeche'), 'regionChangeComplete', MEDIUM);

  await fireEvent.press(screen.getByTestId('karte-nadel-p1'));
  const [target] = mockAnimateToRegion.mock.calls[0];
  expect(target.latitudeDelta).toBeLessThan(MEDIUM.latitudeDelta);
  expect(target.longitudeDelta).toBeLessThan(MEDIUM.longitudeDelta);
});

test('a tap on a single pin does not move the map', async () => {
  loadSuccess();
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(mockAnimateToRegion).not.toHaveBeenCalled();
  expect(mockSetRegion).not.toHaveBeenCalled();
});

test('with Reduced Motion the map jumps instead of travelling', async () => {
  mockReducedMotion = true;
  loadSuccess(CLOSE_TOGETHER);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(mockAnimateToRegion).not.toHaveBeenCalled();
  expect(mockSetRegion).toHaveBeenCalledTimes(1);
});

test('the jump hits the same target as the travel', async () => {
  mockReducedMotion = true;
  loadSuccess(CLOSE_TOGETHER);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  const [target] = mockSetRegion.mock.calls[0];
  expectTargetOnTheCluster(target);
});

test('with Reduced Motion it never zooms out either', async () => {
  mockReducedMotion = true;
  loadSuccess(CLOSE_TOGETHER);
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  await fireEvent(screen.getByTestId('karte-flaeche'), 'regionChangeComplete', MEDIUM);

  await fireEvent.press(screen.getByTestId('karte-nadel-p1'));
  const [target] = mockSetRegion.mock.calls[0];
  expect(target.latitudeDelta).toBeLessThan(MEDIUM.latitudeDelta);
  expect(target.longitudeDelta).toBeLessThan(MEDIUM.longitudeDelta);
});

test('the line connects the moments in capture order', async () => {
  loadSuccess();
  await wrap();
  const line = await screen.findByTestId('karte-linie');
  expect(line.props.coordinates).toEqual([
    { latitude: 38.71, longitude: -9.14 },
    { latitude: 38.72, longitude: -9.13 },
  ]);
});

test('the line is the accent colour at width 3', async () => {
  loadSuccess();
  await wrap();
  const line = await screen.findByTestId('karte-linie');
  expect(line.props.strokeColor).toBe(palette.accent);
  expect(line.props.strokeWidth).toBe(3);
});

test('a single moment yields no line', async () => {
  loadSuccess([m1, m3]);
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  expect(screen.queryByTestId('karte-linie')).toBeNull();
});

test('toMapPoints receives the player playlist, not the raw moment list', async () => {
  loadSuccess();
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  expect(toMapPoints).toHaveBeenCalledWith([m1, m2, m3]);
});

test('the viewport spans only the visible pins', async () => {
  loadSuccess();
  await wrap();
  const region = (await screen.findByTestId('karte-flaeche')).props.initialRegion;
  expect(region.latitude).toBeCloseTo(38.715, 3);
  expect(region.longitude).toBeCloseTo(-9.135, 3);
  expect(region.latitudeDelta).toBeLessThan(1);
  expect(region.longitudeDelta).toBeLessThan(1);
});

// Waiting on the heading of the empty state and no longer on the back pill:
// that one does not exist here any more. It is a translucent pill for the map
// surface, without a map it lies on nothing, and the one button of the empty
// state leads the same way anyway.
test('when not a single moment has a place there is no map at all', async () => {
  loadSuccess([m3]);
  await wrap();
  await screen.findByText('Diese Reise hat keine Orte');
  expect(screen.queryByTestId('karte-flaeche')).toBeNull();
  expect(screen.queryByTestId(/^karte-nadel/)).toBeNull();
});

test('when the load path throws the screen stays operable instead of hanging', async () => {
  (fetchRecapMoments as jest.Mock).mockRejectedValue(new Error('kaputt'));
  (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  await wrap();
  await fireEvent.press(await screen.findByLabelText('Zurück'));
  expect(mockBack).toHaveBeenCalled();
  expect(screen.queryByTestId('karte-flaeche')).toBeNull();
});

test('the back arrow leaves the screen via back() when a way back exists', async () => {
  loadSuccess();
  await wrap();
  await fireEvent.press(await screen.findByLabelText('Zurück'));
  expect(mockBack).toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

test('without a way back on the stack the back arrow leads to the overview of this trip', async () => {
  mockCanGoBack = false;
  loadSuccess();
  await wrap();
  await fireEvent.press(await screen.findByLabelText('Zurück'));
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/recap/[id]/overview', params: { id: 't1' } });
  expect(mockBack).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// The moment sheet and the jump into the player
// ---------------------------------------------------------------------------

// A moment with everything the sheet shows. 13:32 UTC is 14:32 in
// Europe/Lisbon, so the time has to come from `captured_tz` and not from the
// timezone of the test machine (which would give 15:32 in Zurich, 13:32 in
// UTC). Same formatting as player and pin: features/recap/timeOfDay.
const withEverything = moment({
  id: 'p1',
  authorName: 'Mira',
  captured_at: '2026-08-10T13:32:00.000Z',
  place_name: 'Miradouro da Senhora do Monte',
  caption: 'Angekommen, 28 Grad im Mai',
});

// A moment WITHOUT a place, chronologically BEFORE the two with one, and that
// is the whole purpose of this line. Without it the playlist (which `start`
// points into) and the points (the pins) would count alike by accident, and
// no test could see which of the two lists the index was built from. With it
// they are shifted by exactly one: p1 is at playlist position 1 and at point
// position 0, p2 at 2 respectively 1.
//
// p5 (uploaded, no url) and p4 (pending) stay in the list so the index is set
// apart from the RAW moment list too, where p2 would be at position 3.
const withoutPlaceEarly = moment({ id: 'p3', captured_at: '2026-08-10T08:00:00.000Z', lat: null, lng: null });
const WITH_SHEET_DATA = [withoutUrlM, withoutPlaceEarly, withEverything, m2, pendingM];

// Two moments on EXACTLY the same coordinate. No zoom level separates them:
// their distance on screen is their extent divided by the visible span, and
// zero stays zero. Without a way out one taps into nothing here.
const m2SameSpot = moment({ id: 'p2', captured_at: '2026-08-10T18:00:00.000Z', lat: 38.71, lng: -9.14 });
const ON_ONE_SPOT = [withoutUrlM, withoutPlaceEarly, withEverything, m2SameSpot, pendingM];

test('a tap on a single pin shows the moment', async () => {
  loadSuccess(WITH_SHEET_DATA);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));

  expect(screen.getByText('Angekommen, 28 Grad im Mai')).toBeTruthy();
  expect(screen.getByText('Miradouro da Senhora do Monte')).toBeTruthy();
  // At the same time the proof for the time: 14:32 exists only in `captured_tz`.
  expect(screen.getByText('Mira · 14:32')).toBeTruthy();
});

test('the sheet shows the medium image, not the pin thumbnail', async () => {
  loadSuccess(WITH_SHEET_DATA);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(screen.getByTestId('sheet-bild').props.source.uri).toBe(image('p1').medium_url);
});

// `start` is an INDEX into the sorted PLAYLIST of the player (uploaded
// intersected with pool url), not into the pins and not into the raw moment
// list. Pointing at the wrong value starts the player at the wrong moment,
// and nobody notices unless they count.
//
// p2 is at playlist position 2, at point position 1, at raw list position 3.
// The 2 is therefore the only number that can fall out of the right count.
test('the watch in recap button starts the player at exactly this moment', async () => {
  loadSuccess(WITH_SHEET_DATA);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p2'));
  await fireEvent.press(screen.getByText('Im Recap ansehen'));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player',
    params: { id: 't1', start: '2' },
  });
});

test('the sheet closes without leaving the screen', async () => {
  loadSuccess(WITH_SHEET_DATA);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  await fireEvent.press(screen.getByLabelText('Schliessen'));

  expect(screen.queryByText('Im Recap ansehen')).toBeNull();
  expect(mockPush).not.toHaveBeenCalled();
  expect(screen.getByTestId('karte-nadel-p1')).toBeTruthy();
});

test('a cluster that cannot be zoomed apart opens a sheet after all', async () => {
  loadSuccess(ON_ONE_SPOT);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));

  expect(screen.getByText('2 Momente an diesem Ort')).toBeTruthy();
  expect(screen.getAllByTestId(/^gruppe-eintrag/)).toHaveLength(2);
});

test('a cluster on one spot does not travel into nothing before the sheet arrives', async () => {
  loadSuccess(ON_ONE_SPOT);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));

  expect(mockAnimateToRegion).not.toHaveBeenCalled();
  expect(mockSetRegion).not.toHaveBeenCalled();
  expect(mockHaptics).not.toHaveBeenCalled();
});

// The index inside the cluster would be 1 here, the one in the points 1 as
// well, only the playlist yields 2.
test('every row of the cluster leads to its own place in the playlist', async () => {
  loadSuccess(ON_ONE_SPOT);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  await fireEvent.press(screen.getByTestId('gruppe-eintrag-p2'));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player',
    params: { id: 't1', start: '2' },
  });
});

test('a change of trip leaves no sheet of the previous one standing', async () => {
  loadSuccess(WITH_SHEET_DATA);
  const { rerender } = await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(screen.getByText('Im Recap ansehen')).toBeTruthy();

  mockId = 't2';
  loadSuccess([m1]);
  await rerender(<ThemeProvider><RecapMap /></ThemeProvider>);

  expect(screen.queryByText('Im Recap ansehen')).toBeNull();
  expect(screen.queryByText('Angekommen, 28 Grad im Mai')).toBeNull();
});

test('the pin of a cluster on one spot announces the sheet', async () => {
  loadSuccess(ON_ONE_SPOT);
  await wrap();
  expect(await screen.findByLabelText('2 Momente an diesem Ort ansehen')).toBeTruthy();
});

test('the pin of a zoomable cluster announces the zoom', async () => {
  loadSuccess(CLOSE_TOGETHER);
  await wrap();
  expect(await screen.findByLabelText('Auf 2 Momente heranzoomen')).toBeTruthy();
});

test('a cluster that can be zoomed apart opens NO sheet', async () => {
  loadSuccess(CLOSE_TOGETHER);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));

  expect(screen.queryByText(/an diesem Ort/)).toBeNull();
  expect(screen.queryByText('Im Recap ansehen')).toBeNull();
});

// ---------------------------------------------------------------------------
// The map has a last zoom level
// ---------------------------------------------------------------------------
//
// Identical coordinates only cover the rare case. The common one: two
// captures at the same place lie three to eight metres apart through GPS
// drift, and at zoom level 19 that is less than the 40 screen points from
// which two pins are drawn separately. The cluster fell apart at no zoom
// level and the tap ran into nothing however often it was repeated. The
// answer knows no number, it observes: has the viewport moved?
//
// In the test run the mocked map never reports a new viewport by itself, so
// it stands exactly as still as it would at the last zoom level.
test('when a cluster tap does not move the camera the next one opens the sheet', async () => {
  loadSuccess(CLOSE_TOGETHER);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(screen.queryByText(/an diesem Ort/)).toBeNull();

  await fireEvent.press(screen.getByTestId('karte-nadel-p1'));
  expect(screen.getByText('2 Momente an diesem Ort')).toBeTruthy();
  expect(screen.getAllByTestId(/^gruppe-eintrag/)).toHaveLength(2);
});

test('when the viewport has moved the second tap keeps zooming', async () => {
  loadSuccess(CLOSE_TOGETHER);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  await fireEvent(screen.getByTestId('karte-flaeche'), 'regionChangeComplete', MEDIUM);

  await fireEvent.press(screen.getByTestId('karte-nadel-p1'));
  expect(screen.queryByText(/an diesem Ort/)).toBeNull();
  expect(mockAnimateToRegion).toHaveBeenCalledTimes(2);
});

// The second `regionChangeComplete` is the map reporting its finished travel
// without having moved, which is exactly what it does at the last zoom level.
// Only that makes the screen re-render and the label be rebuilt.
test('at a stuck cluster the pin announces the sheet, not the zoom', async () => {
  loadSuccess(CLOSE_TOGETHER);
  await wrap();
  await fireEvent(screen.getByTestId('karte-flaeche'), 'regionChangeComplete', MEDIUM);
  expect(await screen.findByLabelText('Auf 2 Momente heranzoomen')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('karte-nadel-p1'));
  await fireEvent(screen.getByTestId('karte-flaeche'), 'regionChangeComplete', { ...MEDIUM });

  expect(screen.getByLabelText('2 Momente an diesem Ort ansehen')).toBeTruthy();
  expect(screen.queryByLabelText('Auf 2 Momente heranzoomen')).toBeNull();
});

test('a stuck attempt does not block a DIFFERENT cluster', async () => {
  // Two clusters: p1/p2 close together in Lisbon, p6/p7 close together about a
  // kilometre further on.
  const m6 = moment({ id: 'p6', captured_at: '2026-08-10T19:00:00.000Z', lat: 38.7201, lng: -9.1301 });
  const m7 = moment({ id: 'p7', captured_at: '2026-08-10T19:30:00.000Z', lat: 38.72012, lng: -9.1301 });
  loadSuccess([m1, m2Near, m6, m7], {
    ...POOL_OK,
    urls: new Map([['p1', image('p1')], ['p2', image('p2')], ['p6', image('p6')], ['p7', image('p7')]]),
    ausgelassen: 0,
  });
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  // The map stands still (no regionChangeComplete), the attempt on p1 is stuck.
  await fireEvent.press(screen.getByTestId('karte-nadel-p6'));

  expect(screen.queryByText(/an diesem Ort/)).toBeNull();
  expect(mockAnimateToRegion).toHaveBeenCalledTimes(2);
});

// ---------------------------------------------------------------------------
// The tap right after a camera move
// ---------------------------------------------------------------------------
//
// The screen remembers the cluster state for the next tap in a ref. It is
// written in a LAYOUT effect, not a passive one: a passive one runs only
// after the commit, and in the window in between a tap still reads the old
// state. That is exactly what happens after a camera move: the cluster has
// fallen apart, the new pin is already there, and whoever taps it right away
// is not found in the old state, so the sheet would stay away without any
// error arising anywhere.
//
// `fireEvent` brings its own `act()` along and that plays ALL effects at the
// end, so the window does not exist there. It does exist in the order of the
// layout effects: React plays them in tree order, siblings left to right, and
// ALL of them before the first passive effect. A neighbour standing AFTER the
// screen and tapping inside a layout effect therefore hits exactly the moment
// in which the screen has committed and its passive effect is still pending.
//
// Both are triggered by the same event: a change of the window size. It
// reaches both through `useWindowDimensions`, is batched into one render, and
// lets the cluster fall apart because a larger window puts more screen points
// on the same degree.
const LARGE_WINDOW = { width: 3000, height: 5000, scale: 2, fontScale: 1 };
const ORIGINAL_WINDOW = Dimensions.get('window');
const ORIGINAL_SCREEN = Dimensions.get('screen');

function PinTapper({ pin }: { pin: string }) {
  const { width } = useWindowDimensions();
  useLayoutEffect(() => {
    if (width !== LARGE_WINDOW.width) return;
    mockPresses.get(pin)?.();
  }, [width, pin]);
  return null;
}

test('a tap right after a cluster falls apart is not swallowed', async () => {
  loadSuccess(CLOSE_TOGETHER);
  await render(
    <ThemeProvider>
      <RecapMap />
      <PinTapper pin="karte-nadel-p2" />
    </ThemeProvider>
  );
  await screen.findByTestId('karte-nadel-p1');
  expect(screen.queryByTestId('karte-nadel-p2')).toBeNull();

  await act(async () => {
    Dimensions.set({ window: LARGE_WINDOW, screen: LARGE_WINDOW });
  });

  expect(screen.getByTestId('karte-nadel-p2')).toBeTruthy();
  expect(screen.getByText('Lea · 19:00')).toBeTruthy();
});

// ---------------------------------------------------------------------------
// The dead end inside the way out
// ---------------------------------------------------------------------------

// Twelve moments on EXACTLY the same coordinate. Not a contrived edge case:
// the place lookup asks for the position without options
// (features/moments/placeAndTime.ts), and two captures shortly after one
// another regularly get the same fix back bit for bit, which is why this
// sheet exists at all.
//
// The list is 87 + 72 per row points high, without a scroll area `Sheet`
// (85 % window height, `overflow: 'hidden'`) clips from the seventh row on.
// The clipped moments would be reachable on NO path, because zooming does not
// help on one spot by definition.
const MANY_ON_ONE_SPOT = [
  withoutUrlM,
  withoutPlaceEarly,
  ...Array.from({ length: 12 }, (_, i) =>
    moment({
      id: `f${i}`,
      captured_at: `2026-08-10T${String(9 + i).padStart(2, '0')}:00:00.000Z`,
      lat: 38.71,
      lng: -9.14,
    })
  ),
];
const POOL_MANY = {
  ...POOL_OK,
  urls: new Map<string, MediaUrl>([
    ...POOL_OK.urls,
    ...Array.from({ length: 12 }, (_, i) => [`f${i}`, image(`f${i}`)] as const),
  ]),
};

test('the cluster list scrolls instead of clipping its last moments', async () => {
  loadSuccess(MANY_ON_ONE_SPOT, POOL_MANY);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-f0'));

  const list = screen.getByTestId('gruppe-liste');
  expect(list.type).toBe('RCTScrollView');
  expect(StyleSheet.flatten(list.props.style).maxHeight).toBe(
    Dimensions.get('window').height * SHEET_SCROLL_RATIO
  );
  expect(within(list).getAllByTestId(/^gruppe-eintrag/)).toHaveLength(12);
});

// f11 is at playlist position 12 (p3 without a place in front of it, p5
// without a url drops out).
test('even the last row of a long list leads into the player', async () => {
  loadSuccess(MANY_ON_ONE_SPOT, POOL_MANY);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-f0'));
  await fireEvent.press(within(screen.getByTestId('gruppe-liste')).getByTestId('gruppe-eintrag-f11'));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player',
    params: { id: 't1', start: '12' },
  });
});

// The same mechanism hits the single sheet: image (3:2), place and caption
// together grow taller than the sheet at a large system font. The primary
// button therefore has to sit OUTSIDE the scrolling part, scrolling along it
// would be the first thing gone.
test('in the moment sheet the content scrolls while the button stays put', async () => {
  loadSuccess(WITH_SHEET_DATA);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));

  const content = screen.getByTestId('moment-inhalt');
  expect(content.type).toBe('RCTScrollView');
  expect(within(content).getByTestId('sheet-bild')).toBeTruthy();
  expect(within(content).getByText('Angekommen, 28 Grad im Mai')).toBeTruthy();
  expect(within(content).queryByLabelText('Im Recap ansehen')).toBeNull();
  expect(screen.getByLabelText('Im Recap ansehen')).toBeTruthy();
});

test('after t1 to t2 to t1 no sheet opens by itself', async () => {
  loadSuccess(WITH_SHEET_DATA);
  const { rerender } = await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(screen.getByText('Im Recap ansehen')).toBeTruthy();

  mockId = 't2';
  loadSuccess([m1]);
  await rerender(<ThemeProvider><RecapMap /></ThemeProvider>);
  expect(screen.queryByText('Im Recap ansehen')).toBeNull();

  mockId = 't1';
  loadSuccess(WITH_SHEET_DATA);
  await rerender(<ThemeProvider><RecapMap /></ThemeProvider>);
  expect(screen.queryByText('Im Recap ansehen')).toBeNull();
  expect(screen.queryByText('Angekommen, 28 Grad im Mai')).toBeNull();
});

// Readable only from the delays the rows start with: `Animated` flattens the
// opacity to a number in the test run and never touches it again under
// `useNativeDriver` (same limitation as in MapPin.test.tsx).
// Only the row fade ins: `Sheet` animates along but sets no `delay`, which is
// what separates the list rows from everything else.
function rowAnimations(): { delay?: number; duration?: number }[] {
  return (Animated.timing as unknown as jest.Mock).mock.calls
    .map(([, config]) => config as { delay?: number; duration?: number })
    .filter((config) => config.delay !== undefined);
}

function staggerDelays(): unknown[] {
  return rowAnimations().map((config) => config.delay);
}

// Deliberately the bare number instead of the (module private) constant from
// map.tsx: checked against itself every value would be right, 200 is what the
// design language says, and only that is the assurance.
function staggerDurations(): unknown[] {
  return rowAnimations().map((config) => config.duration);
}

test('the rows of the cluster list appear staggered', async () => {
  const spy = jest.spyOn(Animated, 'timing');
  loadSuccess(ON_ONE_SPOT);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));

  expect(staggerDelays()).toEqual([0, 40]);
  expect(staggerDurations()).toEqual([motion.duration.base, motion.duration.base]);
  spy.mockRestore();
});

test('with Reduced Motion the rows appear without stagger, in 200 ms', async () => {
  const spy = jest.spyOn(Animated, 'timing');
  mockReducedMotion = true;
  loadSuccess(ON_ONE_SPOT);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));

  expect(staggerDelays()).toEqual([0, 0]);
  expect(staggerDurations()).toEqual([200, 200]);
  spy.mockRestore();
});

const POOL_WITHOUT_MEDIUM = {
  ...POOL_OK,
  urls: new Map<string, MediaUrl>([
    ...POOL_OK.urls,
    ['p1', { post_id: 'p1', thumb_url: image('p1').thumb_url } as unknown as MediaUrl],
  ]),
};

test('with the medium image missing the sheet shows the thumbnail', async () => {
  loadSuccess(WITH_SHEET_DATA, POOL_WITHOUT_MEDIUM);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(screen.getByTestId('sheet-bild').props.source.uri).toBe(image('p1').thumb_url);
});

test('without any image source the sheet shows no image node', async () => {
  loadSuccess(WITH_SHEET_DATA, POOL_WITHOUT_ANY_IMAGE);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(screen.queryByTestId('sheet-bild')).toBeNull();
  expect(screen.getByText('Mira · 14:32')).toBeTruthy();
});

// ---------------------------------------------------------------------------
// The day filter
// ---------------------------------------------------------------------------

// A moment on the SECOND trip day, far enough away that it forms no cluster
// with p1/p2.
const day2M = moment({ id: 'p6', captured_at: '2026-08-11T10:00:00.000Z', lat: 38.75, lng: -9.1 });

// Playlist (uploaded intersected with pool url), chronologically: p3 (no
// place, position 0), p1 (position 1), p2 (position 2), p6 (position 3). p5
// drops out without a url, p4 is still uploading. Three pins lie on the map:
// p1 and p2 on day 1, p6 on day 2.
//
// Like COMPLETE already sorted chronologically, the way `fetchRecapMoments`
// delivers them. p4 (10.08., 20:00) therefore stands BEFORE p6 (11.08.) even
// though it drops out anyway: a fixture claiming something false about the
// API is a test that one day stays green for the wrong reason.
const WITH_DAYS = [withoutUrlM, withoutPlaceEarly, withEverything, m2, pendingM, day2M];
const POOL_DAYS = {
  ...POOL_OK,
  urls: new Map<string, MediaUrl>([...POOL_OK.urls, ['p6', image('p6')]]),
};

async function openDayFilter() {
  await fireEvent.press(screen.getByTestId('karte-tagesfilter'));
}

test('the filter shows all days to begin with', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  expect(await screen.findByText('Alle Tage')).toBeTruthy();
});

test('a chosen day thins out the pins', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(3);

  await openDayFilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));

  expect(screen.getAllByTestId(/^karte-nadel/)).toHaveLength(1);
  expect(screen.getByTestId('karte-nadel-p6')).toBeTruthy();
  expect(screen.getByText('Tag 2')).toBeTruthy();
});

// `point.index` counts into the UNFILTERED playlist and travels to the player
// as `start`, so the day filter must not touch it. Whoever filters the
// moments first and calls `toMapPoints` on the rest gets an index INSIDE the
// day: p6 would be at 0 there, at 0 among the filtered pins as well, at 2
// among all pins and at 4 in the raw moment list. Only the 3 can fall out of
// the right count, and the pin sits right in EVERY one of these cases, so the
// fault would only show by counting in the player.
test('a chosen day does not change the index into the playlist', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await openDayFilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));
  await fireEvent.press(screen.getByTestId('karte-nadel-p6'));
  await fireEvent.press(screen.getByText('Im Recap ansehen'));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player',
    params: { id: 't1', start: '3' },
  });
});

test('filtering happens after toMapPoints, not before', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await openDayFilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));

  expect(toMapPoints).toHaveBeenCalledTimes(1);
  expect(toMapPoints).toHaveBeenCalledWith([withoutPlaceEarly, withEverything, m2, day2M]);
});

test('a chosen day shortens the line as well', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  expect((await screen.findByTestId('karte-linie')).props.coordinates).toHaveLength(3);

  await openDayFilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-1'));

  expect(screen.getByTestId('karte-linie').props.coordinates).toEqual([
    { latitude: 38.71, longitude: -9.14 },
    { latitude: 38.72, longitude: -9.13 },
  ]);
});

test('a chosen day moves the viewport onto its moments', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await openDayFilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));

  expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);
  const [target, duration] = mockAnimateToRegion.mock.calls[0];
  expect(target.latitude).toBeCloseTo(38.75, 4);
  expect(target.longitude).toBeCloseTo(-9.1, 4);
  expect(duration).toBe(motion.duration.base);
});

test('with Reduced Motion the viewport jumps to the chosen day', async () => {
  mockReducedMotion = true;
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await openDayFilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));

  expect(mockAnimateToRegion).not.toHaveBeenCalled();
  expect(mockSetRegion).toHaveBeenCalledTimes(1);
  const [target] = mockSetRegion.mock.calls[0];
  expect(target.latitude).toBeCloseTo(38.75, 4);
  expect(target.longitude).toBeCloseTo(-9.1, 4);
});

test('choosing a day answers with selection haptics', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await openDayFilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));

  expect(mockHaptics).toHaveBeenCalledTimes(1);
});

test('the all days entry brings the whole trip back', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await openDayFilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));
  await openDayFilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-alle'));

  expect(screen.getAllByTestId(/^karte-nadel/)).toHaveLength(3);
  expect(screen.getByText('Alle Tage')).toBeTruthy();
  expect(mockAnimateToRegion).toHaveBeenCalledTimes(2);
  const [target] = mockAnimateToRegion.mock.calls[1];
  expect(target.latitude).toBeCloseTo(38.73, 4);
  expect(target.longitude).toBeCloseTo(-9.12, 4);
});

test('the day numbers count from the start date of the trip', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS, { start_date: '2026-08-08' });
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await openDayFilter();
  expect(screen.getByTestId('tag-eintrag-3')).toBeTruthy();
  expect(screen.getByTestId('tag-eintrag-4')).toBeTruthy();
  expect(screen.queryByTestId('tag-eintrag-1')).toBeNull();
});

// Eastward across the date line: `groupByDays` carries the highest day number
// handed out so far forward monotonically. A left out moment can therefore
// shift the numbers BEHIND it: feeding in only the moments WITH a place would
// give east1 the number 2 instead of 3, and the map would show different days
// than the overview.
//
// east0 (Lisbon, 10.08.) is day 1. eastWithoutPlace lies locally on 12.08.
// (Asia/Tokyo) and pulls the running number to 3 although it gets no pin.
// east1 is later chronologically but locally only 11.08.
// (America/Los_Angeles), which lands it in day 3, not in day 2.
const east0 = moment({ id: 'o0', captured_at: '2026-08-10T09:00:00.000Z', lat: 38.71, lng: -9.14 });
const eastWithoutPlace = moment({
  id: 'o1', captured_at: '2026-08-11T23:30:00.000Z', captured_tz: 'Asia/Tokyo', lat: null, lng: null,
});
const east1 = moment({
  id: 'o2', captured_at: '2026-08-12T01:00:00.000Z', captured_tz: 'America/Los_Angeles',
  lat: 38.75, lng: -9.1,
});
const EASTWARD = [east0, eastWithoutPlace, east1];
const POOL_EASTWARD = {
  ...POOL_OK,
  urls: new Map<string, MediaUrl>([['o0', image('o0')], ['o1', image('o1')], ['o2', image('o2')]]),
};

test('the day numbers count over the whole playlist, not only over the moments with a place', async () => {
  loadSuccess(EASTWARD, POOL_EASTWARD);
  await wrap();
  await screen.findByTestId('karte-nadel-o2');

  await openDayFilter();
  expect(screen.getByTestId('tag-eintrag-3')).toBeTruthy();
  expect(screen.queryByTestId('tag-eintrag-2')).toBeNull();
});

const WITHOUT_PLACE_IN_BETWEEN = [
  moment({ id: 'q1', captured_at: '2026-08-10T09:00:00.000Z', lat: 38.71, lng: -9.14 }),
  moment({ id: 'q2', captured_at: '2026-08-11T09:00:00.000Z', lat: null, lng: null }),
  moment({ id: 'q3', captured_at: '2026-08-12T09:00:00.000Z', lat: 38.75, lng: -9.1 }),
];
const POOL_WITHOUT_PLACE_IN_BETWEEN = {
  ...POOL_OK,
  urls: new Map<string, MediaUrl>([['q1', image('q1')], ['q2', image('q2')], ['q3', image('q3')]]),
};

test('a day without moments on the map is not offered for choice', async () => {
  loadSuccess(WITHOUT_PLACE_IN_BETWEEN, POOL_WITHOUT_PLACE_IN_BETWEEN);
  await wrap();
  await screen.findByTestId('karte-nadel-q3');

  await openDayFilter();
  expect(screen.getByTestId('tag-eintrag-1')).toBeTruthy();
  expect(screen.getByTestId('tag-eintrag-3')).toBeTruthy();
  expect(screen.queryByTestId('tag-eintrag-2')).toBeNull();
});

// COMPLETE has pins on day 1 only (p3 on the second day has no place).
test('a trip with pins on a single day shows no day filter', async () => {
  loadSuccess();
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  expect(screen.queryByTestId('karte-tagesfilter')).toBeNull();
});

test('without trip data the map stays, only without the day filter', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  (fetchTrip as jest.Mock).mockResolvedValue({ data: null, error: 'Diese Reise konnte nicht geladen werden.' });
  await wrap();

  expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(3);
  expect(screen.queryByTestId('karte-tagesfilter')).toBeNull();
});

// On the device the backdrop of the open sheet catches the tap anyway, what
// stands here is that the state afterwards is unambiguous.
test('the day filter closes an open moment sheet', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(screen.getByText('Im Recap ansehen')).toBeTruthy();

  await openDayFilter();
  expect(screen.queryByText('Im Recap ansehen')).toBeNull();
  expect(screen.getByTestId('tag-eintrag-alle')).toBeTruthy();
});

test('a change of trip resets the day filter', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  const { rerender } = await wrap();
  await openDayFilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));
  expect(screen.getAllByTestId(/^karte-nadel/)).toHaveLength(1);

  mockId = 't2';
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await rerender(<ThemeProvider><RecapMap /></ThemeProvider>);

  expect(screen.getByText('Alle Tage')).toBeTruthy();
  expect(screen.getAllByTestId(/^karte-nadel/)).toHaveLength(3);
});

// A long trip has many days, the same dead end as with the cluster list:
// `Sheet` caps at 85 % window height and clips the overhang hard
// (`overflow: 'hidden'`).
const MANY_DAYS = Array.from({ length: 12 }, (_, i) =>
  moment({
    id: `v${i}`,
    captured_at: `2026-08-${String(10 + i).padStart(2, '0')}T09:00:00.000Z`,
    lat: 38.71 + i * 0.01,
    lng: -9.14 + i * 0.01,
  })
);
const POOL_MANY_DAYS = {
  ...POOL_OK,
  urls: new Map<string, MediaUrl>(
    Array.from({ length: 12 }, (_, i) => [`v${i}`, image(`v${i}`)] as const)
  ),
};

test('the day list scrolls instead of clipping its last days', async () => {
  loadSuccess(MANY_DAYS, POOL_MANY_DAYS);
  await wrap();
  await screen.findByTestId('karte-nadel-v0');

  await openDayFilter();
  const list = screen.getByTestId('tage-liste');
  expect(list.type).toBe('RCTScrollView');
  expect(StyleSheet.flatten(list.props.style).maxHeight).toBe(
    Dimensions.get('window').height * SHEET_SCROLL_RATIO
  );
  // Twelve days plus the all days entry.
  expect(within(list).getAllByTestId(/^tag-eintrag/)).toHaveLength(13);
  expect(within(list).getByTestId('tag-eintrag-12')).toBeTruthy();
});

test('the rows of the day list appear staggered', async () => {
  const spy = jest.spyOn(Animated, 'timing');
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await openDayFilter();
  // The all days entry, day 1, day 2.
  expect(staggerDelays()).toEqual([0, 40, 80]);
  expect(staggerDurations()).toEqual([
    motion.duration.base, motion.duration.base, motion.duration.base,
  ]);
  spy.mockRestore();
});

test('with Reduced Motion the rows of the day list appear without stagger, in 200 ms', async () => {
  const spy = jest.spyOn(Animated, 'timing');
  mockReducedMotion = true;
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await openDayFilter();
  expect(staggerDelays()).toEqual([0, 0, 0]);
  expect(staggerDurations()).toEqual([200, 200, 200]);
  spy.mockRestore();
});

// Were all three queries in one `Promise.all`, the map would hang on one that
// contributes nothing to its content: until the viewport stands the `MapView`
// is not even mounted. And `fetchTrip` is not one query but two, it waits
// internally on the rpc `my_post_counts` as well (tripsApi.ts).
test('the pins are up before the trip query is back', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  let resolveTrip: (value: { data: Trip | null; error: string | null }) => void = () => {};
  (fetchTrip as jest.Mock).mockReturnValue(
    new Promise<{ data: Trip | null; error: string | null }>((resolve) => {
      resolveTrip = resolve;
    })
  );
  await wrap();

  expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(3);
  expect(screen.getByTestId('karte-linie')).toBeTruthy();
  expect(screen.queryByTestId('karte-tagesfilter')).toBeNull();

  await act(async () => {
    resolveTrip({ data: TRIP, error: null });
  });
  expect(screen.getByTestId('karte-tagesfilter')).toBeTruthy();
  expect(screen.getByText('Alle Tage')).toBeTruthy();
});

test('a change of trip leaves no open day sheet of the previous one standing', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  const { rerender } = await wrap();
  await openDayFilter();
  expect(screen.getByTestId('tag-eintrag-2')).toBeTruthy();

  mockId = 't2';
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await rerender(<ThemeProvider><RecapMap /></ThemeProvider>);

  expect(screen.queryByTestId('tag-eintrag-2')).toBeNull();
  expect(screen.getAllByTestId(/^karte-nadel/)).toHaveLength(3);
  expect(mockAnimateToRegion).not.toHaveBeenCalled();
});

// The load paths come back independently, and when the trip changes there is
// a window in which the start date already belongs to the NEW trip and the
// moments still to the old one. The day numbers out of that would exist in
// neither of the two.
test('a half finished trip change shows neither pins nor day numbers of the previous trip', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  const { rerender } = await wrap();
  await screen.findByTestId('karte-tagesfilter');

  mockId = 't2';
  // The trip answers at once and with a DIFFERENT start date, the moments of t2
  // stay away for now.
  let resolveMoments: (value: { data: RecapMoment[]; error: string | null }) => void = () => {};
  (fetchTrip as jest.Mock).mockResolvedValue({
    data: { ...TRIP, id: 't2', start_date: '2026-08-08' }, error: null,
  });
  (fetchRecapMoments as jest.Mock).mockReturnValue(
    new Promise<{ data: RecapMoment[]; error: string | null }>((resolve) => {
      resolveMoments = resolve;
    })
  );
  (getPool as jest.Mock).mockResolvedValue({ pool: POOL_DAYS, error: null, reason: null });
  await rerender(<ThemeProvider><RecapMap /></ThemeProvider>);

  expect(screen.queryAllByTestId(/^karte-nadel/)).toHaveLength(0);
  expect(screen.queryByTestId('karte-tagesfilter')).toBeNull();
  expect(screen.getByTestId('karte-skelett')).toBeTruthy();

  // And as soon as t2's moments are there the days count from ITS start date
  // (08.08.): the same moments yield day 3 and day 4, not day 1 and 2.
  await act(async () => {
    resolveMoments({ data: WITH_DAYS, error: null });
  });
  await fireEvent.press(screen.getByTestId('karte-tagesfilter'));
  expect(screen.getByTestId('tag-eintrag-3')).toBeTruthy();
  expect(screen.getByTestId('tag-eintrag-4')).toBeTruthy();
  expect(screen.queryByTestId('tag-eintrag-1')).toBeNull();
});

test('the day filter says via VoiceOver which day is currently in force', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  expect(await screen.findByLabelText('Reisetag wählen, aktuell Alle Tage')).toBeTruthy();

  await openDayFilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));
  expect(screen.getByLabelText('Reisetag wählen, aktuell Tag 2')).toBeTruthy();
});

// ---------------------------------------------------------------------------
// The moments without a place
// ---------------------------------------------------------------------------

function withoutPlaceMoment(id: string, hour: number) {
  return moment({
    id,
    captured_at: `2026-08-10T${String(hour).padStart(2, '0')}:00:00.000Z`,
    lat: null,
    lng: null,
  });
}

// A trip in which NO two counts coincide. k5 stands
//
//   - at playlist position 5, the only right number
//   - at position 2 among the moments without a place
//   - at position 7 in the raw moment list
//   - nowhere among the pins
//
// So only the 5 can fall out of the right count, every other number gives
// away at once which list was counted.
const k0 = withoutPlaceMoment('k0', 9);
const k1 = moment({ id: 'k1', captured_at: '2026-08-10T10:00:00.000Z', lat: 38.71, lng: -9.14 });
const k2 = withoutPlaceMoment('k2', 11);
const k3 = moment({ id: 'k3', captured_at: '2026-08-10T12:00:00.000Z', lat: 38.72, lng: -9.13 });
const k4 = moment({ id: 'k4', captured_at: '2026-08-10T13:00:00.000Z', lat: 38.75, lng: -9.1 });
const k5 = withoutPlaceMoment('k5', 14);
// Up front so the raw list is shifted by two: withoutUrlM (07:00, uploaded
// but without a url in the pool) and k9 (08:00, still uploading, WITH a url,
// so that only `upload_status` sorts it out).
const k9 = moment({
  id: 'k9', captured_at: '2026-08-10T08:00:00.000Z', lat: 38.7, lng: -9.15, upload_status: 'pending',
});
const THREE_WITHOUT_PLACE = [withoutUrlM, k9, k0, k1, k2, k3, k4, k5];
const POOL_THREE = {
  ...POOL_OK,
  urls: new Map<string, MediaUrl>(
    ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k9'].map((id) => [id, image(id)] as const)
  ),
};

// The same trip as a query WITHOUT an order guarantee could deliver it.
// `fetchRecapMoments` sorts by itself today, which is exactly why it would
// show nowhere if the index of a moment without a place came from the
// incoming order instead of from the sorted playlist.
const THREE_WITHOUT_PLACE_UNSORTED = [k5, k2, withoutUrlM, k3, k0, k9, k4, k1];

async function openWithoutPlace() {
  await fireEvent.press(screen.getByText('3 Momente ohne Ort'));
}

test('the bar names the moments without a place', async () => {
  loadSuccess(THREE_WITHOUT_PLACE, POOL_THREE);
  await wrap();
  expect(await screen.findByText('3 Momente ohne Ort')).toBeTruthy();
});

// COMPLETE has exactly one moment without a place (p3).
test('a single moment without a place reads in the singular', async () => {
  loadSuccess();
  await wrap();
  expect(await screen.findByText('1 Moment ohne Ort')).toBeTruthy();
});

test('without such moments there is no bar', async () => {
  loadSuccess(CLOSE_TOGETHER);
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  expect(screen.queryByText(/ohne Ort/)).toBeNull();
});

// ---------------------------------------------------------------------------
// Moments this map does not carry at all
// ---------------------------------------------------------------------------
//
// The load path filters on `uploaded && urls.has` and that stays, because
// `point.index` has to match the playlist. COMPLETE contains exactly one of
// each kind: p4 is still uploading, p5 has a coordinate but no url in the
// pool.
test('moments still uploading are named instead of silently missing', async () => {
  loadSuccess();
  await wrap();
  expect(await screen.findByText('1 Moment ist noch unterwegs.')).toBeTruthy();
});

test('moments without an image url are named instead of silently missing', async () => {
  loadSuccess();
  await wrap();
  expect(
    await screen.findByText('1 Moment liess sich gerade nicht laden. Schau später nochmal rein.')
  ).toBeTruthy();
});

test('the notice about missing moments catches no tap', async () => {
  loadSuccess();
  await wrap();
  expect(
    (await screen.findByTestId('karte-fehlen-ganz')).props.pointerEvents
  ).toBe('none');
});

test('a complete trip claims nothing of the sort', async () => {
  loadSuccess(CLOSE_TOGETHER, { ...POOL_OK, ausgelassen: 0 });
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  expect(screen.queryByTestId('karte-fehlen-ganz')).toBeNull();
  expect(screen.queryByText(/noch unterwegs/)).toBeNull();
  expect(screen.queryByText(/nicht laden/)).toBeNull();
});

test('the bar opens a sheet with one tile per moment without a place', async () => {
  loadSuccess(THREE_WITHOUT_PLACE, POOL_THREE);
  await wrap();
  await screen.findByText('3 Momente ohne Ort');
  await openWithoutPlace();

  expect(screen.getAllByTestId(/^ohne-ort-kachel/)).toHaveLength(3);
  expect(screen.getByTestId('ohne-ort-kachel-k0')).toBeTruthy();
  expect(screen.getByTestId('ohne-ort-kachel-k2')).toBeTruthy();
  expect(screen.getByTestId('ohne-ort-kachel-k5')).toBeTruthy();
});

test('every tile carries the thumbnail of its own moment', async () => {
  loadSuccess(THREE_WITHOUT_PLACE, POOL_THREE);
  await wrap();
  await screen.findByText('3 Momente ohne Ort');
  await openWithoutPlace();

  const tile = screen.getByTestId('ohne-ort-kachel-k2');
  expect(within(tile).getByTestId('ohne-ort-bild-k2').props.source.uri).toBe(image('k2').thumb_url);
});

// `start` counts into the PLAYLIST, never into the moments without a place
// and never into the raw moment list. k5 keeps all three numbers apart (see
// the fixture above).
test('from the sheet the way leads into the player', async () => {
  loadSuccess(THREE_WITHOUT_PLACE, POOL_THREE);
  await wrap();
  await screen.findByText('3 Momente ohne Ort');
  await openWithoutPlace();
  await fireEvent.press(screen.getByTestId('ohne-ort-kachel-k5'));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player',
    params: { id: 't1', start: '5' },
  });
});

// Coming from the incoming list, k5 would stand at 0 here (the pins would sit
// right all the same).
test('the index of a moment without a place does not hang on the incoming order', async () => {
  loadSuccess(THREE_WITHOUT_PLACE_UNSORTED, POOL_THREE);
  await wrap();
  await screen.findByText('3 Momente ohne Ort');
  await openWithoutPlace();
  await fireEvent.press(screen.getByTestId('ohne-ort-kachel-k5'));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player',
    params: { id: 't1', start: '5' },
  });
});

test('the day filter does not thin out the moments without a place', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  expect(await screen.findByText('1 Moment ohne Ort')).toBeTruthy();

  await openDayFilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));

  // p3 (without a place) lies on day 1, the bar names it all the same.
  expect(screen.getByText('1 Moment ohne Ort')).toBeTruthy();
});

// The same dead end as with the cluster and day lists: `Sheet` caps at 85 %
// window height and clips the overhang hard.
const MANY_WITHOUT_PLACE = [
  moment({ id: 'w0', captured_at: '2026-08-10T08:00:00.000Z', lat: 38.71, lng: -9.14 }),
  ...Array.from({ length: 12 }, (_, i) => withoutPlaceMoment(`w${i + 1}`, 9 + i)),
];
const POOL_MANY_WITHOUT_PLACE = {
  ...POOL_OK,
  urls: new Map<string, MediaUrl>(
    Array.from({ length: 13 }, (_, i) => [`w${i}`, image(`w${i}`)] as const)
  ),
};

test('the tile list scrolls instead of clipping its last moments', async () => {
  loadSuccess(MANY_WITHOUT_PLACE, POOL_MANY_WITHOUT_PLACE);
  await wrap();
  await fireEvent.press(await screen.findByText('12 Momente ohne Ort'));

  const list = screen.getByTestId('ohne-ort-liste');
  expect(list.type).toBe('RCTScrollView');
  expect(StyleSheet.flatten(list.props.style).maxHeight).toBe(
    Dimensions.get('window').height * SHEET_SCROLL_RATIO
  );
  expect(within(list).getAllByTestId(/^ohne-ort-kachel/)).toHaveLength(12);
});

// w12 is at playlist position 12.
test('even the last tile leads into the player', async () => {
  loadSuccess(MANY_WITHOUT_PLACE, POOL_MANY_WITHOUT_PLACE);
  await wrap();
  await fireEvent.press(await screen.findByText('12 Momente ohne Ort'));
  await fireEvent.press(within(screen.getByTestId('ohne-ort-liste')).getByTestId('ohne-ort-kachel-w12'));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player',
    params: { id: 't1', start: '12' },
  });
});

test('the tiles of the moments without a place appear staggered', async () => {
  const spy = jest.spyOn(Animated, 'timing');
  loadSuccess(THREE_WITHOUT_PLACE, POOL_THREE);
  await wrap();
  await screen.findByText('3 Momente ohne Ort');
  await openWithoutPlace();

  expect(staggerDelays()).toEqual([0, 40, 80]);
  expect(staggerDurations()).toEqual([
    motion.duration.base, motion.duration.base, motion.duration.base,
  ]);
  spy.mockRestore();
});

test('with Reduced Motion the tiles appear without stagger, in 200 ms', async () => {
  const spy = jest.spyOn(Animated, 'timing');
  mockReducedMotion = true;
  loadSuccess(THREE_WITHOUT_PLACE, POOL_THREE);
  await wrap();
  await screen.findByText('3 Momente ohne Ort');
  await openWithoutPlace();

  expect(staggerDelays()).toEqual([0, 0, 0]);
  expect(staggerDurations()).toEqual([200, 200, 200]);
  spy.mockRestore();
});

test('a change of trip leaves no open sheet of the moments without a place standing', async () => {
  loadSuccess(THREE_WITHOUT_PLACE, POOL_THREE);
  const { rerender } = await wrap();
  await screen.findByText('3 Momente ohne Ort');
  await openWithoutPlace();
  expect(screen.getByTestId('ohne-ort-kachel-k5')).toBeTruthy();

  mockId = 't2';
  loadSuccess(THREE_WITHOUT_PLACE, POOL_THREE);
  await rerender(<ThemeProvider><RecapMap /></ThemeProvider>);

  expect(screen.queryByTestId('ohne-ort-kachel-k5')).toBeNull();
});

test('the bar closes an open moment sheet', async () => {
  loadSuccess(THREE_WITHOUT_PLACE, POOL_THREE);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-k1'));
  expect(screen.getByText('Im Recap ansehen')).toBeTruthy();

  await openWithoutPlace();
  expect(screen.queryByText('Im Recap ansehen')).toBeNull();
  expect(screen.getByTestId('ohne-ort-kachel-k5')).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Still loading, could not load and no places are three different things
// ---------------------------------------------------------------------------

test('before the first answer a skeleton stands there, not the explanation', async () => {
  (fetchRecapMoments as jest.Mock).mockReturnValue(new Promise(() => {}));
  (getPool as jest.Mock).mockReturnValue(new Promise(() => {}));
  await wrap();

  expect(screen.getByTestId('karte-skelett')).toBeTruthy();
  expect(screen.queryByText('Diese Reise hat keine Orte')).toBeNull();
  expect(screen.queryByTestId('karte-flaeche')).toBeNull();
});

// Neither `urlPool.ts` nor `recapApi.ts` knows a timeout or an
// AbortController. If one of them hangs, the skeleton without a way back is a
// dead end: the map, unlike the overview, is no tab root but reached by
// `push`.
test('even in the loading state a way leads back', async () => {
  (fetchRecapMoments as jest.Mock).mockReturnValue(new Promise(() => {}));
  (getPool as jest.Mock).mockReturnValue(new Promise(() => {}));
  await wrap();

  await fireEvent.press(screen.getByLabelText('Zurück'));
  expect(mockBack).toHaveBeenCalled();
});

test('a load error names its reason instead of looking like a trip without places', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
  (getPool as jest.Mock).mockResolvedValue({
    pool: null, error: LOAD_ERROR, reason: null,
  });
  await wrap();

  expect(await screen.findByText(LOAD_ERROR)).toBeTruthy();
  expect(screen.queryByText('Diese Reise hat keine Orte')).toBeNull();
  expect(screen.getByText('Nochmal versuchen')).toBeTruthy();
});

test('an error of the moments query does not stay mute either', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({
    data: [], error: 'Die Momente konnten nicht geladen werden. Probier es gleich nochmal.',
  });
  (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  await wrap();

  expect(
    await screen.findByText('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.')
  ).toBeTruthy();
  expect(screen.queryByText('Diese Reise hat keine Orte')).toBeNull();
});

test('when the load path throws the screen explains it all the same', async () => {
  (fetchRecapMoments as jest.Mock).mockRejectedValue(new Error('kaputt'));
  (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  await wrap();

  expect(
    await screen.findByText('Die Karte konnte nicht geladen werden. Probier es gleich nochmal.')
  ).toBeTruthy();
  expect(screen.queryByText('Diese Reise hat keine Orte')).toBeNull();
});

test('the try again button brings the map back', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: 'Gerade keine Verbindung.' });
  (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  await wrap();
  await screen.findByText('Gerade keine Verbindung.');

  loadSuccess();
  await fireEvent.press(screen.getByText('Nochmal versuchen'));

  expect(await screen.findByTestId('karte-nadel-p1')).toBeTruthy();
  expect(screen.queryByText('Gerade keine Verbindung.')).toBeNull();
});

test('when no moment has a place the screen explains it', async () => {
  loadSuccess([m3]);
  await wrap();

  expect(await screen.findByText('Diese Reise hat keine Orte')).toBeTruthy();
  expect(
    screen.getByText(
      'Momente bekommen ihren Ort beim Einsenden, aber nur, wenn die Ortungsdienste erlaubt sind. Für diese Reise war das nie der Fall.'
    )
  ).toBeTruthy();
  expect(screen.queryByTestId(/^karte-nadel/)).toBeNull();
});

test('a trip without a single moment does not talk about location services', async () => {
  loadSuccess([]);
  await wrap();

  expect(await screen.findByText('Diese Reise ist leer geblieben.')).toBeTruthy();
  expect(screen.queryByText('Diese Reise hat keine Orte')).toBeNull();
  expect(screen.queryByText(/Ortungsdienste/)).toBeNull();
  expect(screen.queryByTestId('karte-flaeche')).toBeNull();
});

test('a trip with moments that lack a place does not talk about an empty trip', async () => {
  loadSuccess([m3]);
  await wrap();

  expect(await screen.findByText('Diese Reise hat keine Orte')).toBeTruthy();
  expect(screen.queryByText('Diese Reise ist leer geblieben.')).toBeNull();
});

test('a trip whose moments are all still on their way counts as empty', async () => {
  loadSuccess([pendingM]);
  await wrap();

  expect(await screen.findByText('Diese Reise ist leer geblieben.')).toBeTruthy();
  expect(screen.queryByText('Diese Reise hat keine Orte')).toBeNull();
});

test('the empty state carries exactly one button', async () => {
  loadSuccess([m3]);
  await wrap();
  await screen.findByText('Diese Reise hat keine Orte');

  expect(screen.getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual([
    'Zurück zur Übersicht',
  ]);
});

test('the one button of the empty state leads back', async () => {
  loadSuccess([m3]);
  await wrap();
  await fireEvent.press(await screen.findByText('Zurück zur Übersicht'));
  expect(mockBack).toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// The load state belongs to ONE trip
// ---------------------------------------------------------------------------
//
// The screen stays mounted when the id changes and the new moments take their
// time. In exactly that window the load state of t1 stood over t2, not for
// one frame but for the full load duration.

// Starts t1, switches to t2 and leaves its moments open. What comes back is
// the state in exactly that window.
async function switchToHangingT2(rerender: (tree: React.ReactElement) => Promise<void>) {
  mockId = 't2';
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...TRIP, id: 't2' }, error: null });
  (fetchRecapMoments as jest.Mock).mockReturnValue(new Promise(() => {}));
  (getPool as jest.Mock).mockReturnValue(new Promise(() => {}));
  await rerender(<ThemeProvider><RecapMap /></ThemeProvider>);
}

test('the empty state of t1 does not stand over t2', async () => {
  loadSuccess([m3]);
  const { rerender } = await wrap();
  await screen.findByText('Diese Reise hat keine Orte');

  await switchToHangingT2(rerender);

  expect(screen.queryByText('Diese Reise hat keine Orte')).toBeNull();
  expect(screen.getByTestId('karte-skelett')).toBeTruthy();
});

test('the error of t1 does not stand over t2', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: 'Kein Zugriff auf diese Reise.' });
  (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  const { rerender } = await wrap();
  await screen.findByText('Kein Zugriff auf diese Reise.');

  await switchToHangingT2(rerender);

  expect(screen.queryByText('Kein Zugriff auf diese Reise.')).toBeNull();
  expect(screen.queryByText('Nochmal versuchen')).toBeNull();
  expect(screen.getByTestId('karte-skelett')).toBeTruthy();
});

// The most dangerous of the three: a sheet opened now already carries
// `tripId: t2`, so the guard does not bite, and a tile would send the player
// into t2 with t1's index.
test('the bar of t1 does not stand over t2', async () => {
  loadSuccess();
  const { rerender } = await wrap();
  await screen.findByText('1 Moment ohne Ort');

  await switchToHangingT2(rerender);

  expect(screen.queryByText(/ohne Ort/)).toBeNull();
  expect(screen.getByTestId('karte-skelett')).toBeTruthy();
});

// ---------------------------------------------------------------------------
// The two silent load paths
// ---------------------------------------------------------------------------

test('when the trip query fails it at least leaves a trace', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  (fetchTrip as jest.Mock).mockResolvedValue({
    data: null, error: 'Diese Reise konnte nicht geladen werden.',
  });
  await wrap();
  await screen.findAllByTestId(/^karte-nadel/);

  expect(reportError).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'Diese Reise konnte nicht geladen werden.' }),
    { screen: 'recap/map', tripId: 't1', loadPath: 'trip' }
  );
});

test('a successful trip query reports nothing', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  await screen.findByTestId('karte-tagesfilter');
  expect(reportError).not.toHaveBeenCalled();
});

// The number gap: WITHOUT_PLACE_IN_BETWEEN has only moments without a place
// on day 2. The overview shows that day, the map filter jumps from 1 to 3,
// and without a line about it that looks like a fault.
test('the gap in the day numbers is explained', async () => {
  loadSuccess(WITHOUT_PLACE_IN_BETWEEN, POOL_WITHOUT_PLACE_IN_BETWEEN);
  await wrap();
  await screen.findByTestId('karte-nadel-q3');

  await openDayFilter();
  expect(screen.queryByTestId('tag-eintrag-2')).toBeNull();
  expect(
    screen.getByText('Tage, an denen kein Moment einen Ort hat, stehen nicht zur Wahl.')
  ).toBeTruthy();
});

test('without a gap the line is not there', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await openDayFilter();
  expect(screen.getByTestId('tag-eintrag-1')).toBeTruthy();
  expect(screen.getByTestId('tag-eintrag-2')).toBeTruthy();
  expect(screen.queryByText(/stehen nicht zur Wahl/)).toBeNull();
});

// ---------------------------------------------------------------------------
// The review checklist from DESIGN-LANGUAGE §9
// ---------------------------------------------------------------------------

// §9, point 6: exactly one primary button per screen. That cannot be counted
// from the source: this screen has NINE visible states and each renders a
// different tree, loading, error, the two empty cases, the map itself and the
// map again with each of the four sheets. A glance at the JSX shows only
// where `Button` stands, not which of them are on screen at the same time.
//
// The primary button is recognised by its signature from components/Button.tsx:
// a borderless surface of height 52 in one of the three colours a primary
// button can take. Not by its label, which could change without anything
// showing up here. Not by colour alone: the counter pill of the pin carries
// `accent` as well, but height 20. And not by height alone: the secondary
// button is 52 high too.
//
// THREE colours, not just `accent`: `Button.tsx` paints the surface
// `accent-pressed` while `pressed` and `bg-1` while `blocked` (disabled OR
// loading). A LOADING primary button was therefore not recognised at all, and
// the assurance did not hold for the state in which it tips over most easily.
// The border sets it apart from the secondary button: that one carries
// `bg-0`/`bg-1` and ALWAYS `borderWidth: 1`, the primary button never one.
const PRIMARY_SURFACES: readonly (string | undefined)[] = [
  palette.accent,
  palette['accent-pressed'],
  palette['bg-1'],
];

type TestNode = ReturnType<typeof screen.queryAllByRole>[number];

function carriesAccentSurface(node: TestNode): boolean {
  return (
    node.queryAll((child) => {
      const style = StyleSheet.flatten(child.props.style as StyleProp<ViewStyle>) as
        | ViewStyle
        | undefined;
      if (style?.height !== 52) return false;
      if (style.borderWidth) return false;
      return PRIMARY_SURFACES.includes(style.backgroundColor as string | undefined);
    }).length > 0
  );
}

function primaryButtons(): unknown[] {
  return screen
    .queryAllByRole('button')
    .filter(carriesAccentSurface)
    .map((button) => button.props.accessibilityLabel);
}

function hangingLoadPath() {
  (fetchRecapMoments as jest.Mock).mockReturnValue(new Promise(() => {}));
  (getPool as jest.Mock).mockReturnValue(new Promise(() => {}));
}

test('§9: the loading state carries no primary button', async () => {
  hangingLoadPath();
  await wrap();
  expect(screen.getByTestId('karte-skelett')).toBeTruthy();
  expect(primaryButtons()).toEqual([]);
});

// An error where a second try can achieve something: no `reason`, so a
// snapshot (network gone, 502 while signing). Only there does the button
// stand, see the test below.
test('§9: the error state carries exactly one primary button', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
  (getPool as jest.Mock).mockResolvedValue({
    pool: null, error: LOAD_ERROR, reason: null,
  });
  await wrap();
  await screen.findByText(LOAD_ERROR);
  expect(primaryButtons()).toEqual(['Nochmal versuchen']);
});

// The two sealed and no access texts are DECISIONS of the server, not an
// outage: they stay that way until something outside this app changes. The
// button stood there all the same up to here, and it could be pressed as
// often as one liked. A state with no primary button at all is allowed by §4,
// the way back at the top left stays reachable in any case.
test.each([
  ['Diese Reise ist noch versiegelt.', 'versiegelt'],
  ['Kein Zugriff auf diese Reise.', 'kein_zugriff'],
])('§9: under «%s» there is no button that nobody could ever redeem', async (text, reason) => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
  (getPool as jest.Mock).mockResolvedValue({ pool: null, error: text, reason });
  await wrap();
  await screen.findByText(text);
  expect(primaryButtons()).toEqual([]);
  expect(screen.queryByLabelText('Nochmal versuchen')).toBeNull();
  expect(screen.getByLabelText('Zurück')).toBeTruthy();
});

// The `reason` belongs to the POOL. If the MOMENTS fail the situation is a
// different one, and there a second try does help.
test('§9: a moments error keeps its button, even next to a pool that succeeded', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: LOAD_ERROR });
  (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  await wrap();
  await screen.findByText(LOAD_ERROR);
  expect(primaryButtons()).toEqual(['Nochmal versuchen']);
});

// `Button.tsx` paints the surface `bg-1` while `blocked` (disabled or
// loading), so until this addendum the detector above no longer recognised
// it, and the assurance held for exactly the state in which a second button
// would join without anybody noticing.
test('§9: a loading primary button counts as a primary button too', async () => {
  (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
  (getPool as jest.Mock).mockResolvedValue({
    pool: null, error: LOAD_ERROR, reason: null,
  });
  await wrap();
  await screen.findByText(LOAD_ERROR);

  // The second attempt hangs: the button stays in its loading state.
  hangingLoadPath();
  await fireEvent.press(screen.getByLabelText('Nochmal versuchen'));

  expect(screen.getByTestId('button-loading')).toBeTruthy();
  expect(primaryButtons()).toEqual(['Nochmal versuchen']);
});

test('§9: the empty trip carries exactly one primary button', async () => {
  loadSuccess([]);
  await wrap();
  await screen.findByText('Diese Reise ist leer geblieben.');
  expect(primaryButtons()).toEqual(['Zurück zur Übersicht']);
});

test('§9: the trip without places carries exactly one primary button', async () => {
  loadSuccess([m3]);
  await wrap();
  await screen.findByText('Diese Reise hat keine Orte');
  expect(primaryButtons()).toEqual(['Zurück zur Übersicht']);
});

test('§9: the map itself carries no primary button', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  expect(primaryButtons()).toEqual([]);
});

test('§9: with an open moment sheet it is exactly one', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(primaryButtons()).toEqual(['Im Recap ansehen']);
});

test('§9: the cluster sheet adds no second one', async () => {
  loadSuccess(ON_ONE_SPOT);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(screen.getByTestId('gruppe-liste')).toBeTruthy();
  expect(primaryButtons()).toEqual([]);
});

test('§9: the day sheet adds no second one', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  await screen.findByTestId('karte-tagesfilter');
  await openDayFilter();
  expect(screen.getByTestId('tag-eintrag-alle')).toBeTruthy();
  expect(primaryButtons()).toEqual([]);
});

test('§9: the sheet of the moments without a place adds no second one', async () => {
  loadSuccess(THREE_WITHOUT_PLACE, POOL_THREE);
  await wrap();
  await screen.findByText('3 Momente ohne Ort');
  await openWithoutPlace();
  expect(screen.getAllByTestId(/^ohne-ort-kachel/)).toHaveLength(3);
  expect(primaryButtons()).toEqual([]);
});

// Two sheets at once means two backdrops (`backdrop`, tokens.ts,
// rgba(0,0,0,0.4)) on top of each other, darkening to about 0.64 together. No
// token yields that value (§9, point 3), and on top of it two `shadow-3`
// panels would lie on each other, of which a swipe closes only the upper one
// (§9, point 5).
test('§9: a tap on a pin closes an open day sheet', async () => {
  loadSuccess(WITH_DAYS, POOL_DAYS);
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  await openDayFilter();
  expect(screen.getByTestId('tag-eintrag-alle')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('karte-nadel-p1'));

  expect(screen.getByText('Im Recap ansehen')).toBeTruthy();
  expect(screen.queryByTestId('tag-eintrag-alle')).toBeNull();
  expect(screen.getAllByTestId('sheet-panel')).toHaveLength(1);
});

// §9, point 8: reduced motion is respected everywhere, not only for the
// camera. The skeleton pulse is the only movement on this screen that runs
// without any input. Readable only from WHETHER a loop starts: `Animated`
// flattens the opacity under `useNativeDriver` in Jest to a number and never
// touches it again (same reason as in components/__tests__/MapPin.test.tsx).
test('§9: the skeleton pulses while the map is loading', async () => {
  const spy = jest.spyOn(Animated, 'loop');
  hangingLoadPath();
  await wrap();
  expect(screen.getByTestId('karte-skelett')).toBeTruthy();
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});

test('§9: with Reduced Motion the skeleton stands still instead of pulsing', async () => {
  const spy = jest.spyOn(Animated, 'loop');
  mockReducedMotion = true;
  hangingLoadPath();
  await wrap();
  expect(screen.getByTestId('karte-skelett')).toBeTruthy();
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});
