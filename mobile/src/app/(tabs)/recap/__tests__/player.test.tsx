import { Alert, Animated, PanResponder, StyleSheet } from 'react-native';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

type AlertButton = { text?: string; style?: string; onPress?: () => void };
const mockAlertSpy = jest.fn();
jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => mockAlertSpy(...args));

// Jest modern fake timers fake Date.now() too, which is exactly what
// player.tsx needs for its hold-versus-tap decision.
jest.useFakeTimers();

// The real hook (useReducedMotion.ts) always starts at `false` and only
// flips ASYNCHRONOUSLY once AccessibilityInfo.isReduceMotionEnabled()
// answers. A synchronously mocked hook cannot tell an effect with `[]` deps
// (the original bug) from one that correctly depends on `[reducedMotion]`:
// both already see the final value on the very first render. This mock
// reproduces the real timing instead.
//
// One shared resolver is not enough: every PressScale instance in the tree
// (buttons, links, every emoji pill, ...) calls the hook as well and gets
// its own promise on mount. A single `let` resolver would be overwritten by
// the last instance mounted, so all pending resolvers collect in a Set and
// are resolved together.
const mockReducedMotionResolver = new Set<(value: boolean) => void>();
jest.mock('@/theme/useReducedMotion', () => {
  const ReactActual = require('react');
  return {
    useReducedMotion: () => {
      const [value, setValue] = ReactActual.useState(false);
      ReactActual.useEffect(() => {
        let alive = true;
        const promise = new Promise((resolve: (value: boolean) => void) => {
          mockReducedMotionResolver.add(resolve);
        });
        void promise.then((enabled: boolean) => {
          if (alive) setValue(enabled);
        });
        return () => {
          alive = false;
        };
      }, []);
      return value;
    },
  };
});
// Must be called inside act(): the .then handlers trigger a real setState.
function resolveMockReducedMotion(value: boolean) {
  for (const resolve of mockReducedMotionResolver) resolve(value);
  mockReducedMotionResolver.clear();
}

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = true;
let mockParams: { id: string; start?: string } = { id: 't1' };
// Real effect semantics instead of `(cb) => cb()`: that trap has already
// cost this project time three times.
jest.mock('expo-router', () => {
  const ReactActual = require('react');
  return {
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: () => mockCanGoBack }),
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void | (() => void)) => ReactActual.useEffect(cb, [cb]),
  };
});

jest.mock('expo-status-bar', () => ({ setStatusBarStyle: jest.fn() }));

const mockPrefetch = jest.fn();
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  const Image = (props: Record<string, unknown>) => ReactActual.createElement(View, props);
  Image.prefetch = (...args: unknown[]) => mockPrefetch(...args);
  return { Image };
});

// `mockListeners` is cleared when the SOURCE changes (expo-video creates a
// fresh player with fresh listeners then), not on every call, otherwise a
// plain re-render without a URL change would silently drop listeners that
// were already registered. `setup` hangs off the same condition: expo-video
// runs it only when it really creates a player, and it calls `p.play()`
// (see VideoMoment in player.tsx), so firing it on every render would make
// `play.mock.calls.length` useless as a signal.
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

jest.mock('@/features/trips/tripsApi', () => ({ fetchTrip: jest.fn() }));
jest.mock('@/features/recap/recapApi', () => ({ fetchRecapMoments: jest.fn() }));
// The requireActual below pulls urlPool.ts in for real, which transitively
// loads @/lib/supabase and with it AsyncStorage, absent from this Jest
// setup (same pattern as urlPool.test.ts itself).
jest.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
// isSoonExpiring / SOON_EXPIRING_THRESHOLD_MS stay real (pure functions),
// only the IO function getPool is mocked.
jest.mock('@/features/recap/urlPool', () => ({
  ...jest.requireActual('@/features/recap/urlPool'),
  getPool: jest.fn(),
}));
jest.mock('@/features/recap/socialApi', () => ({
  fetchReactions: jest.fn(),
  setReaction: jest.fn(),
  removeReaction: jest.fn(),
  fetchComments: jest.fn(),
  writeComment: jest.fn(),
  COMMENT_MAX_LENGTH: 500,
}));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ userId: 'u1' }) }));
const mockHaptics = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('expo-haptics', () => ({
  impactAsync: (...args: unknown[]) => mockHaptics(...args),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('@/features/recap/exportApi', () => ({ saveMomentToGallery: jest.fn() }));
const mockOpenSettings = jest.fn(() => Promise.resolve());
jest.mock('expo-linking', () => ({ openSettings: () => mockOpenSettings() }));

// REPORT_MAX_LENGTH stays real (a plain constant, exported for the input's
// maxLength prop), only the IO function is mocked.
jest.mock('@/features/recap/reportApi', () => ({
  ...jest.requireActual('@/features/recap/reportApi'),
  reportMoment: jest.fn(),
}));

// Same mock as overview.test.tsx (SealPeel has its own test file: skia,
// timers, haptics), so both screens are exercised against the exact same
// stand-in. Auto-peel defaults to true so every EXISTING test below keeps
// finding the player as before, without a seal in front of it; only the
// seal describe block below switches it off to look at the standing seal.
let mockSealAutoPeel = true;
jest.mock('@/components/SealPeel', () => {
  const ReactActual = require('react');
  const { Pressable } = require('react-native');
  return {
    SealPeel: ({ size, onPeeled, testID }: { size: number; onPeeled: () => void; testID?: string }) => {
      ReactActual.useEffect(() => {
        if (mockSealAutoPeel) onPeeled();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return ReactActual.createElement(Pressable, {
        testID, accessibilityRole: 'button', accessibilityLabel: 'Siegel abziehen',
        onPress: onPeeled, style: { width: size, height: size },
      });
    },
  };
});

import RecapPlayer from '../[id]/player';
import { fetchTrip } from '@/features/trips/tripsApi';
import { fetchRecapMoments } from '@/features/recap/recapApi';
import { getPool } from '@/features/recap/urlPool';
import {
  fetchReactions, setReaction, removeReaction, fetchComments, writeComment,
} from '@/features/recap/socialApi';
import type { RecapMoment } from '@/features/recap/types';
import { saveMomentToGallery } from '@/features/recap/exportApi';
import { reportMoment } from '@/features/recap/reportApi';

const trip = {
  id: 't1', name: 'Lissabon Städtetrip', start_date: '2026-08-10', end_date: '2026-08-14',
  status: 'revealed' as const, owner_id: 'u1',
  member_names: ['Lea', 'Jonas'], member_count: 2, my_post_count: 5,
};

function moment(overrides: Partial<RecapMoment>): RecapMoment {
  return {
    id: 'p0', trip_id: 't1', author_id: 'u1', type: 'photo', duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Zurich', place_name: 'Lissabon',
    lat: null, lng: null,
    upload_status: 'uploaded', authorName: 'Lea', authorAvatarKey: null,
    ...overrides,
  };
}

// Day 1 (Aug 10): p1 (photo, 09:00), p2 (video, 10:00, duration_s=3), p3
// (photo, 11:00). Day 2 (Aug 11, no place_name): p4 (photo, 09:00, the last
// loadable moment). p5 is a straggler (upload_status='pending').
const p1 = moment({ id: 'p1', captured_at: '2026-08-10T09:00:00.000Z' });
const p2 = moment({
  id: 'p2', type: 'video', duration_s: 3, caption: 'Schön hier',
  captured_at: '2026-08-10T10:00:00.000Z',
});
const p3 = moment({ id: 'p3', captured_at: '2026-08-10T11:00:00.000Z' });
const p4 = moment({ id: 'p4', captured_at: '2026-08-11T09:00:00.000Z', place_name: null });
const pendingMoment = moment({ id: 'p5', captured_at: '2026-08-11T10:00:00.000Z', upload_status: 'pending' });
const MOMENTS = [p1, p2, p3, p4, pendingMoment];

function image(id: string) {
  return { post_id: id, medium_url: `https://cdn.example/${id}-medium.jpg`, thumb_url: `https://cdn.example/${id}-thumb.jpg` };
}
const POOL_OK = {
  urls: new Map([['p1', image('p1')], ['p2', image('p2')], ['p3', image('p3')], ['p4', image('p4')]]),
  validUntil: Date.now() + 999_999,
  skipped: 0,
};

async function wrap() {
  const utils = await render(<RecapPlayer />);
  // Let the three parallel load calls (Promise.all) settle.
  await act(async () => {});
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockListeners)) delete mockListeners[key];
  mockLastSource = undefined;
  mockCanGoBack = true;
  mockParams = { id: 't1' };
  (fetchTrip as jest.Mock).mockResolvedValue({ data: trip, error: null });
  // Defaults for the many tests that do not care: every run that reaches the
  // ready phase kicks off the reactions and comments load effects, and a
  // stray long press could reach reportMoment.
  (fetchReactions as jest.Mock).mockResolvedValue({ data: {}, error: null });
  (fetchComments as jest.Mock).mockResolvedValue({ data: [], error: null });
  (reportMoment as jest.Mock).mockResolvedValue({ error: null });
});

describe('loading and edge cases', () => {
  test('a trip without a single loadable moment shows its own text instead of an empty player', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
    (getPool as jest.Mock).mockResolvedValue({
      pool: { urls: new Map(), validUntil: Date.now() + 999_999, skipped: 0 },
      error: null,
      reason: null,
    });
    await wrap();
    expect(screen.getByText('Diese Reise ist leer geblieben.')).toBeTruthy();
    expect(screen.queryByTestId('player-left')).toBeNull();
    expect(screen.queryByTestId('player-right')).toBeNull();
  });

  test('a straggler alone leaves nothing to play, so the player shows the empty text', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [pendingMoment], error: null });
    (getPool as jest.Mock).mockResolvedValue({
      pool: { urls: new Map(), validUntil: Date.now() + 999_999, skipped: 0 },
      error: null,
      reason: null,
    });
    await wrap();
    expect(screen.getByText('Diese Reise ist leer geblieben.')).toBeTruthy();
    expect(screen.queryByTestId('player-left')).toBeNull();
  });

  test('a load error shows the cause with a retry instead of an empty player', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue({ data: null, error: null });
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: null, error: null, reason: null });
    await wrap();
    expect(screen.getByText('Diese Reise gibt es nicht mehr.')).toBeTruthy();
    expect(screen.queryByTestId('player-left')).toBeNull();
  });
});

describe('start index (contract 2)', () => {
  test('without a start param the player opens at the first moment', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p1').medium_url });
  });

  test('a valid start param opens the matching moment right away', async () => {
    mockParams = { id: 't1', start: '2' }; // p3
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p3').medium_url });
  });

  test.each([['non-numeric', 'abc'], ['negative', '-1'], ['out of range', '999'], ['non-integer', '2.5']])(
    'a %s start param (%s) falls back to the first moment',
    async (_label, raw) => {
      mockParams = { id: 't1', start: raw };
      (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
      (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
      await wrap();
      expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p1').medium_url });
    }
  );

  test('a missing start param falls back to the first moment', async () => {
    mockParams = { id: 't1' };
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p1').medium_url });
  });

  // The playlist holds exactly four entries here (p1..p4), so start='4'
  // sits exactly on the boundary.
  test('a start param exactly at the playlist length falls back to the first moment', async () => {
    mockParams = { id: 't1', start: '4' };
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p1').medium_url });
  });
});

describe('header and caption pills (step 3)', () => {
  test('shows the author name, the avatar initial and place plus time in one pill', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    // p1: captured_at 09:00 UTC, captured_tz Europe/Zurich (CEST, UTC+2 in
    // August) -> 11:00 local time, place_name 'Lissabon'.
    expect(screen.getByText('Lea')).toBeTruthy();
    expect(screen.getByText('L')).toBeTruthy(); // avatar initial
    expect(screen.getByText('Lissabon · 11:00')).toBeTruthy();
  });

  test('a moment with an avatar key really renders an image, not just the initial', async () => {
    const p1WithImage = moment({ id: 'p1', authorAvatarKey: 'profiles/u1/a.jpg' });
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [p1WithImage], error: null });
    (getPool as jest.Mock).mockResolvedValue({
      pool: { urls: new Map([['p1', image('p1')]]), validUntil: Date.now() + 999_999, skipped: 0 },
      error: null,
      reason: null,
    });
    await wrap();
    expect(await screen.findByTestId('avatar-image')).toBeTruthy();
  });

  test('the time comes from captured_tz OF THE MOMENT, not from the device clock', async () => {
    const p1Tokyo = moment({ id: 'p1', captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Asia/Tokyo' });
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [p1Tokyo], error: null });
    (getPool as jest.Mock).mockResolvedValue({
      pool: { urls: new Map([['p1', image('p1')]]), validUntil: Date.now() + 999_999, skipped: 0 },
      error: null,
      reason: null,
    });
    await wrap();
    // 09:00 UTC is 18:00 in Asia/Tokyo (UTC+9), NOT 09:00.
    expect(screen.getByText('Lissabon · 18:00')).toBeTruthy();
    expect(screen.queryByText('Lissabon · 09:00')).toBeNull();
  });

  // A zone name the device does not know makes Intl throw a RangeError. A
  // best-effort device time beats an empty pill or a crashing recap.
  test('an unknown capture time zone falls back to device time instead of tearing the pill down', async () => {
    const capturedAt = '2026-08-10T09:00:00.000Z';
    const p1Nowhere = moment({ id: 'p1', captured_at: capturedAt, captured_tz: 'Mond/Krater' });
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [p1Nowhere], error: null });
    (getPool as jest.Mock).mockResolvedValue({
      pool: { urls: new Map([['p1', image('p1')]]), validUntil: Date.now() + 999_999, skipped: 0 },
      error: null,
      reason: null,
    });
    await wrap();
    const d = new Date(capturedAt);
    const deviceTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    expect(screen.getByText(`Lissabon · ${deviceTime}`)).toBeTruthy();
  });

  test('an existing caption appears as its own pill', async () => {
    mockParams = { id: 't1', start: '1' }; // p2 carries the caption 'Schön hier'
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(screen.getByTestId('player-caption')).toBeTruthy();
    expect(screen.getByText('Schön hier')).toBeTruthy();
  });

  test('without a caption no caption pill appears', async () => {
    // p1 (start=0) has caption: null.
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(screen.queryByTestId('player-caption')).toBeNull();
  });
});

describe('state machine across the screen', () => {
  test('a tap on the right half advances to the next moment', async () => {
    mockParams = { id: 't1', start: '1' }; // p2 (video), no day change to p3
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(screen.getByTestId('player-video')).toBeTruthy();
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p3').medium_url });
  });

  test('a tap on the left half at the first moment stays at the first moment', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-interstitial')); // day 1 interstitial gone
    await fireEvent(screen.getByTestId('player-left'), 'pressIn');
    await fireEvent(screen.getByTestId('player-left'), 'pressOut');
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p1').medium_url });
  });

  test('once the photo duration is up the player advances on its own', async () => {
    mockParams = { id: 't1', start: '2' }; // p3
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p3').medium_url });
    await act(async () => {
      jest.advanceTimersByTime(5000); // PHOTO_DURATION_MS
    });
    // p3 -> p4 is a day change, so the day 2 interstitial has to be there.
    expect(screen.getByTestId('player-interstitial')).toBeTruthy();
    expect(screen.getByText('Tag 2')).toBeTruthy();
    expect(screen.getByText('11. August')).toBeTruthy();
  });

  test('advancing past the last moment reaches the end screen, not an empty state', async () => {
    mockParams = { id: 't1', start: '3' }; // p4, the last loadable moment
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-interstitial')); // day 2 interstitial gone
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    expect(screen.getByTestId('player-end')).toBeTruthy();
    expect(screen.getByText('Das war der Recap.')).toBeTruthy();
    expect(screen.getByText('1 Moment ist noch unterwegs.')).toBeTruthy();
  });

  test('holding pauses the auto advance, releasing after a hold resumes instead of navigating', async () => {
    mockParams = { id: 't1', start: '2' }; // p3
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p3').medium_url });
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p3').medium_url });
  });

  test('a short tap navigates while a long press only holds', async () => {
    mockParams = { id: 't1', start: '2' }; // p3
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut'); // released at once: a tap
    expect(screen.getByTestId('player-interstitial')).toBeTruthy(); // p3 -> p4, day change
  });
});

describe('day interstitial', () => {
  test('the interstitial card stages day number above place and date', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(await screen.findByTestId('player-interstitial')).toBeTruthy();
    expect(screen.getByText('Tag 1')).toBeTruthy();
    expect(screen.getByText('Lissabon · 10. August')).toBeTruthy();
    // The old single line must be gone, not merely joined differently.
    expect(screen.queryByText('Tag 1 · Lissabon · 10. August')).toBeNull();
  });

  test('without a place the card carries day number and date alone', async () => {
    mockParams = { id: 't1', start: '2' }; // p3, one tap right crosses into day 2 (p4, no place_name)
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    expect(await screen.findByTestId('player-interstitial')).toBeTruthy();
    expect(screen.getByText('Tag 2')).toBeTruthy();
    expect(screen.getByText('11. August')).toBeTruthy();
  });

  test('appears before the very first moment and disappears on its own after 1.5 seconds', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(screen.getByTestId('player-interstitial')).toBeTruthy();
    expect(screen.getByText('Tag 1')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(screen.queryByTestId('player-interstitial')).toBeNull();
    // The normal auto advance runs on from HERE (not from the mount): p1
    // moves to p2 one photo duration later.
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('player-video')).toBeTruthy();
  });

  test('the day interstitial does NOT disappear before the full 1.5 seconds are up', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(screen.getByTestId('player-interstitial')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1499);
    });
    expect(screen.getByTestId('player-interstitial')).toBeTruthy();
  });

  test('a tap during the day interstitial skips ONLY the interstitial, without advancing as well', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-interstitial'));
    expect(screen.queryByTestId('player-interstitial')).toBeNull();
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p1').medium_url });
  });

  // fireEvent.press knows nothing about geometry or stacking, so the
  // explicit zIndex is what has to be asserted here.
  test('the day interstitial sits above the tap zones by zIndex, independent of tree order', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    const card = StyleSheet.flatten(screen.getByTestId('player-interstitial').props.style);
    const left = StyleSheet.flatten(screen.getByTestId('player-left').props.style);
    const right = StyleSheet.flatten(screen.getByTestId('player-right').props.style);
    expect(card.zIndex).toBeGreaterThan(left.zIndex ?? 0);
    expect(card.zIndex).toBeGreaterThan(right.zIndex ?? 0);
  });

  // The interstitial covers the whole screen opaquely, so without an even
  // higher zIndex the close pill would be unreachable for its 1.5 s.
  test('the close pill stays usable WHILE the day interstitial is up', async () => {
    // Jump mode (Task 4): show mode's close() always replaces to the
    // overview, which is not what this test is about. start='0' keeps the
    // same p1 with its interstitial (day change at index 0 regardless of
    // mode) while testing the ordinary back() path.
    mockParams = { id: 't1', start: '0' };
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(screen.getByTestId('player-interstitial')).toBeTruthy();
    const closePill = StyleSheet.flatten(screen.getByTestId('player-close').props.style);
    const card = StyleSheet.flatten(screen.getByTestId('player-interstitial').props.style);
    expect(closePill.zIndex).toBeGreaterThan(card.zIndex ?? 0);
    await fireEvent.press(screen.getByTestId('player-close'));
    expect(mockBack).toHaveBeenCalled();
  });

  test('a video under the day interstitial is really paused and does not get lost', async () => {
    // p2v: a day 2 video whose duration sits just below the interstitial's
    // own 1.5 s.
    const p2v = moment({
      id: 'p2v', type: 'video', duration_s: 1, captured_at: '2026-08-11T09:00:00.000Z', place_name: null,
    });
    mockParams = { id: 't1', start: '2' }; // p3 (day 1, the last moment before the day change)
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [p1, p2, p3, p2v], error: null });
    (getPool as jest.Mock).mockResolvedValue({
      pool: {
        urls: new Map([['p1', image('p1')], ['p2', image('p2')], ['p3', image('p3')], ['p2v', image('p2v')]]),
        validUntil: Date.now() + 999_999,
        skipped: 0,
      },
      error: null,
      reason: null,
    });
    await wrap();
    // p3 -> p2v: a day change, the day 2 interstitial appears BEFORE the video.
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    expect(screen.getByTestId('player-interstitial')).toBeTruthy();
    expect(screen.getByTestId('player-video')).toBeTruthy();
    expect(mockVideoPlayer.pause).toHaveBeenCalled();

    // Even after durationFor(p2v) = 1000 ms AND playToEnd, the moment stays
    // put while the interstitial is still standing (1.5 s > 1 s).
    await act(async () => {
      jest.advanceTimersByTime(1000);
      mockListeners.playToEnd?.forEach((cb) => cb());
    });
    expect(screen.getByTestId('player-interstitial')).toBeTruthy();
    expect(screen.getByTestId('player-video')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(500); // 1500 ms in total since the day change
    });
    expect(screen.queryByTestId('player-interstitial')).toBeNull();
    expect(screen.getByTestId('player-video')).toBeTruthy();
    await act(async () => {
      mockListeners.playToEnd?.forEach((cb) => cb());
    });
    expect(screen.queryByTestId('player-video')).toBeNull(); // last moment reached, end screen
    expect(screen.getByTestId('player-end')).toBeTruthy();
  });

  // Skipping the interstitial by tap leaves its timer orphaned: the deps of
  // that effect do not change, so there is no cleanup and no rerun, and the
  // timer still fires later, when the player may be paused for a completely
  // different reason.
  test('skipping the interstitial and then opening the comment sheet keeps the player paused when the orphaned timer fires', async () => {
    const p2v = moment({
      id: 'p2v', type: 'video', duration_s: 3, captured_at: '2026-08-11T09:00:00.000Z', place_name: null,
    });
    mockParams = { id: 't1', start: '2' }; // p3 (day 1, the last moment before the day change)
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [p1, p2, p3, p2v], error: null });
    (getPool as jest.Mock).mockResolvedValue({
      pool: {
        urls: new Map([['p1', image('p1')], ['p2', image('p2')], ['p3', image('p3')], ['p2v', image('p2v')]]),
        validUntil: Date.now() + 999_999,
        skipped: 0,
      },
      error: null,
      reason: null,
    });
    await wrap();
    // Step 1: the day change shows the day 2 interstitial and starts its
    // 1.5 s timer T (t=0 from here on).
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    expect(screen.getByTestId('player-interstitial')).toBeTruthy();

    // Step 2: tap the interstitial at t=200 ms (skip). T lives on, orphaned.
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    await fireEvent.press(screen.getByTestId('player-interstitial'));
    expect(screen.queryByTestId('player-interstitial')).toBeNull();

    // Step 3: at t=400 ms open the comment sheet, which really pauses the
    // video (player.pause()).
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    await fireEvent.press(screen.getByTestId('player-comments-open'));
    expect(screen.getByTestId('comment-input')).toBeTruthy(); // sheet is open
    const playCallsOnOpen = mockVideoPlayer.play.mock.calls.length;
    const pauseCallsOnOpen = mockVideoPlayer.pause.mock.calls.length;

    // Step 4: at t=1500 ms in total the orphaned timer T fires. It may only
    // take back its own pause reason, never the one the sheet set.
    await act(async () => {
      jest.advanceTimersByTime(1100); // 200 + 200 + 1100 = 1500
    });

    expect(mockVideoPlayer.play.mock.calls.length).toBe(playCallsOnOpen);
    expect(mockVideoPlayer.pause.mock.calls.length).toBe(pauseCallsOnOpen);
    expect(screen.getByTestId('comment-input')).toBeTruthy(); // sheet still open
  });
});

describe('video moments', () => {
  test('a video advances on the playToEnd event, not only after the fallback timer', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, duration_s=3 -> fallback timer at 3000 ms
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(screen.getByTestId('player-video')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(500); // well before the fallback's 3000 ms
      mockListeners.playToEnd?.forEach((cb) => cb());
    });
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p3').medium_url });
  });

  test('holding pauses the actual video playback as well, releasing resumes it', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, video
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(mockVideoPlayer.pause).not.toHaveBeenCalled();

    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    expect(mockVideoPlayer.pause).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(400); // long enough for a hold, too long for a tap
    });
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    // play() already ran once when the player was created (setup), the
    // SECOND call is the resume.
    expect(mockVideoPlayer.play.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('a playToEnd during a hold gesture still leaves the next moment running, not stuck', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, video
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-right'), 'pressIn'); // hold
    await act(async () => {
      mockListeners.playToEnd?.forEach((cb) => cb());
    });
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p3').medium_url });
    await act(async () => {
      jest.advanceTimersByTime(5000); // PHOTO_DURATION_MS
    });
    expect(screen.getByTestId('player-interstitial')).toBeTruthy(); // p3 -> p4, day change
  });

  test('a video that fails to load shows the thumbnail and a hint after one silent retry, and stays tappable', async () => {
    mockParams = { id: 't1', start: '1' }; // p2
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();

    // First failure: a SILENT retry, no hint text yet.
    await act(async () => {
      mockListeners.statusChange?.forEach((cb) => cb({ status: 'error' }));
    });
    await act(async () => {});
    expect(getPool).toHaveBeenCalledTimes(2); // 1x initial load, 1x retry
    expect(screen.queryByText('Dieses Video lässt sich gerade nicht laden.')).toBeNull();

    // Second failure on the same moment: the one retry is used up, now the
    // hint appears.
    await act(async () => {
      mockListeners.statusChange?.forEach((cb) => cb({ status: 'error' }));
    });
    expect(screen.getByText('Dieses Video lässt sich gerade nicht laden.')).toBeTruthy();
    expect(getPool).toHaveBeenCalledTimes(2); // no third, invisible attempt

    // The recap does not break off, tapping onwards keeps working.
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p3').medium_url });
  });

  // The same treatment as for a video, symmetrically for a photo (V10: a broken
  // URL must never end the recap).
  test('a photo that fails twice keeps its thumbnail, says so, and stays tappable', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();

    // First failure: a SILENT retry, no hint text yet.
    await act(async () => {
      screen.getByTestId('player-photo').props.onError();
    });
    await act(async () => {});
    expect(screen.queryByText('Dieses Foto lässt sich gerade nicht laden.')).toBeNull();

    // Second failure on the same moment: the retry is used up, the hint appears
    // over the thumbnail, and the photo view itself is gone.
    await act(async () => {
      screen.getByTestId('player-photo').props.onError();
    });
    expect(screen.getByText('Dieses Foto lässt sich gerade nicht laden.')).toBeTruthy();
    expect(screen.queryByTestId('player-photo')).toBeNull();

    // The recap does not break off, tapping onwards keeps working.
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    expect(screen.getByTestId('player-video')).toBeTruthy();
  });

  test('a fresh load resets the failure state, so the same moment gets another silent retry', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, video
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    const { rerender } = await render(<RecapPlayer />);
    await act(async () => {});
    await act(async () => {
      mockListeners.statusChange?.forEach((cb) => cb({ status: 'error' }));
    });
    await act(async () => {});
    await act(async () => {
      mockListeners.statusChange?.forEach((cb) => cb({ status: 'error' }));
    });
    expect(screen.getByText('Dieses Video lässt sich gerade nicht laden.')).toBeTruthy();

    // A fresh load: the trip id changes on the same component instance.
    mockParams = { id: 't2', start: '1' };
    await rerender(<RecapPlayer />);
    await act(async () => {});
    expect(screen.queryByText('Dieses Video lässt sich gerade nicht laden.')).toBeNull();
  });

  // p2's playToEnd callback is captured BEFORE advancing: the registration
  // is replaced on the moment change (a fresh video instance for p3), but
  // the callback object itself stays valid and stands in for an event that
  // arrives from native only after the commit to the next moment.
  test('a late playToEnd for a moment already left behind does NOT advance a second time', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, video
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    const p2EndCallback = mockListeners.playToEnd[0];
    expect(p2EndCallback).toBeTruthy();

    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut'); // p2 -> p3
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p3').medium_url });

    // The late event from p2 arrives now.
    await act(async () => {
      p2EndCallback();
    });
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p3').medium_url });
  });

  test('a late retry answer for a moment left behind does not override the pause of the new moment', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, video
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    let resolveRetry: (v: unknown) => void = () => {};
    (getPool as jest.Mock)
      .mockResolvedValueOnce({ pool: POOL_OK, error: null, reason: null }) // initial load
      .mockReturnValueOnce(new Promise((resolve) => { resolveRetry = resolve; })); // the retry hangs
    await wrap();
    await act(async () => {
      mockListeners.statusChange?.forEach((cb) => cb({ status: 'error' })); // triggers the hanging retry for p2
    });
    // Meanwhile the viewer taps onwards ...
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut'); // -> p3
    // ... and now holds on the NEW moment.
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    // The late answer for p2 arrives now.
    await act(async () => {
      resolveRetry({ pool: POOL_OK });
    });
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p3').medium_url });
  });

  // Unlike the test above this one only taps onwards and never holds again,
  // so it demands the actual restart: the auto advance has to leave the new
  // moment after its photo duration.
  test('a late retry answer does NOT block the new moment forever, the auto advance keeps running', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, video
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    let resolveRetry: (v: unknown) => void = () => {};
    (getPool as jest.Mock)
      .mockResolvedValueOnce({ pool: POOL_OK, error: null, reason: null }) // initial load
      .mockReturnValueOnce(new Promise((resolve) => { resolveRetry = resolve; })); // the retry hangs
    await wrap();
    await act(async () => {
      mockListeners.statusChange?.forEach((cb) => cb({ status: 'error' })); // triggers the hanging retry for p2
    });
    // The viewer taps onwards without holding afterwards -> p3.
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p3').medium_url });

    // The late answer for p2 arrives now.
    await act(async () => {
      resolveRetry({ pool: POOL_OK });
    });

    // p3 -> p4 crosses a day change, so the day 2 interstitial covers p4,
    // but p4's photo is already mounted and carries its source: that is the
    // proof that the auto advance fired at all.
    await act(async () => {
      jest.advanceTimersByTime(5000); // PHOTO_DURATION_MS
    });
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p4').medium_url });
  });
});

function imageRenewed(id: string) {
  return {
    post_id: id,
    medium_url: `https://cdn.example/${id}-medium-renewed.jpg`,
    thumb_url: `https://cdn.example/${id}-thumb-renewed.jpg`,
  };
}
const POOL_RENEWED = {
  urls: new Map([['p1', imageRenewed('p1')], ['p2', imageRenewed('p2')], ['p3', imageRenewed('p3')], ['p4', imageRenewed('p4')]]),
  validUntil: Date.now() + 999_999,
  skipped: 0,
};

describe('pool renewal (V10)', () => {
  test('a pool that expires soon is renewed and the NEW urls really arrive on screen', async () => {
    mockParams = { id: 't1', start: '1' }; // p2 -> p3, no day change
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    const soonExpiring = { urls: POOL_OK.urls, validUntil: Date.now() + 60_000, skipped: 0 }; // < 5-Min-Schwelle
    (getPool as jest.Mock)
      .mockResolvedValueOnce({ pool: soonExpiring, error: null, reason: null })
      .mockResolvedValue({ pool: POOL_RENEWED, error: null, reason: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    await act(async () => {});
    expect(getPool).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: imageRenewed('p3').medium_url });
    expect(screen.queryByTestId('player-error')).toBeNull();
  });

  test('a pool with plenty of time left is NOT fetched again', async () => {
    mockParams = { id: 't1', start: '1' };
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    await act(async () => {});
    expect(getPool).toHaveBeenCalledTimes(1);
  });

  test('a tap to the left (going back) also triggers the renewal when the pool expires soon', async () => {
    mockParams = { id: 't1', start: '2' }; // p3
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    const soonExpiring = { urls: POOL_OK.urls, validUntil: Date.now() + 60_000, skipped: 0 };
    (getPool as jest.Mock)
      .mockResolvedValueOnce({ pool: soonExpiring, error: null, reason: null })
      .mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-left'), 'pressIn');
    await fireEvent(screen.getByTestId('player-left'), 'pressOut');
    await act(async () => {});
    expect(getPool).toHaveBeenCalledTimes(2);
  });

  test('two taps in quick succession trigger the renewal only ONCE while the first is still running', async () => {
    mockParams = { id: 't1', start: '0' };
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    const soonExpiring = { urls: POOL_OK.urls, validUntil: Date.now() + 60_000, skipped: 0 };
    let resolvePool: (v: unknown) => void = () => {};
    (getPool as jest.Mock)
      .mockResolvedValueOnce({ pool: soonExpiring, error: null, reason: null })
      .mockReturnValueOnce(new Promise((resolve) => { resolvePool = resolve; }));
    await wrap();
    await fireEvent.press(screen.getByTestId('player-interstitial'));
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut'); // triggers the hanging renewal
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut'); // second tap, renewal still running
    expect(getPool).toHaveBeenCalledTimes(2); // 1x initial load, ONLY 1x renewal
    await act(async () => {
      resolvePool({ pool: POOL_OK });
    });
  });
});

describe('preloading (V8)', () => {
  test('preloads the next three photos, a video in between does not count', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap(); // start=0 (p1) -> successors p2 (video), p3, p4 -> only p3/p4 are photos
    expect(mockPrefetch).toHaveBeenCalledWith([image('p3').medium_url, image('p4').medium_url]);
  });

  // Six photos follow the start here, so a preload count that is too
  // generous becomes visible at all (with only four moments, three and ten
  // yield the same slice).
  test('preloads NO more than the next three photos, even when more are available', async () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((letter, i) =>
      moment({ id: `f${letter}`, captured_at: `2026-08-10T0${i + 1}:00:00.000Z` })
    );
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: many, error: null });
    (getPool as jest.Mock).mockResolvedValue({
      pool: {
        urls: new Map(many.map((m) => [m.id, image(m.id)])),
        validUntil: Date.now() + 999_999,
        skipped: 0,
      },
      error: null,
      reason: null,
    });
    await wrap(); // start=0 (fa) -> successors fb..ff (5 photos) -> only the first THREE (fb,fc,fd)
    expect(mockPrefetch).toHaveBeenCalledWith([image('fb').medium_url, image('fc').medium_url, image('fd').medium_url]);
    expect(mockPrefetch).not.toHaveBeenCalledWith(
      expect.arrayContaining([image('fe').medium_url, image('ff').medium_url])
    );
  });
});

describe('stragglers and skipped moments on the end screen', () => {
  test('both the straggler row and the skipped row appear when both occur', async () => {
    const p6 = moment({ id: 'p6', captured_at: '2026-08-11T11:00:00.000Z' }); // uploaded, but without a pool url
    mockParams = { id: 't1', start: '3' };
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [...MOMENTS, p6], error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: { ...POOL_OK, skipped: 1 }, error: null, reason: null });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-interstitial'));
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    expect(screen.getByTestId('player-end')).toBeTruthy();
    expect(screen.getByText('1 Moment ist noch unterwegs.')).toBeTruthy();
    expect(screen.getByText('1 Moment liess sich gerade nicht laden. Schau später nochmal rein.')).toBeTruthy();
  });

  test('without stragglers and without skipped moments neither row appears', async () => {
    mockParams = { id: 't1', start: '2' }; // p3, the last moment of this day-1-only playlist
    const onlyDay1 = [p1, p2, p3];
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: onlyDay1, error: null });
    (getPool as jest.Mock).mockResolvedValue({
      pool: { urls: POOL_OK.urls, validUntil: Date.now() + 999_999, skipped: 0 },
      error: null,
      reason: null,
    });
    await wrap();
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    expect(screen.getByTestId('player-end')).toBeTruthy();
    expect(screen.queryByText(/unterwegs\.$/)).toBeNull();
    expect(screen.queryByText(/laden\. Schau später nochmal rein\.$/)).toBeNull();
  });
});

describe('closing the player', () => {
  // Both tests below run in jump mode (Task 4): show mode's close() always
  // replaces to the overview regardless of canGoBack(), which is exactly
  // the OTHER branch, covered separately above.
  test('the close button leaves the player via back() when there is a way back', async () => {
    mockParams = { id: 't1', start: '0' };
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-close'));
    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  test('without a way back in the stack the close button replaces to the recap list', async () => {
    mockParams = { id: 't1', start: '0' };
    mockCanGoBack = false;
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-close'));
    expect(mockReplace).toHaveBeenCalledWith('/recap');
    expect(mockBack).not.toHaveBeenCalled();
  });

  // RN Pressability fires onPressOut on a tap zone even when the
  // PanResponder has taken the touch over meanwhile (the start of a real
  // swipe), which is not a genuine release. The takeover is simulated
  // through `onPanResponderGrant` directly, because RNTL does not run real
  // geometry or hit testing on raw touch coordinates anyway.
  test('a touch taken over by the PanResponder triggers NO extra tap navigation', async () => {
    const createSpy = jest.spyOn(PanResponder, 'create');
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-interstitial')); // interstitial gone, tap zones free
    const config = createSpy.mock.calls[0][0];
    // The touch has to start on the tap zone: without this pressIn the
    // recorded touch start would stay at 0, the gesture would count as a
    // very long hold, and the test would go green by accident even without
    // the takeover guard.
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await act(async () => {
      config.onPanResponderGrant?.({} as never, {} as never); // the swipe takes the touch over
    });
    await fireEvent(screen.getByTestId('player-right'), 'pressOut'); // Pressability fires anyway
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p1').medium_url });
    createSpy.mockRestore();
  });

  test('after a new touch the tap navigation works normally again', async () => {
    const createSpy = jest.spyOn(PanResponder, 'create');
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-interstitial'));
    const config = createSpy.mock.calls[0][0];
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await act(async () => {
      config.onPanResponderGrant?.({} as never, {} as never);
    });
    await fireEvent(screen.getByTestId('player-right'), 'pressOut'); // swallowed by the swipe
    await fireEvent(screen.getByTestId('player-right'), 'pressIn'); // a new touch
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    // p1 -> p2, and p2 is a video (not 'player-photo').
    expect(screen.getByTestId('player-video')).toBeTruthy();
    createSpy.mockRestore();
  });

  // The release logic is asserted on the PanResponder config object
  // itself, without touch simulation: that is the only way to hit the
  // 120 px threshold precisely in RNTL.
  test('a swipe release closes from the threshold on and springs back below it', async () => {
    // Jump mode (Task 4): the swipe calls the same close() as the pill, so
    // show mode would replace to the overview here too. The threshold and
    // spring-back logic under test is independent of that branch.
    mockParams = { id: 't1', start: '0' };
    const createSpy = jest.spyOn(PanResponder, 'create');
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    const config = createSpy.mock.calls[0][0];
    await act(async () => {
      config.onPanResponderRelease?.({} as never, { dy: 121 } as never);
    });
    expect(mockBack).toHaveBeenCalled();
    mockBack.mockClear();
    await act(async () => {
      config.onPanResponderRelease?.({} as never, { dy: 50 } as never); // springs back
    });
    expect(mockBack).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });
});

// Task 4 of the recap-show plan: in show mode the end card is no longer a
// dead end with a button, it hands the show back to the overview by
// itself after a reading pause. Jump mode (a tile or the repeat pill FROM
// the overview) keeps today's button and back() unchanged.
describe('the show hands over to the overview', () => {
  test('the show ends by itself on the overview after the end card', async () => {
    mockParams = { id: 't1' }; // no start param: show mode
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();

    // Walk the whole reel: the day 1 interstitial (before p1), taps through
    // to p4 (POOL_OK carries four moments, p1..p4), the day 2 interstitial
    // (before p4, a day change), and a last tap past the end.
    await fireEvent.press(await screen.findByTestId('player-interstitial'));
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut'); // p1 -> p2
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut'); // p2 -> p3
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut'); // p3 -> p4, day change
    await fireEvent.press(screen.getByTestId('player-interstitial'));
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut'); // past p4, the end

    expect(await screen.findByTestId('player-end')).toBeTruthy();
    expect(screen.queryByText('Zurück zur Übersicht')).toBeNull();

    // In slices, not one large jump: the point under test is that NOTHING
    // happens before the full 2000 ms are up, which a single advance could
    // pass even against a shorter, unfixed timer.
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockReplace).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(999);
    });
    expect(mockReplace).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/recap/[id]/overview', params: { id: 't1' },
    });
  });

  test('a tap on the end card does not wait for the timer', async () => {
    mockParams = { id: 't1' };
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();

    await fireEvent.press(await screen.findByTestId('player-interstitial'));
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    await fireEvent.press(screen.getByTestId('player-interstitial'));
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');

    await fireEvent.press(await screen.findByTestId('player-end'));
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/recap/[id]/overview', params: { id: 't1' },
    });
  });

  test('leaving the show midway lands on the overview, not back in the tab', async () => {
    mockParams = { id: 't1' };
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-close'));
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/recap/[id]/overview', params: { id: 't1' },
    });
    expect(mockBack).not.toHaveBeenCalled();
  });

  test('after a jump from the overview the end card keeps its button and goes back', async () => {
    mockParams = { id: 't1', start: '0' }; // start=0 is a jump too (repeat from the overview)
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();

    await fireEvent.press(await screen.findByTestId('player-interstitial'));
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    await fireEvent.press(screen.getByTestId('player-interstitial'));
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');

    expect(await screen.findByTestId('player-end')).toBeTruthy();
    await fireEvent.press(screen.getByText('Zurück zur Übersicht'));
    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('cinema fade on entering ("the lights go down")', () => {
  test('animates from 1 to 0 over 350 ms', async () => {
    const timingSpy = jest.spyOn(Animated, 'timing');
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    const fadeCall = timingSpy.mock.calls.find(([, config]) => config.toValue === 0 && config.duration === 350);
    expect(fadeCall).toBeTruthy();
    timingSpy.mockRestore();
  });

  test('shortens to 200 ms once the hook reports reduced motion ONLY AFTER the mount', async () => {
    const timingSpy = jest.spyOn(Animated, 'timing');
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    // Right after the mount reducedMotion is still false (hook contract),
    // so only the normal 350 ms call has happened so far.
    expect(timingSpy.mock.calls.some(([, config]) => config.toValue === 0 && config.duration === 200)).toBe(false);
    resolveMockReducedMotion(true);
    await act(async () => {});
    const fadeCall = timingSpy.mock.calls.find(([, config]) => config.toValue === 0 && config.duration === 200);
    expect(fadeCall).toBeTruthy();
    timingSpy.mockRestore();
  });
});

// A controllable promise to stand in for "the answer has not arrived yet",
// so the optimistic update can be asserted without knowing the real timing.
function unresolved<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('reactions (Task 12)', () => {
  // Same approach as the day interstitial zIndex test: StyleSheet.flatten
  // on the real style props, no hit testing needed.
  test('the reaction and comment buttons sit above the tap zones by zIndex, independent of tree order', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    const social = StyleSheet.flatten(screen.getByTestId('player-social-area').props.style);
    const left = StyleSheet.flatten(screen.getByTestId('player-left').props.style);
    const right = StyleSheet.flatten(screen.getByTestId('player-right').props.style);
    expect(social.zIndex).toBeGreaterThan(left.zIndex ?? 0);
    expect(social.zIndex).toBeGreaterThan(right.zIndex ?? 0);
  });

  test('loads the reactions for ALL moments of the playlist in a single call', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(fetchReactions).toHaveBeenCalledTimes(1);
    expect(fetchReactions).toHaveBeenCalledWith(['p1', 'p2', 'p3', 'p4']);
  });

  test('a tap shows the reaction IMMEDIATELY, without waiting for the answer', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    const { promise, resolve } = unresolved<{ error: string | null }>();
    (setReaction as jest.Mock).mockReturnValue(promise); // deliberately NOT resolved

    await wrap();
    expect(screen.getByTestId('player-emoji-heart').props.accessibilityState.selected).toBe(false);

    await fireEvent.press(screen.getByTestId('player-emoji-heart'));
    // Without any wait on `promise`: the pill has to be active already.
    expect(screen.getByTestId('player-emoji-heart').props.accessibilityState.selected).toBe(true);
    expect(mockHaptics).toHaveBeenCalledWith('light');

    await act(async () => {
      resolve({ error: null });
    });
    expect(screen.getByTestId('player-emoji-heart').props.accessibilityState.selected).toBe(true);
  });

  test('when setting fails the reaction disappears again and the cause is shown', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    const { promise, resolve } = unresolved<{ error: string | null }>();
    (setReaction as jest.Mock).mockReturnValue(promise);

    await wrap();
    await fireEvent.press(screen.getByTestId('player-emoji-heart'));
    // Optimistic: already active BEFORE the answer arrives.
    expect(screen.getByTestId('player-emoji-heart').props.accessibilityState.selected).toBe(true);

    await act(async () => {
      resolve({ error: 'Deine Reaktion konnte nicht gespeichert werden. Probier es gleich nochmal.' });
    });
    expect(screen.getByTestId('player-emoji-heart').props.accessibilityState.selected).toBe(false);
    expect(
      screen.getByText('Deine Reaktion konnte nicht gespeichert werden. Probier es gleich nochmal.')
    ).toBeTruthy();
  });

  test('a quick double tap on the same emoji triggers only ONE request', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    const { promise, resolve } = unresolved<{ error: string | null }>();
    (setReaction as jest.Mock).mockReturnValue(promise);

    await wrap();
    const pill = screen.getByTestId('player-emoji-heart');
    // Two taps while the answer to the first is still outstanding. The
    // guard is purely synchronous, so it needs no real concurrency, only
    // both presses arriving before setReaction has answered.
    await fireEvent.press(pill);
    await fireEvent.press(pill);
    expect(setReaction).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ error: null });
    });
    expect(setReaction).toHaveBeenCalledTimes(1);
  });

  test('a second tap on a reaction of your own removes it again (toggle)', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    (fetchReactions as jest.Mock).mockResolvedValue({
      data: { p1: [{ post_id: 'p1', user_id: 'u1', emoji: '❤️' }] },
      error: null,
    });
    (removeReaction as jest.Mock).mockResolvedValue({ error: null });

    await wrap();
    expect(screen.getByTestId('player-emoji-heart').props.accessibilityState.selected).toBe(true);

    await fireEvent.press(screen.getByTestId('player-emoji-heart'));
    expect(screen.getByTestId('player-emoji-heart').props.accessibilityState.selected).toBe(false);
    expect(removeReaction).toHaveBeenCalledWith('p1', '❤️');
    expect(setReaction).not.toHaveBeenCalled();
  });

  test('when removing fails the reaction reappears', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    (fetchReactions as jest.Mock).mockResolvedValue({
      data: { p1: [{ post_id: 'p1', user_id: 'u1', emoji: '❤️' }] },
      error: null,
    });
    const { promise, resolve } = unresolved<{ error: string | null }>();
    (removeReaction as jest.Mock).mockReturnValue(promise);

    await wrap();
    await fireEvent.press(screen.getByTestId('player-emoji-heart'));
    // Optimistic: already inactive BEFORE the answer arrives.
    expect(screen.getByTestId('player-emoji-heart').props.accessibilityState.selected).toBe(false);

    await act(async () => {
      resolve({ error: 'Deine Reaktion konnte nicht entfernt werden. Probier es gleich nochmal.' });
    });
    expect(screen.getByTestId('player-emoji-heart').props.accessibilityState.selected).toBe(true);
    expect(
      screen.getByText('Deine Reaktion konnte nicht entfernt werden. Probier es gleich nochmal.')
    ).toBeTruthy();
  });

  test('reactions of other people appear quietly, only the emojis, no name, no counter', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    (fetchReactions as jest.Mock).mockResolvedValue({
      data: {
        p1: [
          { post_id: 'p1', user_id: 'u2', emoji: '😂' },
          { post_id: 'p1', user_id: 'u3', emoji: '😂' }, // deduplicated
          { post_id: 'p1', user_id: 'u2', emoji: '👏' },
        ],
      },
      error: null,
    });
    await wrap();
    expect(screen.getByTestId('player-reactions-others')).toBeTruthy();
    expect(screen.getByText('😂 👏')).toBeTruthy();
    expect(screen.queryByText('Jonas')).toBeNull();
  });

  test('no emoji row of the others is shown while only you have reacted', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    (fetchReactions as jest.Mock).mockResolvedValue({
      data: { p1: [{ post_id: 'p1', user_id: 'u1', emoji: '❤️' }] },
      error: null,
    });
    await wrap();
    expect(screen.queryByTestId('player-reactions-others')).toBeNull();
  });

  test('a reaction by someone else does NOT mark your own pill as active', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    (fetchReactions as jest.Mock).mockResolvedValue({
      data: { p1: [{ post_id: 'p1', user_id: 'u2', emoji: '😂' }] }, // Jonas, not me (u1)
      error: null,
    });
    (setReaction as jest.Mock).mockResolvedValue({ error: null });

    await wrap();
    expect(screen.getByTestId('player-emoji-laugh').props.accessibilityState.selected).toBe(false);

    // A tap on 😂 therefore has to SET, not remove Jonas' reaction.
    await fireEvent.press(screen.getByTestId('player-emoji-laugh'));
    expect(setReaction).toHaveBeenCalledWith('p1', '😂');
    expect(removeReaction).not.toHaveBeenCalled();
  });

  test('a reaction error for a moment left behind does NOT flash up on the now active moment', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, no day change to p3
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    const { promise, resolve } = unresolved<{ error: string | null }>();
    (setReaction as jest.Mock).mockReturnValue(promise);

    await wrap();
    await fireEvent.press(screen.getByTestId('player-emoji-heart')); // reacts on p2, hangs
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut'); // on to p3

    await act(async () => {
      resolve({ error: 'Deine Reaktion konnte nicht gespeichert werden. Probier es gleich nochmal.' });
    });
    expect(
      screen.queryByText('Deine Reaktion konnte nicht gespeichert werden. Probier es gleich nochmal.')
    ).toBeNull();
  });

  test('a load error of the reactions is shown instead of being swallowed', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    (fetchReactions as jest.Mock).mockResolvedValue({
      data: {},
      error: 'Die Reaktionen konnten nicht geladen werden. Probier es gleich nochmal.',
    });
    await wrap();
    expect(
      screen.getByText('Die Reaktionen konnten nicht geladen werden. Probier es gleich nochmal.')
    ).toBeTruthy();
  });

  test('a genuinely rejected promise (not just { error }) rolls back and frees the emoji again', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    (setReaction as jest.Mock).mockRejectedValueOnce(new Error('unexpected crash'));
    (setReaction as jest.Mock).mockResolvedValueOnce({ error: null });

    await wrap();
    // Deliberately without an intermediate assertion on the optimistic
    // state: an already REJECTED promise settles just as fast as an already
    // RESOLVED one, so the rollback has run by the time the awaited
    // fireEvent.press returns.
    await fireEvent.press(screen.getByTestId('player-emoji-heart'));

    await act(async () => {});
    expect(screen.getByTestId('player-emoji-heart').props.accessibilityState.selected).toBe(false);
    expect(
      screen.getByText('Deine Reaktion konnte nicht gespeichert werden. Probier es gleich nochmal.')
    ).toBeTruthy();

    await fireEvent.press(screen.getByTestId('player-emoji-heart'));
    expect(setReaction).toHaveBeenCalledTimes(2);
  });
});

describe('comment sheet (Task 12)', () => {
  test('opens the sheet, loads the comments of the active moment and pauses the player', async () => {
    mockParams = { id: 't1', start: '2' }; // p3
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    (fetchComments as jest.Mock).mockResolvedValue({
      data: [{ id: 'c1', post_id: 'p3', user_id: 'u2', text: 'Wow!', created_at: 't', authorName: 'Jonas' }],
      error: null,
    });
    await wrap();

    await fireEvent.press(screen.getByTestId('player-comments-open'));
    await act(async () => {});
    expect(fetchComments).toHaveBeenCalledWith('p3');
    expect(screen.getByText('Jonas')).toBeTruthy();
    expect(screen.getByText('Wow!')).toBeTruthy();

    // Paused: p3 stays put even after the full photo duration.
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p3').medium_url });

    // Closing (a tap on the sheet backdrop) takes the pause reason back.
    await fireEvent.press(screen.getByTestId('sheet-backdrop'));
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('player-interstitial')).toBeTruthy(); // p3 -> p4, day change
  });

  test('a hanging send for a moment left behind does not leave the send button of a new session stuck on sending', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    (fetchComments as jest.Mock).mockResolvedValue({ data: [], error: null });
    const { promise } = unresolved<{ error: string | null }>();
    (writeComment as jest.Mock).mockReturnValue(promise); // hangs for p1

    await wrap(); // start=0 -> p1
    await fireEvent.press(screen.getByTestId('player-interstitial')); // day 1 interstitial gone
    await fireEvent.press(screen.getByTestId('player-comments-open')); // opens for p1
    await act(async () => {});
    await fireEvent.changeText(screen.getByTestId('comment-input'), 'Hallo');
    await fireEvent.press(screen.getByTestId('comment-send')); // sending starts and hangs

    await fireEvent.press(screen.getByTestId('sheet-backdrop')); // close WITHOUT waiting for the answer
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut'); // on to p2
    await fireEvent.press(screen.getByTestId('player-comments-open')); // open again for p2
    await act(async () => {});

    expect(screen.getByText('Senden')).toBeTruthy();
  });

  test('a hanging send for the SAME moment still reads as sending when the sheet is reopened, so no double send is possible', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    (fetchComments as jest.Mock).mockResolvedValue({ data: [], error: null });
    const { promise } = unresolved<{ error: string | null }>();
    (writeComment as jest.Mock).mockReturnValue(promise); // hangs for p1

    await wrap(); // start=0 -> p1
    await fireEvent.press(screen.getByTestId('player-interstitial')); // day 1 interstitial gone
    await fireEvent.press(screen.getByTestId('player-comments-open')); // opens for p1
    await act(async () => {});
    await fireEvent.changeText(screen.getByTestId('comment-input'), 'Hallo');
    await fireEvent.press(screen.getByTestId('comment-send')); // sending starts and hangs
    expect(writeComment).toHaveBeenCalledTimes(1);

    // Close (the player stays on p1) and reopen at once: same moment, same
    // send still running.
    await fireEvent.press(screen.getByTestId('sheet-backdrop'));
    await fireEvent.press(screen.getByTestId('player-comments-open'));
    await act(async () => {});

    expect(screen.queryByText('Senden')).toBeNull();
    expect(
      screen.getByTestId('comment-send').props.accessibilityState.disabled
    ).toBe(true);
  });

  test('a video is paused as well while the sheet is open', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, video
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    const playCallsBefore = mockVideoPlayer.play.mock.calls.length;

    await fireEvent.press(screen.getByTestId('player-comments-open'));
    expect(mockVideoPlayer.pause).toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('sheet-backdrop'));
    expect(mockVideoPlayer.play.mock.calls.length).toBeGreaterThan(playCallsBefore);
  });

  // Opening the sheet sets the pause reason synchronously, but the real
  // player.pause() only commits on the next effect run: a playToEnd that
  // arrives exactly inside that window must not advance behind the sheet.
  test('a playToEnd arriving exactly as the sheet opens does not advance the player behind it', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, video
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    (fetchComments as jest.Mock).mockResolvedValue({ data: [], error: null });
    await wrap();
    expect(screen.getByTestId('player-video')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('player-comments-open'));
    // The race window: playToEnd fires while the sheet has just opened.
    await act(async () => {
      mockListeners.playToEnd?.forEach((cb) => cb());
    });
    expect(screen.getByTestId('player-video')).toBeTruthy();
    expect(screen.getByTestId('sheet-panel')).toBeTruthy();

    // The fallback timer does not advance either while the sheet stays open.
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('player-video')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('sheet-backdrop'));
    await act(async () => {
      jest.advanceTimersByTime(3000); // durationFor(p2) = duration_s (3) * 1000
    });
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p3').medium_url });
  });

  test('a late answer for a moment long left behind does not overwrite the comments of the NEW moment', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    const { promise: firstPromise, resolve: resolveFirst } =
      unresolved<{ data: unknown; error: string | null }>();
    (fetchComments as jest.Mock)
      .mockReturnValueOnce(firstPromise) // opening for p1, stays pending
      .mockResolvedValueOnce({
        data: [{ id: 'c2', post_id: 'p2', user_id: 'u2', text: 'Zweiter Moment', created_at: 't', authorName: 'Jonas' }],
        error: null,
      });

    await wrap(); // start=0 -> p1
    await fireEvent.press(screen.getByTestId('player-interstitial')); // day 1 interstitial gone
    await fireEvent.press(screen.getByTestId('player-comments-open')); // opens for p1, hangs
    await fireEvent.press(screen.getByTestId('sheet-backdrop')); // close, the request runs on

    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut'); // p1 -> p2
    await fireEvent.press(screen.getByTestId('player-comments-open')); // opens for p2
    await act(async () => {});
    expect(screen.getByText('Zweiter Moment')).toBeTruthy();

    // The long overdue answer for p1 only arrives now.
    await act(async () => {
      resolveFirst({ data: [{ id: 'c1', post_id: 'p1', user_id: 'u2', text: 'Erster Moment', created_at: 't', authorName: 'Jonas' }], error: null });
    });
    expect(screen.getByText('Zweiter Moment')).toBeTruthy();
    expect(screen.queryByText('Erster Moment')).toBeNull();
  });

  test('a comment that is too long is reported as an error and nothing is appended optimistically', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    (writeComment as jest.Mock).mockResolvedValue({
      error: 'Kommentare dürfen höchstens 500 Zeichen haben.',
    });

    await wrap();
    await fireEvent.press(screen.getByTestId('player-comments-open'));
    await act(async () => {});

    const tooLongText = 'a'.repeat(501);
    await fireEvent.changeText(screen.getByTestId('comment-input'), tooLongText);
    await fireEvent.press(screen.getByTestId('comment-send'));
    await act(async () => {});

    expect(writeComment).toHaveBeenCalledWith('p1', tooLongText);
    expect(screen.getByText('Kommentare dürfen höchstens 500 Zeichen haben.')).toBeTruthy();
    // No second fetchComments call (no reload after an error), the only one
    // is the call from opening the sheet.
    expect(fetchComments).toHaveBeenCalledTimes(1);
  });

  test('a successfully sent comment clears the field and reloads the list', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    (writeComment as jest.Mock).mockResolvedValue({ error: null });
    (fetchComments as jest.Mock)
      .mockResolvedValueOnce({ data: [], error: null }) // when opening
      .mockResolvedValueOnce({
        data: [{ id: 'c1', post_id: 'p1', user_id: 'u1', text: 'Toller Moment!', created_at: 't', authorName: 'Lea' }],
        error: null,
      });

    await wrap();
    await fireEvent.press(screen.getByTestId('player-comments-open'));
    await act(async () => {});

    await fireEvent.changeText(screen.getByTestId('comment-input'), 'Toller Moment!');
    await fireEvent.press(screen.getByTestId('comment-send'));
    await act(async () => {});

    expect(writeComment).toHaveBeenCalledWith('p1', 'Toller Moment!');
    expect(fetchComments).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('comment-input').props.value).toBe('');
    expect(screen.getByText('Toller Moment!')).toBeTruthy();
  });
});

describe('saving a moment to the photo library', () => {
  beforeEach(() => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  });

  test('calls saveMomentToGallery with the active moment and its MEDIUM url, not the thumbnail', async () => {
    (saveMomentToGallery as jest.Mock).mockResolvedValue({ ok: true });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-save'));
    await act(async () => {});
    expect(saveMomentToGallery).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }),
      expect.objectContaining({ medium_url: image('p1').medium_url, thumb_url: image('p1').thumb_url })
    );
  });

  test('success shows a short confirmation', async () => {
    (saveMomentToGallery as jest.Mock).mockResolvedValue({ ok: true });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-save'));
    await act(async () => {});
    expect(await screen.findByTestId('player-export-hint')).toHaveTextContent('In der Fotobibliothek gesichert.');
  });

  test('a missing permission shows an alert with a way into the settings, not a quiet pill', async () => {
    (saveMomentToGallery as jest.Mock).mockResolvedValue({
      ok: false, reason: 'no_permission', text: 'Reelive braucht Zugriff auf deine Fotobibliothek …',
    });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-save'));
    await act(async () => {});
    expect(mockAlertSpy).toHaveBeenCalledWith(
      'Kein Zugriff auf die Fotobibliothek',
      'Reelive braucht Zugriff auf deine Fotobibliothek …',
      expect.any(Array)
    );
    expect(screen.queryByTestId('player-export-hint')).toBeNull();
  });

  test('tapping "Einstellungen öffnen" in the alert calls Linking.openSettings', async () => {
    (saveMomentToGallery as jest.Mock).mockResolvedValue({
      ok: false, reason: 'no_permission', text: 'Kein Zugriff.',
    });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-save'));
    await act(async () => {});
    const buttons = mockAlertSpy.mock.calls[0][2] as AlertButton[];
    buttons.find((b) => b.text === 'Einstellungen öffnen')?.onPress?.();
    expect(mockOpenSettings).toHaveBeenCalled();
  });

  test('any other failure, a network problem say, shows the cause as a pill without an alert', async () => {
    (saveMomentToGallery as jest.Mock).mockResolvedValue({
      ok: false, reason: 'error', text: 'Dieser Moment konnte nicht gesichert werden. Probier es gleich nochmal.',
    });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-save'));
    await act(async () => {});
    expect(await screen.findByTestId('player-export-hint')).toHaveTextContent(
      'Dieser Moment konnte nicht gesichert werden. Probier es gleich nochmal.'
    );
    expect(mockAlertSpy).not.toHaveBeenCalled();
  });

  test('shows a loading indicator while saveMomentToGallery is still running', async () => {
    let resolveSave!: (value: { ok: true }) => void;
    (saveMomentToGallery as jest.Mock).mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    await wrap();
    await fireEvent.press(screen.getByTestId('player-save'));
    await act(async () => {});
    expect(screen.getByTestId('player-save-loading')).toBeTruthy();
    // A second tap while it is loading must NOT trigger a second call.
    await fireEvent.press(screen.getByTestId('player-save'));
    await act(async () => {
      resolveSave({ ok: true });
    });
    expect(saveMomentToGallery).toHaveBeenCalledTimes(1);
  });

  test('a late save answer for a moment left behind shows no pill on the new moment and leaves its button usable', async () => {
    let resolveSave!: (value: { ok: true }) => void;
    (saveMomentToGallery as jest.Mock).mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    await wrap();
    await fireEvent.press(screen.getByTestId('player-save'));
    await act(async () => {});

    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    await act(async () => {});
    // p2 (video) is active now instead of p1 (photo), and it is the only
    // video in the fixture.
    expect(screen.getByTestId('player-video')).toBeTruthy();

    await act(async () => {
      resolveSave({ ok: true });
    });
    expect(screen.queryByTestId('player-export-hint')).toBeNull();
    await fireEvent.press(screen.getByTestId('player-save'));
    await act(async () => {});
    expect(saveMomentToGallery).toHaveBeenCalledTimes(2);
  });
});

// `onLongPress` hangs off exactly the same Pressable nodes as
// onPressIn/onPressOut (`player-left`/`player-right`), which the zIndex
// tests above already show to be the frontmost touch layer in their half of
// the screen: there is no new stacking question to prove here, so every
// test below fires on that very node.
describe('reporting a moment (Task 8)', () => {
  test('a long press on the tap zone opens the report sheet and pauses the player', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();

    await fireEvent(screen.getByTestId('player-right'), 'longPress');
    await act(async () => {});
    expect(screen.getByText('Diesen Moment melden')).toBeTruthy();
    expect(screen.getByTestId('report-reason')).toBeTruthy();

    // Paused: p1 stays put even after the full photo duration.
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p1').medium_url });
  });

  test('the long press works from the LEFT tap zone just as from the RIGHT one', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-left'), 'longPress');
    await act(async () => {});
    expect(screen.getByTestId('report-reason')).toBeTruthy();
  });

  test('the moment stays visible while the report sheet is open', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-right'), 'longPress');
    await act(async () => {});
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p1').medium_url });
  });

  test('the send button stays disabled while no reason is entered, whitespace included', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-right'), 'longPress');
    await act(async () => {});
    expect(screen.getByTestId('report-send').props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByTestId('report-reason'), '   ');
    expect(screen.getByTestId('report-send').props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByTestId('report-reason'), 'Unpassend');
    expect(screen.getByTestId('report-send').props.accessibilityState.disabled).toBe(false);
  });

  test('a successful report sends the reason for the ACTIVE moment and then shows a confirmation', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-right'), 'longPress');
    await act(async () => {});
    await fireEvent.changeText(screen.getByTestId('report-reason'), 'Sieht komisch aus');
    await fireEvent.press(screen.getByTestId('report-send'));
    await act(async () => {});

    expect(reportMoment).toHaveBeenCalledWith('p1', 'Sieht komisch aus');
    expect(screen.getByTestId('report-confirmation')).toBeTruthy();
    expect(screen.queryByTestId('report-reason')).toBeNull();
    // Still the same moment: the confirmation replaces the sheet content,
    // not the player behind it.
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p1').medium_url });
  });

  test('a failed report shows the cause on the form, without a confirmation, and the sheet stays usable', async () => {
    (reportMoment as jest.Mock).mockResolvedValue({
      error: 'Deine Meldung konnte nicht gesendet werden. Probier es gleich nochmal.',
    });
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-right'), 'longPress');
    await act(async () => {});
    await fireEvent.changeText(screen.getByTestId('report-reason'), 'Sieht komisch aus');
    await fireEvent.press(screen.getByTestId('report-send'));
    await act(async () => {});

    expect(
      screen.getByText('Deine Meldung konnte nicht gesendet werden. Probier es gleich nochmal.')
    ).toBeTruthy();
    expect(screen.queryByTestId('report-confirmation')).toBeNull();
    expect(screen.getByTestId('report-reason')).toBeTruthy();
  });

  test('a second tap on send while the first request is still running triggers NO second call', async () => {
    let resolveReport!: (value: { error: null }) => void;
    (reportMoment as jest.Mock).mockReturnValue(new Promise((resolve) => { resolveReport = resolve; }));
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-right'), 'longPress');
    await act(async () => {});
    await fireEvent.changeText(screen.getByTestId('report-reason'), 'Sieht komisch aus');
    await fireEvent.press(screen.getByTestId('report-send')); // sending starts and hangs
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('report-send'));
    await act(async () => {
      resolveReport({ error: null });
    });
    expect(reportMoment).toHaveBeenCalledTimes(1);
  });

  // start='1' on purpose: at the very first moment the day interstitial
  // would add its own, independent pause reason and blur the check.
  test('closing the report sheet takes the pause reason back and the auto advance runs on', async () => {
    mockParams = { id: 't1', start: '1' }; // p2 (video), no day change to p3
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-right'), 'longPress');
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('sheet-backdrop'));
    await act(async () => {
      jest.advanceTimersByTime(3000); // durationFor(p2) = max(1000, 3*1000) = 3000 ms
    });
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p3').medium_url });
  });

  test('a hanging report for a moment left behind does NOT show its late answer on a newly opened session', async () => {
    let resolveFirstReport!: (value: { error: null }) => void;
    (reportMoment as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirstReport = resolve; })
    );
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();

    // Opens for p1, sends, hangs.
    await fireEvent(screen.getByTestId('player-right'), 'longPress');
    await act(async () => {});
    await fireEvent.changeText(screen.getByTestId('report-reason'), 'Erstes');
    await fireEvent.press(screen.getByTestId('report-send'));
    await act(async () => {});

    // Close without waiting for the answer, on to p2, open again (a fresh
    // session with nothing sent yet).
    await fireEvent.press(screen.getByTestId('sheet-backdrop'));
    await fireEvent(screen.getByTestId('player-right'), 'pressIn');
    await fireEvent(screen.getByTestId('player-right'), 'pressOut');
    await act(async () => {});
    await fireEvent(screen.getByTestId('player-right'), 'longPress');
    await act(async () => {});
    expect(screen.getByTestId('report-reason')).toBeTruthy(); // a fresh, empty form for p2

    // The old, hanging answer for p1 arrives now.
    await act(async () => {
      resolveFirstReport({ error: null });
    });
    expect(screen.queryByTestId('report-confirmation')).toBeNull();
    expect(screen.getByTestId('report-reason')).toBeTruthy();
  });
});

// The rule for this lives in features/recap/urlPool.ts (`retryHelps`) and
// is real here, not mocked.
describe('the error state only offers what it can deliver', () => {
  const LOAD_ERROR = 'Die Momente konnten nicht geladen werden. Probier es gleich nochmal.';

  test.each([
    ['Diese Reise ist noch versiegelt.', 'versiegelt'],
    ['Kein Zugriff auf diese Reise.', 'kein_zugriff'],
  ])('under "%s" there is no retry button', async (text, reason) => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: null, error: text, reason });
    await wrap();

    expect(screen.getByTestId('player-error')).toBeTruthy();
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText('Nochmal versuchen')).toBeNull();
    // The way back stays: it is then the only action there is.
    expect(screen.getByText('Zurück zur Übersicht')).toBeTruthy();
  });

  test('an error without a reason keeps its retry button', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: null, error: LOAD_ERROR, reason: null });
    await wrap();

    expect(screen.getByText('Nochmal versuchen')).toBeTruthy();
  });

  // The reason belongs to the POOL. If the TRIP request fails, its text
  // comes first in the load path, and the situation is a different one.
  test('a trip error keeps its button, even next to a domain rejection of the pool', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue({ data: null, error: 'Die Reise liess sich nicht laden.' });
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({
      pool: null, error: 'Kein Zugriff auf diese Reise.', reason: 'kein_zugriff',
    });
    await wrap();

    expect(screen.getByText('Die Reise liess sich nicht laden.')).toBeTruthy();
    expect(screen.getByText('Nochmal versuchen')).toBeTruthy();
  });
});

// Task 2 of the recap-show plan: the seal moves from the overview into the
// player and becomes the first full-screen card of the show. `playerMode`
// (Task 1) decides show versus jump; these tests hold the seal itself
// (mockSealAutoPeel = false) to look at it standing, instead of letting it
// peel itself away on mount like every test above.
describe('the seal in front of the show', () => {
  beforeEach(() => {
    mockSealAutoPeel = false;
  });
  afterEach(() => {
    mockSealAutoPeel = true;
  });

  test('entering without a start parameter the seal stands in front of the reel', async () => {
    mockParams = { id: 't1' }; // no start param: show mode
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(await screen.findByTestId('player-seal')).toBeTruthy();
    expect(screen.getByText('Dein Recap ist versiegelt. Tipp aufs Siegel, um ihn zu öffnen.')).toBeTruthy();
    expect(screen.queryByTestId('player-ready')).toBeNull();
  });

  test('peeled off, the reel runs', async () => {
    mockParams = { id: 't1' };
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    await fireEvent.press(await screen.findByTestId('player-seal'));
    expect(await screen.findByTestId('player-ready')).toBeTruthy();
    expect(screen.queryByTestId('player-seal')).toBeNull();
  });

  test('entering with a start parameter no seal stands, the jump comes from the overview', async () => {
    mockParams = { id: 't1', start: '2' };
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(await screen.findByTestId('player-ready')).toBeTruthy();
    expect(screen.queryByTestId('player-seal')).toBeNull();
  });

  test('start=0 is a jump too, repeating from the overview gets no second seal', async () => {
    mockParams = { id: 't1', start: '0' };
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(await screen.findByTestId('player-ready')).toBeTruthy();
    expect(screen.queryByTestId('player-seal')).toBeNull();
  });

  test('a load error skips the seal: nothing stands behind it', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue({ data: null, error: null });
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: null, error: null, reason: null });
    mockParams = { id: 't1' };
    await wrap();
    expect(await screen.findByTestId('player-error')).toBeTruthy();
    expect(screen.queryByTestId('player-seal')).toBeNull();
  });

  test('an empty reel skips the seal as well', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
    (getPool as jest.Mock).mockResolvedValue({
      pool: { urls: new Map(), validUntil: Date.now() + 999_999, skipped: 0 }, error: null, reason: null,
    });
    mockParams = { id: 't1' };
    await wrap();
    expect(await screen.findByTestId('player-empty')).toBeTruthy();
    expect(screen.queryByTestId('player-seal')).toBeNull();
  });

  // Without this guard the auto-advance timer and the day interstitial both
  // key off `phase`/`state` alone, and `load()` reaches 'ready' regardless of
  // whether the seal still stands: the reel would run on, unseen, behind it.
  // 20000 ms is well past PHOTO_DURATION_MS (5000) and past the whole
  // four-moment reel, so if any timer were still ticking behind the seal, the
  // player would already be on 'ended' by the time it peels.
  test('while the seal stands, no timer runs behind it: waiting past the whole reel changes nothing', async () => {
    mockParams = { id: 't1' };
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
    await wrap();
    expect(await screen.findByTestId('player-seal')).toBeTruthy();

    // In steps, not one big jump: a single `advanceTimersByTime` only fires
    // the timers already scheduled at the moment it is called, it does not
    // also let React flush the effects a fired timer's setState triggers and
    // let THOSE effects schedule their own new timers within the same call.
    // Stepping keeps giving React that chance between advances, the same
    // reason the day-interstitial tests above advance in two separate calls
    // rather than one.
    for (let i = 0; i < 20; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(screen.getByTestId('player-seal')).toBeTruthy();
    expect(screen.queryByTestId('player-end')).toBeNull();

    await fireEvent.press(screen.getByTestId('player-seal'));
    expect(await screen.findByTestId('player-ready')).toBeTruthy();
    expect(screen.getByTestId('player-photo').props.source).toEqual({ uri: image('p1').medium_url });
    expect(screen.queryByTestId('player-end')).toBeNull();
  });
});

// Device edges (found on a real iPhone, 2026-08-11)
//
// The player shows no header and sits edge to edge behind the Dynamic
// Island and the home indicator. Header and social area used to stand on
// the designed 32 points, which on the device put the progress bar UNDER
// the island.
//
// Why this suite could never see it: the global mock from jest.setup.ts
// reports insets of 0, and at 0 the topInset helper returns exactly the
// designed 32, so the right and the wrong version are indistinguishable.
// Only real device measurements pull them apart, which is why the hook is
// overridden on purpose here.
describe('safe area of the device', () => {
  let insetSpy: jest.SpyInstance | undefined;

  const setInsets = (top: number, bottom: number) => {
    const safeAreaModule = require('react-native-safe-area-context');
    insetSpy = jest
      .spyOn(safeAreaModule, 'useSafeAreaInsets')
      .mockReturnValue({ top, bottom, left: 0, right: 0 });
  };

  // The spy survives jest.clearAllMocks() (which only clears recordings, not
  // implementations), so it has to be reset by hand, otherwise every later
  // test runs with foreign device measurements.
  //
  // `mockRestore()` looks like the obvious way to do that but is NOT enough
  // here: `useSafeAreaInsets` is already a `jest.fn()` coming out of the
  // global mock (jest.setup.ts), so `jest.spyOn` never captured a real,
  // unmocked original to go back to. Its `mockRestore()` silently degrades to
  // `mockReset()`, which wipes the implementation instead of restoring one,
  // so `useSafeAreaInsets()` returns `undefined` for every test that renders
  // afterwards, in this file or any that runs later. Re-asserting the
  // all-zero default the global mock provides keeps that default alive
  // instead. Do not "simplify" this back to `mockRestore()`.
  afterEach(() => {
    insetSpy?.mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0 });
    insetSpy = undefined;
  });

  beforeEach(() => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: MOMENTS, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: POOL_OK, error: null, reason: null });
  });

  test('under the Dynamic Island the progress bar moves down', async () => {
    setInsets(59, 34);
    await wrap();

    const topStyle = StyleSheet.flatten(screen.getByTestId('player-header-area').props.style);
    expect(topStyle.top).toBe(59 + 16);
  });

  test('above the home indicator the reaction row moves up', async () => {
    setInsets(59, 34);
    await wrap();

    const bottomStyle = StyleSheet.flatten(screen.getByTestId('player-social-area').props.style);
    expect(bottomStyle.bottom).toBe(34 + 16);
  });

  // Counter check: where the device takes nothing away, the designed
  // spacing stays exactly as it is, otherwise the fix would be a shift for
  // everyone instead of a dodge only where one is needed.
  test('without insets the designed spacings stay unchanged', async () => {
    setInsets(0, 0);
    await wrap();

    const topStyle = StyleSheet.flatten(screen.getByTestId('player-header-area').props.style);
    const bottomStyle = StyleSheet.flatten(screen.getByTestId('player-social-area').props.style);
    expect(topStyle.top).toBe(32);
    expect(bottomStyle.bottom).toBe(32);
  });
});
