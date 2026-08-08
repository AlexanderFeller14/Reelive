import { render, screen, fireEvent, act } from '@testing-library/react-native';

// Fake Timers global (wie Ausloeser.test.tsx): Date.now() läuft synchron mit
// den Timern mit (Jest-„modern"-Fake-Timer faken auch Date) — genau das
// braucht player.tsx für seine Halten-vs-Tipp-Unterscheidung.
jest.useFakeTimers();

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockKannZurueck = true;
let mockParams: { id: string; start?: string } = { id: 't1' };
// Echte Effekt-Semantik statt `(cb) => cb()` — diese Falle hat in diesem
// Projekt laut Auftrag schon dreimal Zeit gekostet.
jest.mock('expo-router', () => {
  const ReactActual = require('react');
  return {
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: () => mockKannZurueck }),
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void | (() => void)) => ReactActual.useEffect(cb, [cb]),
  };
});

jest.mock('expo-status-bar', () => ({ setStatusBarStyle: jest.fn() }));

// expo-image: einfacher View-Platzhalter, der alle Props (inkl. `source`,
// `testID`) durchreicht (gleiches Muster wie uebersicht.test.tsx) — dazu ein
// eigener `prefetch`-Spy für V8.
const mockPrefetch = jest.fn();
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  const Image = (props: Record<string, unknown>) => ReactActual.createElement(View, props);
  Image.prefetch = (...args: unknown[]) => mockPrefetch(...args);
  return { Image };
});

// expo-video: ein einziges Fake-Player-Objekt mit steuerbaren Listenern
// (gleiches Grundmuster wie preview.test.tsx, hier erweitert um
// addListener/statusChange/playToEnd, die die Tests direkt auslösen).
// `mockListeners` wird bei geänderter Quelle zurückgesetzt (simuliert, dass
// expo-video bei neuer Quelle einen frischen Player samt frischen Listenern
// erzeugt), nicht bei jedem Aufruf — sonst würde ein blosses Re-Render (ohne
// URL-Wechsel) heimlich schon registrierte Listener verlieren.
const mockListeners: Record<string, Array<(payload?: unknown) => void>> = {};
let mockLastSource: unknown;
const mockVideoPlayer = {
  loop: false,
  play: jest.fn(),
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
  }
  setup?.(mockVideoPlayer);
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
jest.mock('@/features/recap/recapApi', () => ({ fetchRecapMomente: jest.fn() }));
// requireActual unten zieht urlVorrat.ts real ein (für die echten
// laeuftBaldAb/BALD_ABLAUF_SCHWELLE_MS) — das importiert transitiv
// @/lib/supabase, das wiederum AsyncStorage lädt, das es in diesem
// Jest-Setup nicht gibt (gleiches Muster wie urlVorrat.test.ts selbst).
jest.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
// laeuftBaldAb/BALD_ABLAUF_SCHWELLE_MS bleiben echt (reine Funktionen) — nur
// die IO-Funktion holeVorrat wird gemockt.
jest.mock('@/features/recap/urlVorrat', () => ({
  ...jest.requireActual('@/features/recap/urlVorrat'),
  holeVorrat: jest.fn(),
}));

import RecapPlayer from '../[id]/player';
import { fetchTrip } from '@/features/trips/tripsApi';
import { fetchRecapMomente } from '@/features/recap/recapApi';
import { holeVorrat } from '@/features/recap/urlVorrat';
import type { RecapMoment } from '@/features/recap/types';

const trip = {
  id: 't1', name: 'Lissabon Städtetrip', start_date: '2026-08-10', end_date: '2026-08-14',
  status: 'revealed' as const, owner_id: 'u1',
  member_names: ['Lea', 'Jonas'], member_count: 2, my_post_count: 5,
};

function moment(overrides: Partial<RecapMoment>): RecapMoment {
  return {
    id: 'p0', trip_id: 't1', author_id: 'u1', type: 'photo', duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Zurich', place_name: 'Lissabon',
    upload_status: 'uploaded', autor_name: 'Lea',
    ...overrides,
  };
}

// Tag 1 (10.8.): p1 (Foto, 09:00), p2 (Video, 10:00, duration_s=3), p3 (Foto,
// 11:00). Tag 2 (11.8., kein place_name): p4 (Foto, 09:00, letzter ladbarer
// Moment). p5 ist ein Nachzügler (upload_status='pending').
const p1 = moment({ id: 'p1', captured_at: '2026-08-10T09:00:00.000Z' });
const p2 = moment({
  id: 'p2', type: 'video', duration_s: 3, caption: 'Schön hier',
  captured_at: '2026-08-10T10:00:00.000Z',
});
const p3 = moment({ id: 'p3', captured_at: '2026-08-10T11:00:00.000Z' });
const p4 = moment({ id: 'p4', captured_at: '2026-08-11T09:00:00.000Z', place_name: null });
const pendingM = moment({ id: 'p5', captured_at: '2026-08-11T10:00:00.000Z', upload_status: 'pending' });
const MOMENTE = [p1, p2, p3, p4, pendingM];

function bild(id: string) {
  return { post_id: id, medium_url: `https://cdn.example/${id}-medium.jpg`, thumb_url: `https://cdn.example/${id}-thumb.jpg` };
}
const VORRAT_OK = {
  urls: new Map([['p1', bild('p1')], ['p2', bild('p2')], ['p3', bild('p3')], ['p4', bild('p4')]]),
  gueltigBis: Date.now() + 999_999,
  ausgelassen: 0,
};

async function wrap() {
  const utils = await render(<RecapPlayer />);
  // Die drei parallelen Ladeaufrufe (Promise.all) auflösen lassen.
  await act(async () => {});
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockListeners)) delete mockListeners[key];
  mockLastSource = undefined;
  mockKannZurueck = true;
  mockParams = { id: 't1' };
  (fetchTrip as jest.Mock).mockResolvedValue({ data: trip, error: null });
});

describe('Laden & Randfälle', () => {
  test('eine Reise ganz ohne ladbaren Moment zeigt ihren eigenen Text statt eines leeren Players', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [], error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({
      vorrat: { urls: new Map(), gueltigBis: Date.now() + 999_999, ausgelassen: 0 },
      error: null,
      grund: null,
    });
    await wrap();
    expect(screen.getByText('Diese Reise ist leer geblieben.')).toBeTruthy();
    expect(screen.queryByTestId('player-links')).toBeNull();
    expect(screen.queryByTestId('player-rechts')).toBeNull();
  });

  // Anders als uebersicht.tsx (das Grid UND separate Status-Zeilen
  // gleichzeitig anzeigen kann) ist der Player ein sequenzieller
  // Story-Viewer: gibt es NICHTS Abspielbares, kann er auch mit einem
  // Nachzügler in der Warteschlange nichts zeigen — Task-11-Brief/Frage 3
  // verlangt hier ausdrücklich denselben Leer-Text, ohne die Ausnahme aus
  // uebersicht.tsx zu übernehmen.
  test('auch mit einem Nachzügler, aber sonst nichts Ladbarem, zeigt der Player den Leer-Text statt eines leeren Players', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [pendingM], error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({
      vorrat: { urls: new Map(), gueltigBis: Date.now() + 999_999, ausgelassen: 0 },
      error: null,
      grund: null,
    });
    await wrap();
    expect(screen.getByText('Diese Reise ist leer geblieben.')).toBeTruthy();
    expect(screen.queryByTestId('player-links')).toBeNull();
  });

  test('ein Fehler beim Laden zeigt die Ursache mit Retry, keinen leeren Player', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue({ data: null, error: null });
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [], error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: null, error: null, grund: null });
    await wrap();
    expect(screen.getByText('Diese Reise gibt es nicht mehr.')).toBeTruthy();
    expect(screen.queryByTestId('player-links')).toBeNull();
  });
});

describe('Startindex (Vertrag 2)', () => {
  test('ohne start-Param öffnet der Player beim ersten Moment', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p1').medium_url });
  });

  test('ein gültiger start-Param öffnet direkt den entsprechenden Moment', async () => {
    mockParams = { id: 't1', start: '2' }; // p3
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p3').medium_url });
  });

  test.each([['nicht-numerisch', 'abc'], ['negativ', '-1'], ['ausserhalb', '999'], ['nicht ganzzahlig', '2.5']])(
    'ein %s start-Param (%s) fällt auf den ersten Moment zurück',
    async (_label, raw) => {
      mockParams = { id: 't1', start: raw };
      (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
      (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
      await wrap();
      expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p1').medium_url });
    }
  );

  test('ein fehlendes start-Param fällt auf den ersten Moment zurück', async () => {
    mockParams = { id: 't1' };
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p1').medium_url });
  });
});

describe('Zustandsmaschine über den Screen', () => {
  test('ein Tipp auf die rechte Hälfte schaltet zum nächsten Moment', async () => {
    mockParams = { id: 't1', start: '1' }; // p2 (Video) — kein Tageswechsel zu p3
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    expect(screen.getByTestId('player-video')).toBeTruthy();
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut');
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p3').medium_url });
  });

  test('ein Tipp auf die linke Hälfte am ersten Moment bleibt beim ersten Moment', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-zwischenkarte')); // Tag-1-Karte weg
    await fireEvent(screen.getByTestId('player-links'), 'pressIn');
    await fireEvent(screen.getByTestId('player-links'), 'pressOut');
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p1').medium_url });
  });

  test('nach Ablauf der Fotodauer schaltet der Player automatisch weiter', async () => {
    mockParams = { id: 't1', start: '2' }; // p3
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p3').medium_url });
    await act(async () => {
      jest.advanceTimersByTime(5000); // FOTO_DAUER_MS
    });
    // p3 -> p4 ist ein Tageswechsel: die Zwischenkarte für Tag 2 muss jetzt da sein.
    expect(screen.getByTestId('player-zwischenkarte')).toBeTruthy();
    expect(screen.getByText('Tag 2 · 11. August')).toBeTruthy();
  });

  test('am letzten Moment schaltet Weiter zum Ende-Screen, nicht in einen leeren Zustand', async () => {
    mockParams = { id: 't1', start: '3' }; // p4, letzter ladbarer Moment
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-zwischenkarte')); // Tag-2-Karte weg
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut');
    expect(screen.getByTestId('player-ende')).toBeTruthy();
    expect(screen.getByText('Das war der Recap.')).toBeTruthy();
    expect(screen.getByText('1 Moment ist noch unterwegs.')).toBeTruthy();
  });

  test('Halten pausiert den Auto-Vorschub; Loslassen nach dem Halten setzt fort statt zu navigieren', async () => {
    mockParams = { id: 't1', start: '2' }; // p3
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    // Selbst nach Ablauf der vollen Fotodauer bleibt der Moment stehen,
    // solange gehalten wird — ein Mutant, der die pausiert-Prüfung im
    // Auto-Vorschub-Effekt entfernt, liesse diesen Test fallen.
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p3').medium_url });
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut');
    // Lang genug gehalten (>= Tipp-Schwelle): Loslassen setzt NUR fort, es
    // navigiert nicht zusätzlich zum nächsten Moment.
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p3').medium_url });
  });

  test('ein kurzer Tipp (unter der Halte-Schwelle) navigiert, ein langer Tipp (Halten) navigiert NICHT', async () => {
    mockParams = { id: 't1', start: '2' }; // p3
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut'); // sofort losgelassen: Tipp
    expect(screen.getByTestId('player-zwischenkarte')).toBeTruthy(); // p3 -> p4, Tageswechsel
  });
});

describe('Tages-Zwischenkarte', () => {
  test('erscheint vor dem allerersten Moment und verschwindet nach 1,5 Sekunden von selbst', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    expect(screen.getByTestId('player-zwischenkarte')).toBeTruthy();
    expect(screen.getByText('Tag 1 · Lissabon · 10. August')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(screen.queryByTestId('player-zwischenkarte')).toBeNull();
    // Danach läuft der normale Auto-Vorschub weiter — ab HIER (nicht ab dem
    // Mount) schaltet p1 nach FOTO_DAUER_MS zu p2 weiter.
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('player-video')).toBeTruthy();
  });

  // Die Kernfrage aus dem Auftrag: ein Tipp während der Karte darf NICHT
  // gleichzeitig auch noch weiterschalten (sonst wäre man nach einem Tipp
  // schon beim ZWEITEN Moment, nicht beim ersten).
  test('ein Tipp während der Karte überspringt NUR sie, ohne zusätzlich weiterzuschalten', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-zwischenkarte'));
    expect(screen.queryByTestId('player-zwischenkarte')).toBeNull();
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p1').medium_url });
  });
});

describe('Video-Momente', () => {
  test('ein Video schaltet beim playToEnd-Event weiter, nicht erst nach dem Fallback-Timer', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, duration_s=3 -> Fallback-Timer bei 3000ms
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    expect(screen.getByTestId('player-video')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(500); // deutlich vor den 3000ms des Fallbacks
      mockListeners.playToEnd?.forEach((cb) => cb());
    });
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p3').medium_url });
  });

  test('ein Video, das nicht lädt, zeigt nach einem stillen Neuversuch Thumbnail und Hinweis — Weitertippen bleibt möglich', async () => {
    mockParams = { id: 't1', start: '1' }; // p2
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();

    // Erster Fehlschlag: V10 verlangt einen STILLEN Neuversuch — noch kein Hinweistext.
    await act(async () => {
      mockListeners.statusChange?.forEach((cb) => cb({ status: 'error' }));
    });
    await act(async () => {});
    expect(holeVorrat).toHaveBeenCalledTimes(2); // 1x initiales Laden, 1x Neuversuch
    expect(screen.queryByText('Dieses Video lässt sich gerade nicht laden.')).toBeNull();

    // Zweiter Fehlschlag desselben Moments: der einmalige Neuversuch ist
    // aufgebraucht, jetzt erscheint der Hinweis.
    await act(async () => {
      mockListeners.statusChange?.forEach((cb) => cb({ status: 'error' }));
    });
    expect(screen.getByText('Dieses Video lässt sich gerade nicht laden.')).toBeTruthy();
    expect(holeVorrat).toHaveBeenCalledTimes(2); // kein dritter, unsichtbarer Versuch mehr

    // Der Recap bricht trotzdem nicht ab — Weitertippen funktioniert weiter.
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut');
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p3').medium_url });
  });
});

describe('Vorrats-Erneuerung (V10)', () => {
  test('ein bald ablaufender Vorrat wird vor dem nächsten Weiter im Hintergrund erneuert, ohne den Player zu unterbrechen', async () => {
    mockParams = { id: 't1', start: '1' }; // p2 -> p3, kein Tageswechsel
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    const baldAblaufend = { urls: VORRAT_OK.urls, gueltigBis: Date.now() + 60_000, ausgelassen: 0 }; // < 5-Min-Schwelle
    (holeVorrat as jest.Mock)
      .mockResolvedValueOnce({ vorrat: baldAblaufend, error: null, grund: null })
      .mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut');
    await act(async () => {});
    expect(holeVorrat).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p3').medium_url });
    expect(screen.queryByTestId('player-fehler')).toBeNull();
  });

  test('ein Vorrat mit reichlich Restlaufzeit wird NICHT erneut geholt', async () => {
    mockParams = { id: 't1', start: '1' };
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut');
    await act(async () => {});
    expect(holeVorrat).toHaveBeenCalledTimes(1);
  });
});

describe('Vorladen (V8)', () => {
  test('lädt die nächsten drei Fotos vor, ein Video dazwischen zählt nicht mit', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap(); // start=0 (p1) -> Nachfolger p2(Video),p3,p4 -> nur p3/p4 sind Fotos
    expect(mockPrefetch).toHaveBeenCalledWith([bild('p3').medium_url, bild('p4').medium_url]);
  });
});

describe('Nachzügler & Ausgelassene am Ende', () => {
  test('am Ende erscheinen sowohl Nachzügler- als auch Ausgelassen-Zeile, wenn beide vorkommen', async () => {
    const p6 = moment({ id: 'p6', captured_at: '2026-08-11T11:00:00.000Z' }); // uploaded, aber ohne Vorrats-URL
    mockParams = { id: 't1', start: '3' };
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [...MOMENTE, p6], error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: { ...VORRAT_OK, ausgelassen: 1 }, error: null, grund: null });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-zwischenkarte'));
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut');
    expect(screen.getByTestId('player-ende')).toBeTruthy();
    expect(screen.getByText('1 Moment ist noch unterwegs.')).toBeTruthy();
    expect(screen.getByText('1 Moment liess sich gerade nicht laden. Schau später nochmal rein.')).toBeTruthy();
  });

  test('ohne Nachzügler und ohne Ausgelassene erscheint am Ende keine der beiden Zeilen', async () => {
    mockParams = { id: 't1', start: '2' }; // p3 -> Tageswechsel zu p4 -> letzter Moment danach
    const nurTag1 = [p1, p2, p3];
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: nurTag1, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({
      vorrat: { urls: VORRAT_OK.urls, gueltigBis: Date.now() + 999_999, ausgelassen: 0 },
      error: null,
      grund: null,
    });
    await wrap();
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut');
    expect(screen.getByTestId('player-ende')).toBeTruthy();
    expect(screen.queryByText(/unterwegs\.$/)).toBeNull();
    expect(screen.queryByText(/laden\. Schau später nochmal rein\.$/)).toBeNull();
  });
});

describe('Schliessen', () => {
  test('der Schliessen-Knopf verlässt den Player per back(), wenn ein Rückweg existiert', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-schliessen'));
    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  test('ohne Rückweg im Stapel führt der Schliessen-Knopf per replace zur Recap-Liste', async () => {
    mockKannZurueck = false;
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-schliessen'));
    expect(mockReplace).toHaveBeenCalledWith('/recap');
    expect(mockBack).not.toHaveBeenCalled();
  });
});
