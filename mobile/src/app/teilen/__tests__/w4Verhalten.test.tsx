// W4 (Spec-Versprechen): der Web-Player kann nichts schreiben. Ergänzt
// modulgraph.test.ts (statisch: welche Module sind überhaupt ERREICHBAR) um
// die VERHALTENSBASIERTE Gegenprobe: den Screen tatsächlich mounten, jede
// vorhandene Interaktion durchspielen (Tippen, Halten, Auto-Vorschub bis zum
// Ende, "Nochmal ansehen", "Nochmal versuchen" nach einem Fehler) — und
// belegen, dass dabei NUR EIN einziger, lesender Aufruf beim echten
// Supabase-Client ankommt.
//
// Bewusst eine EIGENE Datei statt ein weiterer Block in token.test.tsx: dort
// wird `@/features/teilen/shareApi` komplett gemockt (für einfache, schnelle
// UI-Tests) — hier bleibt shareApi UNGEMOCKT (jest.requireActual käme auf
// dasselbe hinaus, ein zweiter jest.mock-Aufruf für dasselbe Modul in
// derselben Datei wäre nur verwirrend), stattdessen wird die IO-GRENZE
// darunter (der Supabase-Client selbst) durch Spione ersetzt. Genau diese
// Kombination — echte Implementierung, gemockte Aussenkante — ist die
// Lehre aus Phase 5: ein Mock auf shareApi selbst würde exakt den
// Mechanismus ersetzen, der hier geprüft werden soll.
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
import GeteilterRecapScreen from '../[token]';

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockListeners)) delete mockListeners[key];
});

const gueltigeAntwort = {
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

test('eine vollständige Interaktion (laden, tippen, halten, Auto-Vorschub, Video-Ende, Ende, Nochmal ansehen) ruft NUR EINMAL functions.invoke("share-link", aktion "aufloesen") auf — nie .from()/.rpc()/.auth', async () => {
  mockInvoke.mockResolvedValueOnce({ data: gueltigeAntwort, error: null });

  await render(<GeteilterRecapScreen />);
  await act(async () => {});
  expect(screen.getByTestId('teilen-bereit')).toBeTruthy();

  // Zwischenkarte des ersten Moments abwarten.
  await act(async () => {
    jest.advanceTimersByTime(1500);
  });

  // Tippen rechts (kurz) → p2 (Video).
  await fireEvent(screen.getByTestId('teilen-rechts'), 'pressIn');
  await fireEvent(screen.getByTestId('teilen-rechts'), 'pressOut');
  expect(screen.getByTestId('teilen-video')).toBeTruthy();

  // Halten → Loslassen (bleibt bei p2, kein Sprung).
  await fireEvent(screen.getByTestId('teilen-rechts'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  await fireEvent(screen.getByTestId('teilen-rechts'), 'pressOut');
  expect(screen.getByTestId('teilen-video')).toBeTruthy();

  // Video-Ende-Event → Ende-Phase (letzter Moment).
  await act(async () => {
    for (const cb of mockListeners.playToEnd ?? []) cb();
  });
  expect(screen.getByTestId('teilen-ende')).toBeTruthy();

  // "Nochmal ansehen" — rein lokaler State-Reset, KEIN neuer Netzwerkaufruf.
  await fireEvent.press(screen.getByText('Nochmal ansehen'));
  expect(screen.getByTestId('teilen-bereit')).toBeTruthy();

  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(mockInvoke).toHaveBeenCalledWith('share-link', { body: { aktion: 'aufloesen', token: 'tok123' } });
  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockRpc).not.toHaveBeenCalled();
  expect(mockAuthSignInWithOtp).not.toHaveBeenCalled();
  expect(mockAuthSignOut).not.toHaveBeenCalled();
});

test('ein abgelehnter Token: "Nochmal versuchen" ruft erneut NUR functions.invoke auf, nie .from()/.rpc()/.auth', async () => {
  mockInvoke.mockResolvedValueOnce({
    data: null,
    error: Object.assign(new Error('http'), {
      name: 'FunctionsHttpError',
      context: new Response(JSON.stringify({ fehler: 'Unbekannter Token.' }), { status: 404 }),
    }),
  });
  await render(<GeteilterRecapScreen />);
  await act(async () => {});
  expect(screen.getByTestId('teilen-fehler')).toBeTruthy();
  // Byte-gleiche Ablehnung (siehe shareApi.test.ts) — der Screen zeigt NICHT
  // den rohen Function-Text "Unbekannter Token.", sondern den festen Satz.
  expect(screen.getByText('Dieser Link funktioniert nicht mehr.')).toBeTruthy();

  mockInvoke.mockResolvedValueOnce({ data: gueltigeAntwort, error: null });
  await fireEvent.press(screen.getByText('Nochmal versuchen'));
  await act(async () => {});
  expect(screen.getByTestId('teilen-bereit')).toBeTruthy();

  expect(mockInvoke).toHaveBeenCalledTimes(2);
  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockRpc).not.toHaveBeenCalled();
  expect(mockAuthSignInWithOtp).not.toHaveBeenCalled();
  expect(mockAuthSignOut).not.toHaveBeenCalled();
});
