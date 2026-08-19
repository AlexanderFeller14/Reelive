// W4 (spec promise): the web player can write nothing. Complements
// moduleGraph.test.ts (static: which modules are REACHABLE at all) with the
// BEHAVIOUR-BASED counter-check: actually mount the screen, play through every
// interaction there is (tapping, holding, auto advance up to the end,
// "Nochmal ansehen", "Nochmal versuchen" after an error), and prove that only
// ONE single, reading call arrives at the real Supabase client.
//
// Deliberately a file of its OWN instead of another block in token.test.tsx:
// there `@/features/sharing/shareApi` is mocked completely (for simple, fast
// UI tests), here shareApi stays UNMOCKED (jest.requireActual would come to
// the same thing, and a second jest.mock call for the same module in the same
// file would only be confusing); instead the IO BOUNDARY underneath (the
// Supabase client itself) is replaced by spies. Exactly this combination, real
// implementation and mocked outer edge, is the lesson from phase 5: a mock on
// shareApi itself would replace precisely the mechanism that is to be tested
// here.
const mockInvoke = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockAuthSignInWithOtp = jest.fn();
const mockAuthSignOut = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: {
      signInWithOtp: (...args: unknown[]) => mockAuthSignInWithOtp(...args),
      signOut: (...args: unknown[]) => mockAuthSignOut(...args),
    },
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

jest.useFakeTimers();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ token: 'tok123' }),
}));
jest.mock('expo-status-bar', () => ({ setStatusBarStyle: jest.fn() }));
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  const Image = (props: Record<string, unknown>) => ReactActual.createElement(View, props);
  Image.prefetch = jest.fn();
  return { Image };
});
const mockListeners: Record<string, Array<(payload?: unknown) => void>> = {};
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
jest.mock('expo-video', () => ({
  useVideoPlayer: (_source: unknown, setup?: (p: unknown) => void) => {
    setup?.(mockVideoPlayer);
    return mockVideoPlayer;
  },
  VideoView: (props: Record<string, unknown>) => {
    const ReactActual = require('react');
    const { View } = require('react-native');
    return ReactActual.createElement(View, { testID: props.testID });
  },
}));

import { render, screen, fireEvent, act } from '@testing-library/react-native';
import SharedRecapScreen from '../[token]';

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockListeners)) delete mockListeners[key];
});

const validResponse = {
  reise: { name: 'Lissabon Städtetrip', start_date: '2026-08-10', end_date: '2026-08-14' },
  medien: [
    {
      post_id: 'p1', autor_name: 'Lea', type: 'photo', captured_at: '2026-08-10T09:00:00.000Z',
      captured_tz: 'Europe/Zurich', place_name: 'Lissabon', caption: null,
      duration_s: null, medium_url: 'https://s3/p1', thumb_url: null,
    },
    {
      post_id: 'p2', autor_name: 'Jonas', type: 'video', captured_at: '2026-08-10T10:00:00.000Z',
      captured_tz: 'Europe/Zurich', place_name: 'Lissabon', caption: null,
      duration_s: 3, medium_url: 'https://s3/p2', thumb_url: null,
    },
  ],
  gueltig_bis: '2099-01-01T00:00:00.000Z',
};

test('a whole run through the page (load, tap, hold, auto advance, video end, closing titles, "Nochmal ansehen") calls functions.invoke("share-link", aktion "aufloesen") exactly ONCE and never .from()/.rpc()/.auth', async () => {
  mockInvoke.mockResolvedValueOnce({ data: validResponse, error: null });

  await render(<SharedRecapScreen />);
  await act(async () => {});
  expect(screen.getByTestId('teilen-bereit')).toBeTruthy();

  // Wait out the interstitial of the first moment.
  await act(async () => {
    jest.advanceTimersByTime(1500);
  });

  // A short tap on the right leads to p2 (the video).
  await fireEvent(screen.getByTestId('teilen-rechts'), 'pressIn');
  await fireEvent(screen.getByTestId('teilen-rechts'), 'pressOut');
  expect(screen.getByTestId('teilen-video')).toBeTruthy();

  // Hold, then let go (stays on p2, no jump).
  await fireEvent(screen.getByTestId('teilen-rechts'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  await fireEvent(screen.getByTestId('teilen-rechts'), 'pressOut');
  expect(screen.getByTestId('teilen-video')).toBeTruthy();

  // The video end event leads into the closing titles (last moment).
  await act(async () => {
    for (const cb of mockListeners.playToEnd ?? []) cb();
  });
  expect(screen.getByTestId('teilen-ende')).toBeTruthy();

  // "Nochmal ansehen", a purely local state reset, NO new network call.
  await fireEvent.press(screen.getByText('Nochmal ansehen'));
  expect(screen.getByTestId('teilen-bereit')).toBeTruthy();

  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(mockInvoke).toHaveBeenCalledWith('share-link', { body: { aktion: 'aufloesen', token: 'tok123' } });
  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockRpc).not.toHaveBeenCalled();
  expect(mockAuthSignInWithOtp).not.toHaveBeenCalled();
  expect(mockAuthSignOut).not.toHaveBeenCalled();
});

test('after a rejected token, "Nochmal versuchen" reaches for functions.invoke once more and for nothing else, never .from()/.rpc()/.auth', async () => {
  mockInvoke.mockResolvedValueOnce({
    data: null,
    error: Object.assign(new Error('http'), {
      name: 'FunctionsHttpError',
      context: new Response(JSON.stringify({ fehler: 'Unbekannter Token.' }), { status: 404 }),
    }),
  });
  await render(<SharedRecapScreen />);
  await act(async () => {});
  expect(screen.getByTestId('teilen-fehler')).toBeTruthy();
  // A byte-identical rejection (see shareApi.test.ts), the screen does NOT
  // show the raw function text "Unbekannter Token." but the fixed sentence.
  expect(screen.getByText('Dieser Link funktioniert nicht mehr.')).toBeTruthy();

  mockInvoke.mockResolvedValueOnce({ data: validResponse, error: null });
  await fireEvent.press(screen.getByText('Nochmal versuchen'));
  await act(async () => {});
  expect(screen.getByTestId('teilen-bereit')).toBeTruthy();

  expect(mockInvoke).toHaveBeenCalledTimes(2);
  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockRpc).not.toHaveBeenCalled();
  expect(mockAuthSignInWithOtp).not.toHaveBeenCalled();
  expect(mockAuthSignOut).not.toHaveBeenCalled();
});
