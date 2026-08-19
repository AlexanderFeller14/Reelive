import { StyleSheet } from 'react-native';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

// Fake timers globally (as in player.test.tsx): Date.now() runs in step with
// the timers, which this screen needs for the same hold-versus-tap
// distinction as the native player.
jest.useFakeTimers();

let mockToken = 'tok123';
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ token: mockToken }),
}));

const mockSetStatusBarStyle = jest.fn();
jest.mock('expo-status-bar', () => ({ setStatusBarStyle: (...a: unknown[]) => mockSetStatusBarStyle(...a) }));

// expo-image: a simple View placeholder that passes every prop through
// (including `source` and `testID`, the same pattern as player.test.tsx),
// plus a `prefetch` spy of its own.
const mockPrefetch = jest.fn();
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  const Image = (props: Record<string, unknown>) => ReactActual.createElement(View, props);
  Image.prefetch = (...args: unknown[]) => mockPrefetch(...args);
  return { Image };
});

// expo-video: one single fake player object with controllable listeners (the
// same pattern as player.test.tsx).
const mockListeners: Record<string, Array<(payload?: unknown) => void>> = {};
let mockLastSource: unknown;
const mockVideoPlayer = {
  loop: false,
  play: jest.fn(),
  pause: jest.fn(),
  addListener: jest.fn((event: string, cb: (payload?: unknown) => void) => {
    mockListeners[event] = mockListeners[event] ?? [];
    mockListeners[event].push(cb);
    return { remove: jest.fn() };
  }),
};
const mockUseVideoPlayer = jest.fn((source: unknown, setup?: (p: typeof mockVideoPlayer) => void) => {
  if (source !== mockLastSource) {
    for (const key of Object.keys(mockListeners)) delete mockListeners[key];
    mockLastSource = source;
    setup?.(mockVideoPlayer);
  }
  return mockVideoPlayer;
});
jest.mock('expo-video', () => ({
  useVideoPlayer: (source: unknown, setup?: (p: unknown) => void) => mockUseVideoPlayer(source, setup),
  VideoView: (props: Record<string, unknown>) => {
    const ReactActual = require('react');
    const { View } = require('react-native');
    return ReactActual.createElement(View, { testID: props.testID });
  },
}));

jest.mock('@/features/sharing/shareApi', () => ({
  resolveToken: jest.fn(),
  DEAD_LINK_TEXT: 'Dieser Link funktioniert nicht mehr.',
}));

// DESIGN-LANGUAGE §5: "haptics: selection (tabs, zoom)", the map's cluster
// zoom reports it. Pattern as in player.test.tsx/map.test.tsx: the native
// module does not exist in the test run.
const mockHaptics = jest.fn(() => Promise.resolve());
jest.mock('expo-haptics', () => ({ selectionAsync: () => mockHaptics() }));
// Controllable as in map.test.tsx: without it the camera's jump branch could
// not be reached at all, AccessibilityInfo always reports "no reduction" in
// the test run.
let mockReducedMotion = false;
jest.mock('@/theme/useReducedMotion', () => ({ useReducedMotion: () => mockReducedMotion }));

import SharedRecapScreen from '../[token]';
import { resolveToken } from '@/features/sharing/shareApi';
import type { SharedRecap } from '@/features/sharing/shareApi';

const mockResolveToken = resolveToken as jest.MockedFunction<typeof resolveToken>;

beforeEach(() => {
  jest.clearAllMocks();
  mockToken = 'tok123';
  mockReducedMotion = false;
  for (const key of Object.keys(mockListeners)) delete mockListeners[key];
  mockLastSource = undefined;
});

function trip(overrides: Partial<SharedRecap['reise']> = {}) {
  return { name: 'Lissabon Städtetrip', start_date: '2026-08-10', end_date: '2026-08-14', ...overrides };
}

// Without coordinates by default: the moments of the existing blocks test the
// player, and a recap without a single place has no way into the map (spec
// K9), so they stay exactly the story they were before.
function moment(overrides: Partial<SharedRecap['medien'][number]> = {}): SharedRecap['medien'][number] {
  return {
    post_id: 'p0', authorName: 'Lea', authorAvatarKey: null, type: 'photo', duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Zurich', place_name: 'Lissabon',
    lat: null, lng: null,
    medium_url: 'https://s3/p0', thumb_url: null,
    ...overrides,
  };
}

// Day 1 (10.8.): p1 (photo, 09:00), p2 (video, 10:00, duration_s=3). Day 2
// (11.8., no place_name): p3 (photo, 09:00, last moment).
const p1 = moment({ post_id: 'p1', captured_at: '2026-08-10T09:00:00.000Z' });
const p2 = moment({
  post_id: 'p2', type: 'video', duration_s: 3, caption: 'Schön hier',
  captured_at: '2026-08-10T10:00:00.000Z',
});
const p3 = moment({
  post_id: 'p3', captured_at: '2026-08-11T09:00:00.000Z', place_name: null,
});

function success(
  media: SharedRecap['medien'],
  tripOverrides: Partial<SharedRecap['reise']> = {},
  skipped = 0
) {
  return {
    data: { reise: trip(tripOverrides), medien: media, validUntil: Date.now() + 3600_000, ausgelassen: skipped },
    error: null,
  };
}

// Same pattern as player.test.tsx (its `wrap()`): render() is already fully
// async under RNTL v14, the extra empty act() flush makes the await
// resolveToken(...) in load() plus the wave of setState that follows commit
// for certain BEFORE the test makes its first assertion; without that second
// flush the screen would stay stuck on the loading phase in some runs.
async function ready() {
  const utils = await render(<SharedRecapScreen />);
  await act(async () => {});
  return utils;
}

describe('Loading', () => {
  test('shows a loading indicator first and calls resolveToken with the token from the URL', async () => {
    mockToken = 'abc';
    mockResolveToken.mockReturnValue(new Promise(() => {})); // hangs on purpose
    await render(<SharedRecapScreen />);
    expect(screen.getByTestId('teilen-laedt')).toBeTruthy();
    expect(mockResolveToken).toHaveBeenCalledWith('abc');
  });

  test('a rejected or dead link shows exactly the error text, and "Nochmal versuchen" loads again', async () => {
    mockResolveToken.mockResolvedValueOnce({ data: null, error: 'Dieser Link funktioniert nicht mehr.' });
    await ready();
    expect(screen.getByTestId('teilen-fehler')).toBeTruthy();
    expect(screen.getByText('Dieser Link funktioniert nicht mehr.')).toBeTruthy();

    mockResolveToken.mockResolvedValueOnce(success([p1]));
    await fireEvent.press(screen.getByText('Nochmal versuchen'));
    await act(async () => {});
    expect(mockResolveToken).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
  });

  test('a resolved but empty reel shows the empty message with the trip name', async () => {
    mockResolveToken.mockResolvedValueOnce(success([], { name: 'Herbstwanderung' }));
    await ready();
    expect(screen.getByTestId('teilen-leer')).toBeTruthy();
    expect(screen.getByText('Herbstwanderung ist leer geblieben.')).toBeTruthy();
  });

  // The screen stays mounted when the token changes (same route, different
  // parameter), so everything of the previous resolution has to go: without
  // that, the map of the trip before would still be standing there, and a
  // sheet on it would carry a moment that the new playlist counts differently.
  test('a new token starts over in the player instead of staying in the view of the trip before', async () => {
    const withPlace = moment({ post_id: 'm1', lat: 38.7139, lng: -9.1301 });
    mockResolveToken.mockResolvedValueOnce(success([withPlace]));
    const { rerender } = await ready();
    await fireEvent.press(await screen.findByText('Auf der Karte'));
    expect(screen.getByTestId('teilen-karte')).toBeTruthy();

    mockToken = 'tok999';
    mockResolveToken.mockResolvedValueOnce(success([withPlace], { name: 'Herbstwanderung' }));
    await rerender(<SharedRecapScreen />);
    await act(async () => {});
    expect(mockResolveToken).toHaveBeenLastCalledWith('tok999');
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
    expect(screen.queryByTestId('teilen-karte')).toBeNull();
  });
});

describe('The story on screen', () => {
  test('shows the progress bar, the author, the place and time pill and the caption of the active moment', async () => {
    mockResolveToken.mockResolvedValueOnce(success([p1, p2]));
    await ready();
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
    expect(screen.getByTestId('fortschrittsbalken')).toBeTruthy();
    expect(screen.getAllByTestId(/fortschritt-segment-/)).toHaveLength(2);
    expect(screen.getByText('Lea')).toBeTruthy();
    expect(screen.getByText(/Lissabon · \d{2}:\d{2}/)).toBeTruthy();
    expect(screen.queryByTestId('teilen-caption')).toBeNull(); // p1 has no caption
  });

  test('a video moment shows the caption of the video', async () => {
    mockResolveToken.mockResolvedValueOnce(success([p2]));
    await ready();
    expect(screen.getByTestId('teilen-video')).toBeTruthy();
    expect(screen.getByText('Schön hier')).toBeTruthy();
  });

  // Task 10: the screen now uses the shared Avatar (components/Avatar.tsx)
  // instead of a local AvatarInitiale copy. A moment with an avatar key must
  // therefore really show an <Image> (same pattern as player.test.tsx, "the
  // player shows the author's profile picture"), not merely carry the mapped
  // field.
  test('shows the profile picture of the author when the moment carries an image key', async () => {
    mockResolveToken.mockResolvedValueOnce(
      success([moment({ post_id: 'p1', authorAvatarKey: 'profiles/u1/a.jpg' })])
    );
    await ready();
    expect(await screen.findByTestId('avatar-bild')).toBeTruthy();
  });

  // Counter-check: without an image key the initial stays and there is no
  // <Image> in the tree, otherwise the test above would be no proof but would
  // show an <Image> that is always there.
  test('without an image key only the initial stands there, and no profile picture', async () => {
    mockResolveToken.mockResolvedValueOnce(success([moment({ post_id: 'p1', authorAvatarKey: null })]));
    await ready();
    expect(screen.getByText('L')).toBeTruthy();
    expect(screen.queryByTestId('avatar-bild')).toBeNull();
  });

  test('the footer shows the Reelive wordmark and the app hint, and stays untouchable', async () => {
    mockResolveToken.mockResolvedValueOnce(success([p1]));
    await ready();
    const footer = screen.getByTestId('teilen-fussleiste');
    expect(screen.getByText('Reelive')).toBeTruthy();
    expect(screen.getByText('Hol dir die App')).toBeTruthy();
    // Not interactive: a touch in this spot has to belong to the tap zone
    // underneath, not to the footer (which has no button/onPress anyway,
    // there is no store link yet, see the comment in the screen).
    expect(footer.props.pointerEvents).toBe('none');
  });

  // The spy on Image.prefetch sits in the expo-image mock above. Videos are
  // deliberately left out, expo-video buffers on its own once it is mounted.
  test('preloads the photos that are coming up and leaves the videos to expo-video', async () => {
    const r1 = moment({ post_id: 'r1', captured_at: '2026-08-10T09:00:00.000Z', medium_url: 'https://s3/r1' });
    const r2 = moment({
      post_id: 'r2', type: 'video', duration_s: 3,
      captured_at: '2026-08-10T10:00:00.000Z', medium_url: 'https://s3/r2',
    });
    const r3 = moment({ post_id: 'r3', captured_at: '2026-08-10T11:00:00.000Z', medium_url: 'https://s3/r3' });
    mockResolveToken.mockResolvedValueOnce(success([r1, r2, r3]));
    await ready();
    expect(mockPrefetch).toHaveBeenCalledWith(['https://s3/r3']);
  });
});

describe('Navigation: tap, hold, auto advance, end', () => {
  test('a short tap on the right moves to the next moment, a tap on the left goes back', async () => {
    mockResolveToken.mockResolvedValueOnce(success([p1, p2]));
    await ready();
    expect(screen.getByText('Lea')).toBeTruthy();

    await fireEvent(screen.getByTestId('teilen-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('teilen-rechts'), 'pressOut');
    expect(screen.getByTestId('teilen-video')).toBeTruthy();

    await fireEvent(screen.getByTestId('teilen-links'), 'pressIn');
    await fireEvent(screen.getByTestId('teilen-links'), 'pressOut');
    expect(screen.getByTestId('teilen-foto')).toBeTruthy();
  });

  test('a tap on the left at the very first moment stays on the first moment', async () => {
    mockResolveToken.mockResolvedValueOnce(success([p1, p2]));
    await ready();
    await fireEvent(screen.getByTestId('teilen-links'), 'pressIn');
    await fireEvent(screen.getByTestId('teilen-links'), 'pressOut');
    expect(screen.getByTestId('teilen-foto')).toBeTruthy(); // still p1
  });

  test('holding for 250ms or more pauses the auto advance, and letting go resumes the same moment instead of navigating', async () => {
    mockResolveToken.mockResolvedValueOnce(success([p1, p2]));
    await ready();
    // The very first moment ALWAYS shows the day interstitial (dayChanges
    // returns true unconditionally for index 0), only once it is dismissed can
    // the auto advance of p1 itself be tested in isolation, otherwise it would
    // be unclear WHETHER a missing advance is due to the holding or still to
    // the interstitial.
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(screen.queryByTestId('teilen-zwischenkarte')).toBeNull();

    await fireEvent(screen.getByTestId('teilen-rechts'), 'pressIn');
    await act(async () => {
      jest.advanceTimersByTime(300); // > TAP_THRESHOLD_MS: counts as holding, not as a tap
    });
    // Even after the full photo duration has run out the moment stays put as
    // long as the finger is down (same pattern as player.test.tsx).
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('teilen-foto')).toBeTruthy(); // still p1

    await fireEvent(screen.getByTestId('teilen-rechts'), 'pressOut');
    // Let go after holding: the same moment (p1), no jump to p2.
    expect(screen.getByTestId('teilen-foto')).toBeTruthy();
    expect(screen.getByText('Lea')).toBeTruthy();
  });

  test('once the photo duration has run out the player moves on by itself', async () => {
    mockResolveToken.mockResolvedValueOnce(success([p1, p2]));
    await ready();
    expect(screen.getByTestId('teilen-foto')).toBeTruthy();

    // Two SEPARATE advanceTimersByTime calls (not one over 6500ms): the second
    // timer (auto advance) is only scheduled BY the state change of the first
    // one (interstitial gone), and cascading timers need an act() cycle of
    // their own to fire reliably (same pattern as player.test.tsx, "appears
    // before the very first moment...").
    await act(async () => {
      jest.advanceTimersByTime(1500); // interstitial gone (p1 is index 0)
    });
    await act(async () => {
      jest.advanceTimersByTime(5000); // PHOTO_DURATION_MS
    });
    expect(screen.getByTestId('teilen-video')).toBeTruthy();
  });

  test('a playToEnd event moves on without waiting for the photo duration', async () => {
    // Deliberately ONLY p2 (a single video moment): sortMoments ALWAYS sorts
    // by captured_at (CLAUDE.md cornerstone), so [p2, p1] as input order would
    // be re-sorted to [p1, p2] anyway, and a second moment is not needed for
    // this test. The proof lies in the phase switching to the end, WITHOUT
    // PHOTO_DURATION_MS (5000ms) ever having elapsed.
    mockResolveToken.mockResolvedValueOnce(success([p2]));
    await ready();
    expect(screen.getByTestId('teilen-video')).toBeTruthy();
    // Wait out the interstitial of the very first moment, blocksAutoAdvance
    // blocks playToEnd as long as it stands.
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    await act(async () => {
      for (const cb of mockListeners.playToEnd ?? []) cb();
    });
    expect(screen.getByTestId('teilen-ende')).toBeTruthy();
  });

  test('at the last moment a tap on the right ends the story, and "Nochmal ansehen" starts it over', async () => {
    mockResolveToken.mockResolvedValueOnce(success([p1], { name: 'Herbstwanderung' }));
    await ready();
    await fireEvent(screen.getByTestId('teilen-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('teilen-rechts'), 'pressOut');
    expect(screen.getByTestId('teilen-ende')).toBeTruthy();
    expect(screen.getByText('Das war der Recap von „Herbstwanderung".')).toBeTruthy();

    await fireEvent.press(screen.getByText('Nochmal ansehen'));
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
    expect(screen.getByTestId('teilen-foto')).toBeTruthy();
    // No second network call for the restart, only the original one.
    expect(mockResolveToken).toHaveBeenCalledTimes(1);
  });
});

describe('The day interstitial', () => {
  test('appears when a new day begins and disappears again after 1.5 seconds on its own', async () => {
    mockResolveToken.mockResolvedValueOnce(success([p1, p3]));
    await ready();
    // The very first moment ALWAYS shows the day interstitial (dayChanges
    // returns true unconditionally for index 0).
    expect(screen.getByTestId('teilen-zwischenkarte')).toBeTruthy();
    expect(screen.getByText(/Tag 1 · Lissabon · 10\. August/)).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(screen.queryByTestId('teilen-zwischenkarte')).toBeNull();

    // On to p3 (day 2, another date), the interstitial appears again.
    await fireEvent(screen.getByTestId('teilen-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('teilen-rechts'), 'pressOut');
    expect(screen.getByTestId('teilen-zwischenkarte')).toBeTruthy();
    expect(screen.getByText(/Tag 2 · 11\. August/)).toBeTruthy();
  });

  test('a tap on the interstitial skips it IMMEDIATELY without navigating on at the same time', async () => {
    mockResolveToken.mockResolvedValueOnce(success([p1, p3]));
    await ready();
    expect(screen.getByTestId('teilen-zwischenkarte')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('teilen-zwischenkarte'));
    expect(screen.queryByTestId('teilen-zwischenkarte')).toBeNull();
    expect(screen.getByText('Lea')).toBeTruthy(); // still p1, no jump to p3
  });

  // Same principle as player.test.tsx: there is no real hit testing in RNTL,
  // the stacking order is proven via StyleSheet.flatten(zIndex).
  test('the interstitial lies above the tap zones by zIndex', async () => {
    mockResolveToken.mockResolvedValueOnce(success([p1]));
    await ready();
    const left = StyleSheet.flatten(screen.getByTestId('teilen-links').props.style);
    const right = StyleSheet.flatten(screen.getByTestId('teilen-rechts').props.style);
    const interstitial = StyleSheet.flatten(screen.getByTestId('teilen-zwischenkarte').props.style);
    expect(left.zIndex).toBe(1);
    expect(right.zIndex).toBe(1);
    expect(interstitial.zIndex).toBeGreaterThan(left.zIndex as number);
  });
});

describe('The map in the shared recap (spec §5.10)', () => {
  // How long the day interstitial stands (INTERSTITIAL_DURATION_MS in the
  // screen), the same number as in the blocks above, named here because two
  // tests below need it.
  const INTERSTITIAL_MS = 1500;

  // Three moments on ONE trip day, so that no day interstitial stands over the
  // jump target: q1 with a place (index 0), q2 WITHOUT a place (index 1), q3
  // with a place (index 2).
  //
  // The moment without a place in the middle is the point of this setup: it
  // gets no pin, but it counts in the playlist. Whoever starts the player with
  // the position within the PINS lands on index 1 for q3, and therefore on q2.
  // Exactly that mistake is nailed down by the jump test below.
  const q1 = moment({
    post_id: 'q1', authorName: 'Lea', captured_at: '2026-08-10T09:00:00.000Z',
    place_name: 'Alfama', lat: 38.7139, lng: -9.1301, thumb_url: 'https://s3/q1-thumb',
  });
  const q2 = moment({
    post_id: 'q2', authorName: 'Jonas', captured_at: '2026-08-10T10:00:00.000Z',
    place_name: null, caption: 'Im Zug',
  });
  const q3 = moment({
    post_id: 'q3', authorName: 'Mira', captured_at: '2026-08-10T11:00:00.000Z',
    place_name: 'Bairro Alto', caption: 'Fado im Hinterhof', lat: 38.75, lng: -9.16,
  });

  async function onTheMap(media = [q1, q2, q3]) {
    mockResolveToken.mockResolvedValueOnce(success(media));
    await ready();
    await fireEvent.press(await screen.findByText('Auf der Karte'));
  }

  test('the shared recap offers the map, with both labels standing there', async () => {
    mockResolveToken.mockResolvedValueOnce(success([q1, q2, q3]));
    await ready();
    expect(await screen.findByText('Auf der Karte')).toBeTruthy();
    // Both labels are always there, the active half only says where you are.
    expect(screen.getByText('Ansehen')).toBeTruthy();
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
  });

  test('without a single place there is no way into the map', async () => {
    mockResolveToken.mockResolvedValueOnce(success([p1, p2, p3]));
    await ready();
    expect(screen.queryByText('Auf der Karte')).toBeNull();
    expect(screen.queryByText('Ansehen')).toBeNull();
  });

  test('the map replaces the player on the same screen, and «Ansehen» brings it back', async () => {
    await onTheMap();
    expect(screen.getByTestId('teilen-karte')).toBeTruthy();
    // The player is GONE, not merely covered: there is no second route (the
    // expo-router mock above offers no `router` at all, a `router.push` in
    // this screen would crash the test right here).
    expect(screen.queryByTestId('teilen-bereit')).toBeNull();

    await fireEvent.press(screen.getByText('Ansehen'));
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
    // And the surface is torn down, not hidden (see the reasoning in the
    // screen: an invisible Leaflet map builds itself on 0 × 0).
    expect(screen.queryByTestId('karte-flaeche')).toBeNull();
  });

  test('the map shows the moments with a place, and only those', async () => {
    await onTheMap();
    expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(2);
    expect(screen.getByTestId('karte-nadel-q1')).toBeTruthy();
    expect(screen.getByTestId('karte-nadel-q3')).toBeTruthy();
    expect(screen.queryByTestId('karte-nadel-q2')).toBeNull();
  });

  test('it opens with a viewport that holds both moments (K2)', async () => {
    await onTheMap();
    const region = screen.getByTestId('karte-flaeche').props.initialRegion;
    const north = region.latitude + region.latitudeDelta / 2;
    const south = region.latitude - region.latitudeDelta / 2;
    const east = region.longitude + region.longitudeDelta / 2;
    const west = region.longitude - region.longitudeDelta / 2;
    for (const m of [q1, q3]) {
      expect(m.lat!).toBeGreaterThan(south);
      expect(m.lat!).toBeLessThan(north);
      expect(m.lng!).toBeGreaterThan(west);
      expect(m.lng!).toBeLessThan(east);
    }
  });

  test('the line connects the moments in the order they were captured (K3)', async () => {
    await onTheMap();
    expect(screen.getByTestId('karte-linie').props.coordinates).toEqual([
      { latitude: q1.lat, longitude: q1.lng },
      { latitude: q3.lat, longitude: q3.lng },
    ]);
  });

  test('the shared map carries no day filter (spec §5.10)', async () => {
    await onTheMap();
    expect(screen.queryByText('Alle Tage')).toBeNull();
    expect(screen.queryByText('Tag 1')).toBeNull();
  });

  test('the moments without a place are named instead of silently missing (K6)', async () => {
    await onTheMap();
    expect(screen.getByText('1 Moment ohne Ort. Er läuft im Recap mit.')).toBeTruthy();
  });

  // The core of the task: the jump leads to EXACTLY the moment that was
  // tapped, counted into the list the shared player plays.
  test('«Ab hier ansehen» jumps to exactly that spot in the shared player', async () => {
    await onTheMap();
    await fireEvent.press(screen.getByTestId('karte-nadel-q3'));
    expect(screen.getByText('Bairro Alto')).toBeTruthy(); // the sheet is open

    await fireEvent.press(screen.getByText('Ab hier ansehen'));

    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
    expect(screen.getByText('Fado im Hinterhof')).toBeTruthy();
    expect(screen.getByText('Mira')).toBeTruthy();
    // And the index counted, not merely "something happened": the progress bar
    // fills exactly the segments BEFORE the active one, so two full ones mean
    // index 2. If the jump counted into the pin list (q1, q3), a 1 would stand
    // here, and the player would start off at q2.
    expect(screen.getAllByTestId(/^fortschritt-voll-/)).toHaveLength(2);
  });

  // Not covered by the test above, for a reason that slipped through on the
  // first attempt: after the jump the map view is no longer in the tree
  // anyway, a `queryByText('Ab hier ansehen')` would be null there even if the
  // sheet were never closed. An open sheet only becomes visible on COMING
  // BACK, where it would lie over the map without anyone having tapped a pin.
  test('the map opens without the sheet from before', async () => {
    await onTheMap();
    await fireEvent.press(screen.getByTestId('karte-nadel-q3'));
    await fireEvent.press(screen.getByText('Ab hier ansehen'));
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();

    await fireEvent.press(screen.getByText('Auf der Karte'));
    expect(screen.getByTestId('teilen-karte')).toBeTruthy();
    expect(screen.queryByText('Ab hier ansehen')).toBeNull();
    expect(screen.queryByTestId('sheet-root')).toBeNull();
  });

  test('the jump starts the story again instead of leaving it in the closing titles', async () => {
    mockResolveToken.mockResolvedValueOnce(success([q1, q2, q3]));
    await ready();
    // Tap all the way to the end: three moments, so three taps on the right,
    // the third one leads from the last moment into the closing titles.
    for (let i = 0; i < 3; i++) {
      await fireEvent(screen.getByTestId('teilen-rechts'), 'pressIn');
      await fireEvent(screen.getByTestId('teilen-rechts'), 'pressOut');
    }
    expect(screen.getByTestId('teilen-ende')).toBeTruthy();

    // The map stays reachable from the closing titles.
    await fireEvent.press(screen.getByText('Auf der Karte'));
    await fireEvent.press(screen.getByTestId('karte-nadel-q1'));
    await fireEvent.press(screen.getByText('Ab hier ansehen'));
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
    expect(screen.getByText('Lea')).toBeTruthy();
    expect(screen.getByText(/Alfama · \d{2}:\d{2}/)).toBeTruthy();
    // Index 0: no segment before the active one is full.
    expect(screen.queryAllByTestId(/^fortschritt-voll-/)).toHaveLength(0);
  });

  test('moments on the same coordinate open the list, and every entry leads to its own spot', async () => {
    // s1 and s2 lie bit-identically on top of each other, no zoom level
    // separates them (features/map/clustering.ts), they share one pin.
    const s1 = moment({
      post_id: 's1', authorName: 'Lea', captured_at: '2026-08-10T09:00:00.000Z',
      place_name: 'Alfama', lat: 38.7139, lng: -9.1301,
    });
    const s2 = moment({
      post_id: 's2', authorName: 'Jonas', captured_at: '2026-08-10T10:00:00.000Z',
      place_name: 'Alfama', caption: 'Direkt daneben', lat: 38.7139, lng: -9.1301,
    });
    const s3 = moment({
      post_id: 's3', authorName: 'Mira', captured_at: '2026-08-10T11:00:00.000Z', place_name: null,
    });
    await onTheMap([s1, s2, s3]);

    expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('karte-nadel-s1'));
    expect(screen.getByText('2 Momente an diesem Ort')).toBeTruthy();
    // No primary button in this list (DESIGN-LANGUAGE §4): that one belongs to
    // the sheet of the single moment.
    expect(screen.queryByText('Ab hier ansehen')).toBeNull();

    await fireEvent.press(screen.getByTestId('teilen-gruppe-eintrag-s2'));
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
    expect(screen.getByText('Direkt daneben')).toBeTruthy();
    expect(screen.getAllByTestId(/^fortschritt-voll-/)).toHaveLength(1);
  });

  // The player survives the switch as STATE, only its view is gone. Without a
  // brake its clock would keep running behind the map, and whoever searches
  // the map for half a minute would come out at a completely different spot.
  test('the story does not keep running behind the open map', async () => {
    mockResolveToken.mockResolvedValueOnce(success([q1, q2, q3]));
    await ready();
    // Wait out the interstitial of the very first moment FIRST: as long as it
    // stands the player is paused anyway, and a missing advance could not be
    // attributed to the map (exactly what the first version of this test ran
    // past, the mutation survived).
    await act(async () => {
      jest.advanceTimersByTime(INTERSTITIAL_MS);
    });
    expect(screen.queryByTestId('teilen-zwischenkarte')).toBeNull();

    await fireEvent.press(screen.getByText('Auf der Karte'));
    // Far more than the photo duration (5000 ms), and more than all three
    // moments together would need.
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(screen.getByTestId('teilen-karte')).toBeTruthy();

    await fireEvent.press(screen.getByText('Ansehen'));
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
    // Still on the first moment, not in the closing titles.
    expect(screen.queryAllByTestId(/^fortschritt-voll-/)).toHaveLength(0);
    expect(screen.getByText('Lea')).toBeTruthy();
  });

  // And the same for the day interstitial, along a different path: it does not
  // WAIT behind the map, it is discarded and set up anew on coming back
  // (`view` sits in the dependencies of its effect). What you see is the same,
  // the day is not already announced on coming back without anyone having read
  // it.
  test('the day interstitial begins from the start again after the map', async () => {
    mockResolveToken.mockResolvedValueOnce(success([q1, q2, q3]));
    await ready();
    expect(screen.getByTestId('teilen-zwischenkarte')).toBeTruthy();

    await fireEvent.press(screen.getByText('Auf der Karte'));
    await act(async () => {
      jest.advanceTimersByTime(INTERSTITIAL_MS * 4);
    });
    await fireEvent.press(screen.getByText('Ansehen'));
    expect(screen.getByTestId('teilen-zwischenkarte')).toBeTruthy();
  });

  // DESIGN-LANGUAGE §1: cinema only on the media screens. On the map, bright
  // tiles lie under the status bar.
  test('the status bar turns dark on the map and bright again in the player', async () => {
    await onTheMap();
    expect(mockSetStatusBarStyle).toHaveBeenLastCalledWith('dark');

    await fireEvent.press(screen.getByText('Ansehen'));
    expect(mockSetStatusBarStyle).toHaveBeenLastCalledWith('light');
  });

  // Finding 3 of the closing review: the segment row lies above the sheet by
  // zIndex and is therefore tappable even while a sheet is open (intended, the
  // way back must not be covered by anything). If «Ansehen» does not clear the
  // sheet away too, the map opens the next time with a sheet nobody tapped
  // open. Via «Ab hier ansehen» this path was closed, via the segment row it
  // stood open.
  test('«Ansehen» clears an open moment sheet away with it', async () => {
    await onTheMap();
    await fireEvent.press(screen.getByTestId('karte-nadel-q3'));
    expect(screen.getByText('Ab hier ansehen')).toBeTruthy();

    await fireEvent.press(screen.getByText('Ansehen'));
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();

    await fireEvent.press(screen.getByText('Auf der Karte'));
    expect(screen.getByTestId('teilen-karte')).toBeTruthy();
    expect(screen.queryByText('Ab hier ansehen')).toBeNull();
    expect(screen.queryByTestId('sheet-root')).toBeNull();
  });

  // Finding 1: the map has a last zoom level. If the visible viewport stays
  // the same after a cluster tap, another one achieves nothing, and then the
  // sheet belongs to the cluster even though its coordinates differ. In the
  // test run the map never reports a new viewport by itself; it stands exactly
  // as still as it would at the limit.
  test('when a cluster tap moves the camera nowhere, the next one opens the sheet', async () => {
    const g1 = moment({
      post_id: 'g1', authorName: 'Lea', captured_at: '2026-08-10T09:00:00.000Z',
      place_name: 'Alfama', lat: 38.7139, lng: -9.1301,
    });
    const g2 = moment({
      post_id: 'g2', authorName: 'Jonas', captured_at: '2026-08-10T10:00:00.000Z',
      place_name: 'Alfama', caption: 'Fünf Meter weiter', lat: 38.71408, lng: -9.1301,
    });
    const g3 = moment({
      post_id: 'g3', captured_at: '2026-08-10T11:00:00.000Z', place_name: 'Belém',
      lat: 38.7, lng: -9.2,
    });
    await onTheMap([g1, g2, g3]);

    await fireEvent.press(screen.getByTestId('karte-nadel-g1'));
    expect(screen.queryByTestId('teilen-gruppe-liste')).toBeNull(); // fly first

    await fireEvent.press(screen.getByTestId('karte-nadel-g1'));
    expect(screen.getByText('2 Momente an diesem Ort')).toBeTruthy();
    expect(screen.getByTestId('teilen-gruppe-eintrag-g2')).toBeTruthy();
  });

  // And the counter-check that keeps the zoom path alive: if the viewport has
  // changed between the two taps, the camera can still achieve something, and
  // then there is still no sheet.
  test('when the viewport has moved, the second tap zooms on as well', async () => {
    const g1 = moment({
      post_id: 'g1', captured_at: '2026-08-10T09:00:00.000Z',
      place_name: 'Alfama', lat: 38.7139, lng: -9.1301,
    });
    const g2 = moment({
      post_id: 'g2', captured_at: '2026-08-10T10:00:00.000Z',
      place_name: 'Alfama', lat: 38.71408, lng: -9.1301,
    });
    const g3 = moment({
      post_id: 'g3', captured_at: '2026-08-10T11:00:00.000Z', place_name: 'Belém',
      lat: 38.7, lng: -9.2,
    });
    await onTheMap([g1, g2, g3]);

    await fireEvent.press(screen.getByTestId('karte-nadel-g1'));
    // The map reports a distinctly tighter viewport, it HAS flown.
    await fireEvent(screen.getByTestId('karte-flaeche'), 'regionChangeComplete', {
      latitude: 38.71399,
      longitude: -9.1301,
      latitudeDelta: 0.0006,
      longitudeDelta: 0.0006,
    });

    await fireEvent.press(screen.getByTestId('karte-nadel-g1'));
    expect(screen.queryByTestId('teilen-gruppe-liste')).toBeNull();
    expect(screen.queryByText(/an diesem Ort/)).toBeNull();
  });

  // Finding 2: what the function could not hand out at all is missing from the
  // player AND from the map. Without this sentence the page would claim to
  // show the whole trip.
  const SKIPPED_SENTENCE = '2 Momente liessen sich gerade nicht laden. Schau später nochmal rein.';

  test('skipped moments are named on the map', async () => {
    mockResolveToken.mockResolvedValueOnce(success([q1, q2, q3], {}, 2));
    await ready();
    await fireEvent.press(await screen.findByText('Auf der Karte'));
    expect(screen.getByTestId('teilen-ausgelassen')).toBeTruthy();
    expect(screen.getByText(SKIPPED_SENTENCE)).toBeTruthy();
  });

  // "Das war der Recap" is the second place where an incomplete reel has to
  // say so: there the page claims to have shown everything.
  test('skipped moments stand in the closing titles too', async () => {
    mockResolveToken.mockResolvedValueOnce(success([q1, q2, q3], {}, 2));
    await ready();
    for (let i = 0; i < 3; i++) {
      await fireEvent(screen.getByTestId('teilen-rechts'), 'pressIn');
      await fireEvent(screen.getByTestId('teilen-rechts'), 'pressOut');
    }
    expect(screen.getByTestId('teilen-ende')).toBeTruthy();
    expect(screen.getByText(SKIPPED_SENTENCE)).toBeTruthy();
  });

  test('with nothing skipped, nothing claims the opposite', async () => {
    await onTheMap();
    expect(screen.queryByTestId('teilen-ausgelassen')).toBeNull();
    expect(screen.queryByText(/liessen sich gerade nicht laden/)).toBeNull();
  });

  test('a tap on a cluster that can still be split flies into it instead of opening a sheet', async () => {
    // Two moments that fall together on THIS viewport (about 20 metres apart,
    // the map shows a good 4 kilometres), but do not lie on the same
    // coordinate.
    const g1 = moment({
      post_id: 'g1', captured_at: '2026-08-10T09:00:00.000Z', place_name: 'Alfama',
      lat: 38.7139, lng: -9.1301,
    });
    const g2 = moment({
      post_id: 'g2', captured_at: '2026-08-10T10:00:00.000Z', place_name: 'Alfama',
      lat: 38.71408, lng: -9.1301,
    });
    const g3 = moment({
      post_id: 'g3', captured_at: '2026-08-10T11:00:00.000Z', place_name: 'Belém',
      lat: 38.7, lng: -9.2,
    });
    await onTheMap([g1, g2, g3]);
    expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(2);

    await fireEvent.press(screen.getByTestId('karte-nadel-g1'));
    // No sheet, the map flies into it (spec §5.5), and reports that with
    // selection haptics (DESIGN-LANGUAGE §5).
    expect(screen.queryByText('Ab hier ansehen')).toBeNull();
    expect(screen.queryByTestId('teilen-gruppe-liste')).toBeNull();
    expect(mockHaptics).toHaveBeenCalledTimes(1);
  });
});

describe('A single moment that fails to load (deliberately WITHOUT the silent retry of the native player)', () => {
  test('a photo that does not load shows the hint pill IMMEDIATELY after the FIRST error', async () => {
    mockResolveToken.mockResolvedValueOnce(success([p1]));
    await ready();
    await fireEvent(screen.getByTestId('teilen-foto'), 'error');
    expect(screen.getByText('Dieses Foto lässt sich gerade nicht laden.')).toBeTruthy();
  });

  test('a video that does not load shows the hint pill IMMEDIATELY after the FIRST error', async () => {
    mockResolveToken.mockResolvedValueOnce(success([p2]));
    await ready();
    await act(async () => {
      for (const cb of mockListeners.statusChange ?? []) cb({ status: 'error' });
    });
    expect(screen.getByText('Dieses Video lässt sich gerade nicht laden.')).toBeTruthy();
  });
});
