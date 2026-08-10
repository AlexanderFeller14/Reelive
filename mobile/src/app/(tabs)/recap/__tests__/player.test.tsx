import { Alert, Animated, PanResponder, StyleSheet } from 'react-native';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

// Alert zeigt im Test nur einen Dialog an, ohne dass jemand tippt (gleiches
// Muster wie reise/__tests__/detail.test.tsx), der Task-7-Block unten löst
// bei Bedarf gezielt den "Einstellungen öffnen"-Knopf aus.
type AlertKnopf = { text?: string; style?: string; onPress?: () => void };
const mockAlertSpion = jest.fn();
jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => mockAlertSpion(...args));

// Fake Timers global (wie Ausloeser.test.tsx): Date.now() läuft synchron mit
// den Timern mit (Jest-„modern"-Fake-Timer faken auch Date), genau das
// braucht player.tsx für seine Halten-vs-Tipp-Unterscheidung.
jest.useFakeTimers();

// M9, korrigiert (Phase-5-Final-Review, Punkt 3): der frühere Mock gab
// `reducedMotion` SYNCHRON zurück (`jest.fn(() => false)`, dann per
// `mockReturnValue(true)` umgeschaltet), genau die Eigenschaft entfernt, um
// die es beim Kino-Fade-Test eigentlich geht. Der ECHTE Hook
// (useReducedMotion.ts) startet IMMER bei `false` (`useState(false)`) und
// löst erst ASYNCHRON auf, sobald `AccessibilityInfo.isReduceMotionEnabled()`
// zurückkommt, mit dem alten Mock war ein Effekt mit `[]`-Deps im Player
// (der ursprüngliche Bug) nicht von einem korrekt mit `[reducedMotion]`
// reagierenden Effekt zu unterscheiden: BEIDE liefern beim ersten Render
// bereits den (synchron gemockten) Endwert. Dieser Mock bildet den echten
// Hook nach: ein `useState`, das erst durch einen von aussen aufgelösten
// Promise (`mockReducedMotionAufloesen`) NACH dem Mount wechselt, exakt wie
// `AccessibilityInfo.isReduceMotionEnabled()` es täte.
//
// Ein EINZELNER, geteilter Resolver reicht nicht: `useReducedMotion()` wird
// nicht nur einmal (im Player) aufgerufen, sondern von JEDER `PressScale`-
// Instanz im Baum ebenfalls (KinoButton, TextLink, jede EmojiPille, …, siehe
// PressScale.tsx), jede bekommt beim Mounten ihren EIGENEN Promise/Resolver.
// Ein einzelner `let`-Resolver würde von der zuletzt gemounteten Instanz
// überschrieben, `mockReducedMotionAufloesen` löste dann NUR noch DEREN
// Promise auf, nicht den des Players. Alle ausstehenden Resolver landen
// deshalb in einem Set und werden gemeinsam aufgelöst.
const mockReducedMotionResolver = new Set<(wert: boolean) => void>();
jest.mock('@/theme/useReducedMotion', () => {
  const ReactActual = require('react');
  return {
    useReducedMotion: () => {
      const [wert, setWert] = ReactActual.useState(false);
      ReactActual.useEffect(() => {
        let lebt = true;
        const versprechen = new Promise((resolve: (wert: boolean) => void) => {
          mockReducedMotionResolver.add(resolve);
        });
        void versprechen.then((enabled: boolean) => {
          if (lebt) setWert(enabled);
        });
        return () => {
          lebt = false;
        };
      }, []);
      return wert;
    },
  };
});
// Löst ALLE ausstehenden „AccessibilityInfo"-Promises auf (siehe Kommentar
// oben), muss innerhalb eines `act(...)` aufgerufen werden (die `.then()`-
// Handler lösen ein echtes `setState` aus).
function mockReducedMotionAufloesen(wert: boolean) {
  for (const resolve of mockReducedMotionResolver) resolve(wert);
  mockReducedMotionResolver.clear();
}

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockKannZurueck = true;
let mockParams: { id: string; start?: string } = { id: 't1' };
// Echte Effekt-Semantik statt `(cb) => cb()`, diese Falle hat in diesem
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
// `testID`) durchreicht (gleiches Muster wie uebersicht.test.tsx), dazu ein
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
// erzeugt), nicht bei jedem Aufruf, sonst würde ein blosses Re-Render (ohne
// URL-Wechsel) heimlich schon registrierte Listener verlieren.
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
// Phase-5-Final-Review, Punkt 1 (Review-Fund am Mock selbst): `setup` lief
// bislang UNBEDINGT bei jedem Aufruf, expo-video ruft ihn in Wirklichkeit
// aber nur EINMAL, beim tatsächlichen Erzeugen des Players (neue Quelle),
// nicht bei jedem Re-Render der Komponente, die `useVideoPlayer` aufruft.
// `setup` ruft hier `p.play()` (siehe VideoMoment in player.tsx), ein
// Mock, der ihn bei JEDEM Render erneut abfeuert, erzeugt bei jedem
// beliebigen Re-Render einen zusätzlichen, mit der eigentlichen Pause/Play-
// Logik NICHTS zu tuenden `play()`-Aufruf und macht `play.mock.calls.length`
// als Signal unbrauchbar für alles, was genauer als "mindestens N-mal"
// prüfen will. Jetzt an dieselbe Bedingung gekoppelt wie der
// Listener-Reset direkt darüber (beides passiert nur bei einer TATSÄCHLICH
// neuen Quelle).
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
jest.mock('@/features/recap/recapApi', () => ({ fetchRecapMomente: jest.fn() }));
// requireActual unten zieht urlVorrat.ts real ein (für die echten
// laeuftBaldAb/BALD_ABLAUF_SCHWELLE_MS), das importiert transitiv
// @/lib/supabase, das wiederum AsyncStorage lädt, das es in diesem
// Jest-Setup nicht gibt (gleiches Muster wie urlVorrat.test.ts selbst).
jest.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
// laeuftBaldAb/BALD_ABLAUF_SCHWELLE_MS bleiben echt (reine Funktionen), nur
// die IO-Funktion holeVorrat wird gemockt.
jest.mock('@/features/recap/urlVorrat', () => ({
  ...jest.requireActual('@/features/recap/urlVorrat'),
  holeVorrat: jest.fn(),
}));
// Task 12: sozialApi ist reine IO (supabase.from), komplett gemockt, die
// realen Datenformen prüft sozialApi.test.ts bereits für sich.
jest.mock('@/features/recap/sozialApi', () => ({
  fetchReaktionen: jest.fn(),
  setzeReaktion: jest.fn(),
  entferneReaktion: jest.fn(),
  fetchKommentare: jest.fn(),
  schreibeKommentar: jest.fn(),
  KOMMENTAR_MAX_LAENGE: 500,
}));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ userId: 'u1' }) }));
const mockHaptics = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('expo-haptics', () => ({
  impactAsync: (...args: unknown[]) => mockHaptics(...args),
  ImpactFeedbackStyle: { Light: 'light' },
}));
// Task 7: exportApi hat ihre eigene, vollständige Testdatei
// (features/recap/__tests__/exportApi.test.ts), hier nur ein Spion auf
// `sichereMomentInGalerie`, der Player ruft nichts anderes daraus auf.
jest.mock('@/features/recap/exportApi', () => ({ sichereMomentInGalerie: jest.fn() }));
const mockOpenSettings = jest.fn(() => Promise.resolve());
jest.mock('expo-linking', () => ({ openSettings: () => mockOpenSettings() }));

// Task 8: meldenApi hat ihre eigene, vollständige Testdatei
// (features/recap/__tests__/meldenApi.test.ts), hier nur ein Spion auf
// `meldeMoment`, der Player ruft nichts anderes daraus auf. `MELDEN_MAX_LAENGE`
// bleibt echt (reine Konstante, exportiert für die Input-`maxLength`-Prop).
jest.mock('@/features/recap/meldenApi', () => ({
  ...jest.requireActual('@/features/recap/meldenApi'),
  meldeMoment: jest.fn(),
}));

import RecapPlayer from '../[id]/player';
import { fetchTrip } from '@/features/trips/tripsApi';
import { fetchRecapMomente } from '@/features/recap/recapApi';
import { holeVorrat } from '@/features/recap/urlVorrat';
import {
  fetchReaktionen, setzeReaktion, entferneReaktion, fetchKommentare, schreibeKommentar,
} from '@/features/recap/sozialApi';
import type { RecapMoment } from '@/features/recap/types';
import { sichereMomentInGalerie } from '@/features/recap/exportApi';
import { meldeMoment } from '@/features/recap/meldenApi';

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
  // Task 12: von den meisten (nicht-sozialen) Tests unbenutzt, aber jeder
  // Durchlauf, der `phase='bereit'` erreicht, löst den Reaktionen-Ladeeffekt
  // aus, ein Default hier hält den Rest der Suite unverändert grün.
  (fetchReaktionen as jest.Mock).mockResolvedValue({ data: {}, error: null });
  (fetchKommentare as jest.Mock).mockResolvedValue({ data: [], error: null });
  // Task 8: Default für Tests ausserhalb des Melden-Blocks, die zufällig ein
  // langes Tippen auslösen könnten (keiner tut das, aber gleiches
  // Vorsichtsprinzip wie bei fetchReaktionen/fetchKommentare oben).
  (meldeMoment as jest.Mock).mockResolvedValue({ error: null });
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
  // Nachzügler in der Warteschlange nichts zeigen, Task-11-Brief/Frage 3
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

  // M1 (Review-Fund): die frühere Testreihe traf nie GENAU die Grenze
  // n === laenge, '999' liegt weit ausserhalb und lässt einen Mutanten
  // `n >= laenge` -> `n > laenge` unentdeckt (der akzeptiert dann fälschlich
  // n === laenge und liefert spielliste[laenge] === undefined, ein leerer
  // Screen statt eines Rückfalls auf 0). mitBild hat hier genau 4 Einträge
  // (p1..p4), start='4' ist exakt diese Grenze.
  test('ein start-Param GENAU an der Länge der Spielliste (n === laenge) fällt auf den ersten Moment zurück', async () => {
    mockParams = { id: 't1', start: '4' };
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p1').medium_url });
  });
});

// M7 (Review-Fund): Schritt 3 des Briefs (Avatar+Name, Uhrzeit in
// captured_tz, Ort, Caption) hatte KEINEN einzigen Test, die gesamte
// Kopf-Pille und die Caption-Pille liessen sich löschen, ohne dass irgendein
// Test fiel.
describe('Kopf- und Caption-Pillen (Schritt 3)', () => {
  test('zeigt Autorenname, Avatar-Initiale sowie Ort und Uhrzeit in einer Pille', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    // p1: captured_at 09:00 UTC, captured_tz Europe/Zurich (CEST, UTC+2 im
    // August) -> 11:00 Ortszeit, place_name 'Lissabon'.
    expect(screen.getByText('Lea')).toBeTruthy();
    expect(screen.getByText('L')).toBeTruthy(); // Avatar-Initiale
    expect(screen.getByText('Lissabon · 11:00')).toBeTruthy();
  });

  // Die zentrale Zusicherung aus dem Brief: NICHT die Gerätezeit, sondern
  // captured_tz DES MOMENTS. Ein Mutant, der `timeZone: capturedTz` aus
  // zeitInZone entfernt (Gerätezeit zeigen), lässt diesen Test fallen,
  // vorausgesetzt, die Prüfmaschine läuft nicht zufällig in Asia/Tokyo.
  test('die Uhrzeit kommt aus captured_tz DES MOMENTS, nicht aus der Gerätezeit', async () => {
    const p1Tokio = moment({ id: 'p1', captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Asia/Tokyo' });
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [p1Tokio], error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({
      vorrat: { urls: new Map([['p1', bild('p1')]]), gueltigBis: Date.now() + 999_999, ausgelassen: 0 },
      error: null,
      grund: null,
    });
    await wrap();
    // 09:00 UTC ist 18:00 in Asia/Tokyo (UTC+9), NICHT 09:00.
    expect(screen.getByText('Lissabon · 18:00')).toBeTruthy();
    expect(screen.queryByText('Lissabon · 09:00')).toBeNull();
  });

  test('eine vorhandene Caption erscheint als eigene Pille', async () => {
    mockParams = { id: 't1', start: '1' }; // p2 trägt die Caption 'Schön hier'
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    expect(screen.getByTestId('player-caption')).toBeTruthy();
    expect(screen.getByText('Schön hier')).toBeTruthy();
  });

  test('ohne Caption erscheint keine Caption-Pille', async () => {
    // p1 (start=0) hat caption: null.
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    expect(screen.queryByTestId('player-caption')).toBeNull();
  });
});

describe('Zustandsmaschine über den Screen', () => {
  test('ein Tipp auf die rechte Hälfte schaltet zum nächsten Moment', async () => {
    mockParams = { id: 't1', start: '1' }; // p2 (Video), kein Tageswechsel zu p3
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
    // solange gehalten wird, ein Mutant, der die pausiert-Prüfung im
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
    // Danach läuft der normale Auto-Vorschub weiter, ab HIER (nicht ab dem
    // Mount) schaltet p1 nach FOTO_DAUER_MS zu p2 weiter.
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('player-video')).toBeTruthy();
  });

  // M4 (Review-Fund): die vorherige Suite prüfte nur "nach 1,5 s ist die
  // Karte weg", ein Mutant, der ZWISCHENKARTE_DAUER_MS auf z.B. 500 ms
  // verkürzt, blieb dabei unentdeckt grün (500 < 1500, die Prüfung "nach
  // 1500ms weg" stimmt für BEIDE Werte). Diese Gegenprobe verlangt
  // ausdrücklich, dass die Karte VOR Ablauf der vollen Dauer noch steht.
  test('die Zwischenkarte verschwindet NICHT vor Ablauf der vollen 1,5 Sekunden', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    expect(screen.getByTestId('player-zwischenkarte')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1499);
    });
    expect(screen.getByTestId('player-zwischenkarte')).toBeTruthy();
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

  // M5 (Review-Fund): `fireEvent.press` auf ein testID prüft keine
  // Geometrie/Stapelung, eine Verschiebung der Karte VOR die Tipp-Zonen im
  // JSX-Baum liesse den obigen Test unverändert grün, obwohl die Karte in
  // der echten App dann darunter läge. Die Stapelung ist jetzt ein
  // expliziter, von der Baumreihenfolge unabhängiger zIndex, das prüfen wir
  // direkt.
  test('die Zwischenkarte liegt per zIndex über den Tipp-Zonen, unabhängig von der Render-Reihenfolge im Baum', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    const karte = StyleSheet.flatten(screen.getByTestId('player-zwischenkarte').props.style);
    const links = StyleSheet.flatten(screen.getByTestId('player-links').props.style);
    const rechts = StyleSheet.flatten(screen.getByTestId('player-rechts').props.style);
    expect(karte.zIndex).toBeGreaterThan(links.zIndex ?? 0);
    expect(karte.zIndex).toBeGreaterThan(rechts.zIndex ?? 0);
  });

  // Klein (Review-Fund): die Karte ist vollflächig-opak, ohne einen noch
  // höheren zIndex für die Schliessen-Pille liesse sich der Player während
  // ihrer 1,5 s nicht verlassen.
  test('die Schliessen-Pille bleibt auch WÄHREND die Zwischenkarte steht bedienbar', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    expect(screen.getByTestId('player-zwischenkarte')).toBeTruthy();
    const schliessen = StyleSheet.flatten(screen.getByTestId('player-schliessen').props.style);
    const karte = StyleSheet.flatten(screen.getByTestId('player-zwischenkarte').props.style);
    expect(schliessen.zIndex).toBeGreaterThan(karte.zIndex ?? 0);
    await fireEvent.press(screen.getByTestId('player-schliessen'));
    expect(mockBack).toHaveBeenCalled();
  });

  // Wichtig 1 (Review-Fund): die Zwischenkarte muss ein Video darunter
  // WIRKLICH pausieren (player.pause()), sonst liefen Bild und Ton hinter
  // der opaken Karte weiter, und ein sehr kurzes Video (dauerFuer <= 1,5 s)
  // könnte sogar unter der Karte zu Ende laufen: der Moment, den die Karte
  // gerade ankündigt, würde dann nie gezeigt, und die Karte verschwände
  // vorzeitig.
  test('ein Video unter der Zwischenkarte wird wirklich pausiert und geht nicht verloren', async () => {
    // p2v: Tag-2-Video mit einer Dauer knapp unter der Kartenzeit (1,5 s),
    // würde die Karte das Video nicht pausieren, liesse `playToEnd` (oder
    // der dauerFuer-Fallback-Timer) den Moment schon während der Karte
    // verschwinden.
    const p2v = moment({
      id: 'p2v', type: 'video', duration_s: 1, captured_at: '2026-08-11T09:00:00.000Z', place_name: null,
    });
    mockParams = { id: 't1', start: '2' }; // p3 (Tag 1, letzter Moment vor dem Tageswechsel)
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [p1, p2, p3, p2v], error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({
      vorrat: {
        urls: new Map([['p1', bild('p1')], ['p2', bild('p2')], ['p3', bild('p3')], ['p2v', bild('p2v')]]),
        gueltigBis: Date.now() + 999_999,
        ausgelassen: 0,
      },
      error: null,
      grund: null,
    });
    await wrap();
    // p3 -> p2v: Tageswechsel, die Karte für Tag 2 erscheint VOR dem Video.
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut');
    expect(screen.getByTestId('player-zwischenkarte')).toBeTruthy();
    expect(screen.getByTestId('player-video')).toBeTruthy();
    expect(mockVideoPlayer.pause).toHaveBeenCalled();

    // Selbst nach Ablauf von dauerFuer(p2v) = 1000 ms UND playToEnd bleibt
    // der Moment stehen, solange die Karte noch steht (1,5 s > 1 s).
    await act(async () => {
      jest.advanceTimersByTime(1000);
      mockListeners.playToEnd?.forEach((cb) => cb());
    });
    expect(screen.getByTestId('player-zwischenkarte')).toBeTruthy();
    expect(screen.getByTestId('player-video')).toBeTruthy();

    // Nach Ablauf der vollen 1,5 s verschwindet die Karte, das Video setzt
    // fort (play() erneut aufgerufen) und läuft normal zu Ende.
    await act(async () => {
      jest.advanceTimersByTime(500); // insgesamt 1500ms seit dem Tageswechsel
    });
    expect(screen.queryByTestId('player-zwischenkarte')).toBeNull();
    expect(screen.getByTestId('player-video')).toBeTruthy();
    await act(async () => {
      mockListeners.playToEnd?.forEach((cb) => cb());
    });
    expect(screen.queryByTestId('player-video')).toBeNull(); // letzter Moment erreicht -> Ende-Screen
    expect(screen.getByTestId('player-ende')).toBeTruthy();
  });

  // Phase-5-Final-Review, Punkt 1, DER Repro aus dem Bericht: der
  // Zwischenkarten-Timer bleibt nach einem Tipp-Überspringen verwaist stehen
  // (seine Deps `[phase, spielliste, startDate, stand.index]` ändern sich
  // durch `ueberspringen()` nicht, Cleanup/Neulauf bleiben also aus) und
  // feuert trotzdem noch, wenn inzwischen aus einem GANZ ANDEREN Grund
  // (Kommentar-Sheet) pausiert wurde. Die ALTE Repräsentation (`pausiert:
  // false` unbedingt) hätte diese fremde Pause stillschweigend aufgehoben,
  // der Player wäre HINTER dem offenen Sheet weitergelaufen (Bild UND Ton).
  // Ersetzt zwei ältere Tests (M6), die genau dieses unbedingte Zurücksetzen
  // noch als GEWÜNSCHTES Verhalten prüften, mit den benannten Gründen ist
  // das nicht mehr korrekt (siehe deren eigener Kommentar: "stand.pausiert
  // ist bei einem realen Kartenaufruf zwar immer schon false").
  test('überspringen → Kommentar-Sheet öffnen → 1500 ms vorspulen: der Player bleibt pausiert (Final-Review-Repro)', async () => {
    // Gleicher Aufbau wie "ein Video unter der Zwischenkarte wird wirklich
    // pausiert…" oben: p2v ist Tag 2s erstes (Video-)Moment, der Wechsel
    // p3 → p2v löst die Tages-Zwischenkarte aus.
    const p2v = moment({
      id: 'p2v', type: 'video', duration_s: 3, captured_at: '2026-08-11T09:00:00.000Z', place_name: null,
    });
    mockParams = { id: 't1', start: '2' }; // p3 (Tag 1, letzter Moment vor dem Tageswechsel)
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [p1, p2, p3, p2v], error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({
      vorrat: {
        urls: new Map([['p1', bild('p1')], ['p2', bild('p2')], ['p3', bild('p3')], ['p2v', bild('p2v')]]),
        gueltigBis: Date.now() + 999_999,
        ausgelassen: 0,
      },
      error: null,
      grund: null,
    });
    await wrap();
    // Schritt 1: Tageswechsel, die Karte für Tag 2 erscheint, ihr
    // 1,5-s-Timer T startet (t=0 im Folgenden).
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut');
    expect(screen.getByTestId('player-zwischenkarte')).toBeTruthy();

    // Schritt 2: bei t≈200ms auf die Karte tippen (überspringen). T lebt
    // verwaist weiter.
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    await fireEvent.press(screen.getByTestId('player-zwischenkarte'));
    expect(screen.queryByTestId('player-zwischenkarte')).toBeNull();

    // Schritt 3: bei t≈400ms den Kommentar-Knopf tippen → Sheet öffnet,
    // Video pausiert ECHT (player.pause()).
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    await fireEvent.press(screen.getByTestId('player-kommentare-oeffnen'));
    expect(screen.getByTestId('kommentar-eingabe')).toBeTruthy(); // Sheet ist offen
    const spielAufrufeBeimOeffnen = mockVideoPlayer.play.mock.calls.length;
    const pauseAufrufeBeimOeffnen = mockVideoPlayer.pause.mock.calls.length;

    // Schritt 4: bei insgesamt t=1500ms (seit dem Tageswechsel) feuert der
    // verwaiste Timer T. Er darf NUR seinen eigenen Grund ('zwischenkarte')
    // zurücknehmen, der bereits per `ueberspringen()` entfernt wurde
    // (sicheres No-Op), NICHT 'kommentare'.
    await act(async () => {
      jest.advanceTimersByTime(1100); // 200 + 200 + 1100 = 1500
    });

    // Schritt 5 (der eigentliche Fehler, jetzt widerlegt): kein neuer
    // player.play()-Aufruf, der Player läuft NICHT hinter dem (weiterhin
    // offenen) Sheet weiter. Ohne den Mock-Fix oben (setup nur bei
    // tatsächlich neuer Quelle, siehe dort) wäre diese Zählung durch
    // renderausgelöste, mit der Pause-Logik nichts zu tuende Zusatzaufrufe
    // verrauscht gewesen.
    expect(mockVideoPlayer.play.mock.calls.length).toBe(spielAufrufeBeimOeffnen);
    // Gegenprobe: auch kein neuer pause()-Aufruf, der Player wurde nie
    // wieder losgelassen, den man erneut hätte anhalten müssen.
    expect(mockVideoPlayer.pause.mock.calls.length).toBe(pauseAufrufeBeimOeffnen);
    expect(screen.getByTestId('kommentar-eingabe')).toBeTruthy(); // Sheet weiterhin offen
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

  // "Halten = Pause" darf sich nicht auf den Fortschrittsbalken beschränken,
  // sonst liefen Bild und Ton eines Videos unbeirrt weiter, während die
  // Anzeige stillsteht. Ein Mutant, der `player.pause()`/`player.play()` aus
  // VideoMoment entfernt, liesse diesen Test fallen.
  test('Halten pausiert auch die tatsächliche Videowiedergabe, Loslassen setzt sie fort', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, Video
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    expect(mockVideoPlayer.pause).not.toHaveBeenCalled();

    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    expect(mockVideoPlayer.pause).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(400); // lang genug für "Halten", nicht für "Tipp"
    });
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut');
    // play() lief schon einmal beim Erzeugen des Players (Setup), nach dem
    // Loslassen kommt ein ZWEITER Aufruf hinzu, der das Fortsetzen ist.
    expect(mockVideoPlayer.play.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  // Vertrag 4, Kernfall: OHNE ein echtes player.pause() könnte ein Video
  // während einer Halten-Geste unbeirrt zu Ende laufen und `playToEnd`
  // feuern, weiterAutomatisch MUSS dann trotzdem mit pausiert:false enden,
  // sonst bliebe der NÄCHSTE Moment lautlos hängen (das war der explizite
  // Auftrag: "Bei jedem programmatischen Weiterschalten musst du
  // pausiert:false selbst setzen: Video-Ende, …").
  test('feuert playToEnd ausnahmsweise während einer Halten-Geste, bleibt der nächste Moment nicht stumm stehen', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, Video
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn'); // pausiert:true
    await act(async () => {
      mockListeners.playToEnd?.forEach((cb) => cb());
    });
    // p3 ist jetzt aktiv, der Auto-Vorschub-Timer für p3 muss laufen, sonst
    // bliebe der Player stehen, obwohl niemand mehr hält.
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p3').medium_url });
    await act(async () => {
      jest.advanceTimersByTime(5000); // FOTO_DAUER_MS
    });
    expect(screen.getByTestId('player-zwischenkarte')).toBeTruthy(); // p3 -> p4, Tageswechsel
  });

  test('ein Video, das nicht lädt, zeigt nach einem stillen Neuversuch Thumbnail und Hinweis, Weitertippen bleibt möglich', async () => {
    mockParams = { id: 't1', start: '1' }; // p2
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();

    // Erster Fehlschlag: V10 verlangt einen STILLEN Neuversuch, noch kein Hinweistext.
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

    // Der Recap bricht trotzdem nicht ab, Weitertippen funktioniert weiter.
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut');
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p3').medium_url });
  });

  // Klein (Review-Fund): versuchtRef/fehlgeschlagen überlebten bisher ein
  // frisches laden() (z.B. Wechsel der Reise-ID auf derselben Screen-
  // Instanz), ein Moment, der beim vorherigen Anlauf zweimal scheiterte,
  // bekam dann NIE WIEDER einen stillen Neuversuch.
  test('ein frisches Laden setzt den Fehlschlags-Zustand zurück, derselbe Moment bekommt wieder einen stillen Neuversuch', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, Video
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
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

    // Ein frischer Ladevorgang (hier: Wechsel der Reise-ID auf derselben
    // Komponenten-Instanz, `laden` bekommt dadurch eine neue Identität).
    mockParams = { id: 't2', start: '1' };
    await rerender(<RecapPlayer />);
    await act(async () => {});
    expect(screen.queryByText('Dieses Video lässt sich gerade nicht laden.')).toBeNull();
  });

  // Wichtig 2 (Review-Fund): der Stale-Guard in videoZuEnde. p2s
  // playToEnd-Callback wird VOR dem Weiterschalten festgehalten, die
  // REGISTRIERUNG wird beim Moment-Wechsel überschrieben (neue
  // Video-Instanz für p3), das Callback-OBJEKT selbst bleibt aber gültig
  // und simuliert damit ein Event, das aus Native erst NACH dem Commit auf
  // den nächsten Moment eintrifft.
  test('ein verspätetes playToEnd für einen bereits verlassenen Moment schaltet NICHT ein zweites Mal weiter', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, Video
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    const p2EndeCallback = mockListeners.playToEnd[0];
    expect(p2EndeCallback).toBeTruthy();

    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut'); // p2 -> p3
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p3').medium_url });

    // Das verspätete Event von p2 trifft jetzt ein.
    await act(async () => {
      p2EndeCallback();
    });
    // OHNE die Stale-Guard würde weiterAutomatisch aus dem AKTUELLEN
    // (p3-)Snapshot rechnen und ein zweites Mal weiterschalten (-> p4),
    // obwohl niemand getippt hat.
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p3').medium_url });
  });

  // M11 (Review-Fund): dieselbe Stale-Guard fehlte auch am Ende von
  // beiLadefehler, eine verspätete Neuversuch-Antwort für einen
  // VERLASSENEN Moment durfte das eigenständig gesetzte Pausieren des
  // INZWISCHEN AKTIVEN Moments nicht überschreiben.
  test('eine verspätete Neuversuch-Antwort für einen verlassenen Moment überschreibt das Pausieren des neuen Moments nicht', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, Video
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    let neuversuchAufloesen: (v: unknown) => void = () => {};
    (holeVorrat as jest.Mock)
      .mockResolvedValueOnce({ vorrat: VORRAT_OK, error: null, grund: null }) // initiales Laden
      .mockReturnValueOnce(new Promise((resolve) => { neuversuchAufloesen = resolve; })); // Neuversuch hängt
    await wrap();
    await act(async () => {
      mockListeners.statusChange?.forEach((cb) => cb({ status: 'error' })); // löst den (hängenden) Neuversuch für p2 aus
    });
    // Nutzer navigiert währenddessen weiter (kurzer Tipp) ...
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut'); // -> p3
    // ... und hält jetzt auf dem NEUEN Moment.
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    // Die verspätete Antwort für p2 trifft jetzt ein.
    await act(async () => {
      neuversuchAufloesen({ vorrat: VORRAT_OK });
    });
    // p3 bleibt trotzdem pausiert, der Auto-Vorschub darf nicht anlaufen,
    // selbst wenn die volle Fotodauer vergeht.
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p3').medium_url });
  });

  // Final-Review Phase-5-Nachbesserung: der Test oben prüft nur, dass eine
  // verspätete Neuversuch-Antwort ein UNABHÄNGIG gesetztes Halten nicht
  // überschreibt, er sagt nichts darüber, ob der Player nach einem
  // WEITERGETIPPTEN Neuversuch je wieder anläuft. Genau das war die Lücke:
  // 'neuversuch' blieb ohne ein `pressOut` auf dem NEUEN Moment für immer
  // gesetzt (keine Stelle nahm es je zurück, wenn die Stale-Guard in
  // beiLadefehler einmal fehlschlug). Dieser Test tippt NUR weiter, hält
  // NICHT erneut, und verlangt den tatsächlichen WIEDERANLAUF: der
  // Auto-Vorschub muss den neuen Moment nach dessen Fotodauer verlassen.
  test('eine verspätete Neuversuch-Antwort blockiert den neuen Moment NICHT dauerhaft, der Auto-Vorschub läuft normal weiter', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, Video
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    let neuversuchAufloesen: (v: unknown) => void = () => {};
    (holeVorrat as jest.Mock)
      .mockResolvedValueOnce({ vorrat: VORRAT_OK, error: null, grund: null }) // initiales Laden
      .mockReturnValueOnce(new Promise((resolve) => { neuversuchAufloesen = resolve; })); // Neuversuch hängt
    await wrap();
    await act(async () => {
      mockListeners.statusChange?.forEach((cb) => cb({ status: 'error' })); // löst den (hängenden) Neuversuch für p2 aus
    });
    // Nutzer tippt (kurz) weiter, OHNE danach zu halten -> p3. Unter dem
    // alten Code blieb 'neuversuch' hier unentfernt hängen.
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut');
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p3').medium_url });

    // Die verspätete Antwort für p2 trifft jetzt ein, darf p3 NICHT
    // dauerhaft stilllegen (Stale-Guard greift: aktivIdRef zeigt auf p3,
    // nicht mehr auf p2, die Rücknahme in beiLadefehler selbst bleibt also
    // aus, entscheidend ist, dass der Tipp oben 'neuversuch' bereits
    // zurückgenommen hat).
    await act(async () => {
      neuversuchAufloesen({ vorrat: VORRAT_OK });
    });

    // p3 läuft normal weiter: nach Ablauf seiner Fotodauer schaltet der
    // Auto-Vorschub TATSÄCHLICH weiter (p3 -> p4 kreuzt einen Tageswechsel,
    // die Zwischenkarte für Tag 2 erscheint statt sofort p4s Foto, aber
    // p4s FotoMoment ist bereits gemountet und trägt dessen source; genau
    // DAS beweist, dass weiterAutomatisch überhaupt gefeuert hat). Bliebe
    // 'neuversuch' hängen, stünde der Player hier für immer auf p3 (siehe
    // der jetzt widerlegte Bug).
    await act(async () => {
      jest.advanceTimersByTime(5000); // FOTO_DAUER_MS
    });
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p4').medium_url });
  });
});

function bildErneuert(id: string) {
  return {
    post_id: id,
    medium_url: `https://cdn.example/${id}-medium-erneuert.jpg`,
    thumb_url: `https://cdn.example/${id}-thumb-erneuert.jpg`,
  };
}
const VORRAT_ERNEUERT = {
  urls: new Map([['p1', bildErneuert('p1')], ['p2', bildErneuert('p2')], ['p3', bildErneuert('p3')], ['p4', bildErneuert('p4')]]),
  gueltigBis: Date.now() + 999_999,
  ausgelassen: 0,
};

describe('Vorrats-Erneuerung (V10)', () => {
  // M3 (Review-Fund): der vorherige Test zählte nur holeVorrat-Aufrufe; der
  // Ersatzvorrat trug dieselben URLs wie zuvor, ein Löschen von setUrls()/
  // setGueltigBis() nach der Erneuerung blieb dadurch unbemerkt. Diese
  // Fassung verwendet einen ERNEUERTEN Vorrat mit ANDEREN URLs und prüft,
  // dass genau diese neuen URLs tatsächlich gerendert werden, der Kern von
  // V10 ist, dass die Erneuerung ANKOMMT, nicht nur stattfindet.
  test('ein bald ablaufender Vorrat wird erneuert, und die NEUEN URLs kommen tatsächlich an', async () => {
    mockParams = { id: 't1', start: '1' }; // p2 -> p3, kein Tageswechsel
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    const baldAblaufend = { urls: VORRAT_OK.urls, gueltigBis: Date.now() + 60_000, ausgelassen: 0 }; // < 5-Min-Schwelle
    (holeVorrat as jest.Mock)
      .mockResolvedValueOnce({ vorrat: baldAblaufend, error: null, grund: null })
      .mockResolvedValue({ vorrat: VORRAT_ERNEUERT, error: null, grund: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut');
    await act(async () => {});
    expect(holeVorrat).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bildErneuert('p3').medium_url });
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

  // Klein (Review-Fund): "vor jedem Weiter" schliesst ein zurueck() nicht
  // aus, der Player bleibt auch beim Zurückblättern auf denselben Vorrat
  // angewiesen.
  test('auch ein Tipp nach links (zurueck) stösst die Erneuerung an, wenn der Vorrat bald abläuft', async () => {
    mockParams = { id: 't1', start: '2' }; // p3
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    const baldAblaufend = { urls: VORRAT_OK.urls, gueltigBis: Date.now() + 60_000, ausgelassen: 0 };
    (holeVorrat as jest.Mock)
      .mockResolvedValueOnce({ vorrat: baldAblaufend, error: null, grund: null })
      .mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-links'), 'pressIn');
    await fireEvent(screen.getByTestId('player-links'), 'pressOut');
    await act(async () => {});
    expect(holeVorrat).toHaveBeenCalledTimes(2);
  });

  // M10 (Review-Fund): erneuerungLaeuftRef verhindert, dass zwei nahezu
  // gleichzeitige Anstösse (hier: zwei schnelle Tipps, während die erste
  // Erneuerung noch unterwegs ist) die Erneuerung doppelt lostreten.
  test('zwei rasch aufeinanderfolgende Tipps stossen die Erneuerung nur EINMAL an, solange die erste noch läuft', async () => {
    mockParams = { id: 't1', start: '0' };
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    const baldAblaufend = { urls: VORRAT_OK.urls, gueltigBis: Date.now() + 60_000, ausgelassen: 0 };
    let aufloesen: (v: unknown) => void = () => {};
    (holeVorrat as jest.Mock)
      .mockResolvedValueOnce({ vorrat: baldAblaufend, error: null, grund: null })
      .mockReturnValueOnce(new Promise((resolve) => { aufloesen = resolve; }));
    await wrap();
    await fireEvent.press(screen.getByTestId('player-zwischenkarte'));
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut'); // löst die (hängende) Erneuerung aus
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut'); // zweiter Tipp, Erneuerung läuft noch
    expect(holeVorrat).toHaveBeenCalledTimes(2); // 1x initiales Laden, NUR 1x Erneuerung
    await act(async () => {
      aufloesen({ vorrat: VORRAT_OK });
    });
  });
});

describe('Vorladen (V8)', () => {
  test('lädt die nächsten drei Fotos vor, ein Video dazwischen zählt nicht mit', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap(); // start=0 (p1) -> Nachfolger p2(Video),p3,p4 -> nur p3/p4 sind Fotos
    expect(mockPrefetch).toHaveBeenCalledWith([bild('p3').medium_url, bild('p4').medium_url]);
  });

  // M2 (Review-Fund): mit nur 4 Momenten insgesamt liess sich VORLADEN_ANZAHL
  // (3) nicht von z.B. 10 unterscheiden, `.slice(1, 11)` auf einer
  // 4-elementigen Liste liefert dieselben restlichen Elemente wie
  // `.slice(1, 4)`. Diese Fixture hat SECHS FOTOS nach dem Start, damit eine
  // zu grosszügige Vorlade-Anzahl sichtbar wird.
  test('lädt NICHT mehr als die nächsten drei Fotos vor, auch wenn mehr verfügbar wären', async () => {
    const viele = ['a', 'b', 'c', 'd', 'e', 'f'].map((buchstabe, i) =>
      moment({ id: `f${buchstabe}`, captured_at: `2026-08-10T0${i + 1}:00:00.000Z` })
    );
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: viele, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({
      vorrat: {
        urls: new Map(viele.map((m) => [m.id, bild(m.id)])),
        gueltigBis: Date.now() + 999_999,
        ausgelassen: 0,
      },
      error: null,
      grund: null,
    });
    await wrap(); // start=0 (fa) -> Nachfolger fb..ff (5 Fotos) -> nur die ersten DREI (fb,fc,fd)
    expect(mockPrefetch).toHaveBeenCalledWith([bild('fb').medium_url, bild('fc').medium_url, bild('fd').medium_url]);
    expect(mockPrefetch).not.toHaveBeenCalledWith(
      expect.arrayContaining([bild('fe').medium_url, bild('ff').medium_url])
    );
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

  // Klein (Review-Fund): RN-Pressability feuert onPressOut auf einer
  // Tipp-Zone AUCH DANN, wenn der PanResponder den Touch währenddessen per
  // Responder-Terminierung übernommen hat (Beginn eines echten Wischs),
  // das ist kein echtes Loslassen. Wir simulieren die Übernahme direkt über
  // `onPanResponderGrant`, ohne rohe Touch-Koordinaten nachzubilden (die in
  // RNTL ohnehin nicht real Geometrie/Hit-Testing durchlaufen).
  test('ein vom PanResponder übernommener Touch löst KEINE zusätzliche Tipp-Navigation aus', async () => {
    const createSpy = jest.spyOn(PanResponder, 'create');
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-zwischenkarte')); // Karte weg, Tipp-Zonen frei
    const config = createSpy.mock.calls[0][0];
    // Touch beginnt auf der Tipp-Zone (wie ein echter Wisch, der dort
    // startet), ohne dieses pressIn bliebe `beruehrungStartRef` auf 0 und
    // "gehalten" wäre riesig, der Test würde dann selbst OHNE die Sperre
    // zufällig grün bleiben (über den Halten-statt-Tipp-Zweig).
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await act(async () => {
      config.onPanResponderGrant?.({} as never, {} as never); // der Wisch übernimmt den Touch
    });
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut'); // Pressability feuert trotzdem, sofort danach
    // Keine Navigation: immer noch p1.
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p1').medium_url });
    createSpy.mockRestore();
  });

  // Gegenprobe: eine NEUE Berührung (onPressIn) setzt die Übernahme-Sperre
  // wieder zurück, ein Wisch darf nicht dauerhaft jede künftige Navigation
  // blockieren.
  test('nach einer neuen Berührung funktioniert die Tipp-Navigation wieder normal', async () => {
    const createSpy = jest.spyOn(PanResponder, 'create');
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-zwischenkarte'));
    const config = createSpy.mock.calls[0][0];
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await act(async () => {
      config.onPanResponderGrant?.({} as never, {} as never);
    });
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut'); // vom Wisch geschluckt
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn'); // neue Berührung
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut');
    // p1 -> p2, und p2 ist ein Video (nicht 'player-foto').
    expect(screen.getByTestId('player-video')).toBeTruthy();
    createSpy.mockRestore();
  });

  // Der zweite Teil desselben Bugs: ein erfolgreicher Schliess-Wisch durfte
  // NICHT gleichzeitig auch noch weiter()/zurueck() auslösen. Die
  // PanResponder-Release-Logik selbst wird direkt am Config-Objekt geprüft
  // (Review-Vorschlag), ohne Touch-Simulation, dafür präzise auf die
  // 120-px-Schwelle.
  test('Wisch-Release schliesst ab der Schwelle, darunter federt er zurück, ohne Touch-Simulation direkt am Config geprüft', async () => {
    const createSpy = jest.spyOn(PanResponder, 'create');
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    const config = createSpy.mock.calls[0][0];
    await act(async () => {
      config.onPanResponderRelease?.({} as never, { dy: 121 } as never);
    });
    expect(mockBack).toHaveBeenCalled();
    mockBack.mockClear();
    await act(async () => {
      config.onPanResponderRelease?.({} as never, { dy: 50 } as never); // federt per Spring zurück
    });
    expect(mockBack).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });
});

// M9 (Review-Fund): der Kino-Fade (DESIGN-LANGUAGE §5, "das Licht geht aus")
// hatte keinen einzigen Test, Effekt UND Wert liessen sich vollständig
// löschen, ohne dass etwas fiel.
describe('Kino-Fade beim Betreten ("das Licht geht aus")', () => {
  test('animiert von 1 nach 0 über 350ms', async () => {
    const timingSpy = jest.spyOn(Animated, 'timing');
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    const fadeAufruf = timingSpy.mock.calls.find(([, config]) => config.toValue === 0 && config.duration === 350);
    expect(fadeAufruf).toBeTruthy();
    timingSpy.mockRestore();
  });

  // Phase-5-Final-Review, Punkt 3 (Review-Fund): dieser Test war grün, WEIL
  // der alte Mock `reducedMotion` synchron auf `true` setzte, mit `[]`-Deps
  // im Player-Effekt (der eigentliche Bug) UND mit `[reducedMotion]`-Deps
  // (der Fix) liefert ein synchron auf `true` gemockter Hook nämlich
  // GENAU DASSELBE Ergebnis (der Effekt läuft beim allerersten, einzigen
  // Commit bereits mit `reducedMotion=true`), der Mock konnte den Bug also
  // gar nicht aufdecken. Dieser Test bildet die reale Reihenfolge nach: der
  // Player mountet zuerst mit `reducedMotion=false` (Hook-Vertrag, siehe
  // useReducedMotion.ts), der normale 350-ms-Aufruf feuert. ERST danach
  // löst der Hook (asynchron, wie in Produktion) auf `true` auf; nur ein
  // Effekt, der wirklich an `reducedMotion` hängt, feuert dann einen
  // ZWEITEN, 200-ms-Aufruf. Gegen den alten `[]`-Deps-Code (von Hand
  // ausser Kraft gesetzt, siehe Bericht) bleibt dieser zweite Aufruf aus,
  // der Test wird dort korrekt rot.
  test('verkürzt sich auf 200ms, sobald der Hook reduced motion ERST NACH dem Mount meldet', async () => {
    const timingSpy = jest.spyOn(Animated, 'timing');
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    // Direkt nach dem Mount ist reducedMotion noch false (Hook-Vertrag), nur
    // der normale 350-ms-Aufruf ist bislang passiert.
    expect(timingSpy.mock.calls.some(([, config]) => config.toValue === 0 && config.duration === 200)).toBe(false);
    mockReducedMotionAufloesen(true);
    await act(async () => {});
    const fadeAufruf = timingSpy.mock.calls.find(([, config]) => config.toValue === 0 && config.duration === 200);
    expect(fadeAufruf).toBeTruthy();
    timingSpy.mockRestore();
  });
});

// Ein steuerbares Promise, um "die Antwort ist noch nicht da" nachzustellen
// (optimistisches Setzen prüfen, ohne das echte Timing zu kennen).
function unaufgeloest<T>(): { promise: Promise<T>; loese: (wert: T) => void } {
  let loese!: (wert: T) => void;
  const promise = new Promise<T>((res) => {
    loese = res;
  });
  return { promise, loese };
}

describe('Reaktionen (Task 12)', () => {
  // Fix-Runde 2 (Review-Korrektur): entgegen einer früheren, falschen Notiz
  // im Code IST das sehr wohl prüfbar, gleiches Muster wie der
  // Zwischenkarten-zIndex-Test aus der Task-11-Fixrunde
  // ("die Zwischenkarte liegt per zIndex über den Tipp-Zonen..."):
  // `StyleSheet.flatten` auf die tatsächlichen Style-Props, kein
  // Hit-Testing nötig.
  test('die Reaktionen/der Kommentar-Knopf liegen per zIndex über den Tipp-Zonen, unabhängig von der Render-Reihenfolge im Baum', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    const sozial = StyleSheet.flatten(screen.getByTestId('player-sozial-bereich').props.style);
    const links = StyleSheet.flatten(screen.getByTestId('player-links').props.style);
    const rechts = StyleSheet.flatten(screen.getByTestId('player-rechts').props.style);
    expect(sozial.zIndex).toBeGreaterThan(links.zIndex ?? 0);
    expect(sozial.zIndex).toBeGreaterThan(rechts.zIndex ?? 0);
  });

  test('lädt die Reaktionen für ALLE Momente der Spielliste in einem einzigen Aufruf', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    expect(fetchReaktionen).toHaveBeenCalledTimes(1);
    expect(fetchReaktionen).toHaveBeenCalledWith(['p1', 'p2', 'p3', 'p4']);
  });

  test('ein Tipp zeigt die Reaktion SOFORT, ohne auf die Antwort zu warten', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    const { promise, loese } = unaufgeloest<{ error: string | null }>();
    (setzeReaktion as jest.Mock).mockReturnValue(promise); // absichtlich NICHT aufgelöst

    await wrap();
    expect(screen.getByTestId('player-emoji-herz').props.accessibilityState.selected).toBe(false);

    await fireEvent.press(screen.getByTestId('player-emoji-herz'));
    // Ohne jedes Warten auf `promise`, die Pille muss JETZT schon aktiv sein.
    expect(screen.getByTestId('player-emoji-herz').props.accessibilityState.selected).toBe(true);
    expect(mockHaptics).toHaveBeenCalledWith('light');

    await act(async () => {
      loese({ error: null });
    });
    expect(screen.getByTestId('player-emoji-herz').props.accessibilityState.selected).toBe(true);
  });

  test('scheitert das Setzen, verschwindet die Reaktion wieder und die Ursache steht kurz da', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    const { promise, loese } = unaufgeloest<{ error: string | null }>();
    (setzeReaktion as jest.Mock).mockReturnValue(promise);

    await wrap();
    await fireEvent.press(screen.getByTestId('player-emoji-herz'));
    // Optimistisch: noch VOR der Antwort schon aktiv.
    expect(screen.getByTestId('player-emoji-herz').props.accessibilityState.selected).toBe(true);

    await act(async () => {
      loese({ error: 'Deine Reaktion konnte nicht gespeichert werden. Probier es gleich nochmal.' });
    });
    // Rücknahme: die Pille ist wieder inaktiv, UND die Ursache steht da.
    expect(screen.getByTestId('player-emoji-herz').props.accessibilityState.selected).toBe(false);
    expect(
      screen.getByText('Deine Reaktion konnte nicht gespeichert werden. Probier es gleich nochmal.')
    ).toBeTruthy();
  });

  test('ein schneller Doppeltipp auf dasselbe Emoji löst nur EINE Anfrage aus', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    const { promise, loese } = unaufgeloest<{ error: string | null }>();
    (setzeReaktion as jest.Mock).mockReturnValue(promise);

    await wrap();
    const pille = screen.getByTestId('player-emoji-herz');
    // Zwei Tipps, WÄHREND die Antwort auf den ersten noch aussteht (die
    // Anfrage bleibt bis zum manuellen `loese` unten hängen), genau das
    // pathologische "schneller Doppeltipp" aus dem Auftrag. Der Schutz in
    // tippeEmoji ist rein synchron (Set.has/Set.add), er braucht dafür
    // keine echte Gleichzeitigkeit der beiden Presses, nur dass BEIDE
    // eintreffen, bevor `setzeReaktion` beantwortet ist.
    await fireEvent.press(pille);
    await fireEvent.press(pille);
    expect(setzeReaktion).toHaveBeenCalledTimes(1);

    await act(async () => {
      loese({ error: null });
    });
    expect(setzeReaktion).toHaveBeenCalledTimes(1);
  });

  test('ein zweiter Tipp auf eine bereits eigene Reaktion entfernt sie wieder (Toggle)', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    (fetchReaktionen as jest.Mock).mockResolvedValue({
      data: { p1: [{ post_id: 'p1', user_id: 'u1', emoji: '❤️' }] },
      error: null,
    });
    (entferneReaktion as jest.Mock).mockResolvedValue({ error: null });

    await wrap();
    expect(screen.getByTestId('player-emoji-herz').props.accessibilityState.selected).toBe(true);

    await fireEvent.press(screen.getByTestId('player-emoji-herz'));
    // Sofort (optimistisch) inaktiv, entferneReaktion NICHT setzeReaktion.
    expect(screen.getByTestId('player-emoji-herz').props.accessibilityState.selected).toBe(false);
    expect(entferneReaktion).toHaveBeenCalledWith('p1', '❤️');
    expect(setzeReaktion).not.toHaveBeenCalled();
  });

  test('scheitert das Entfernen, taucht die Reaktion wieder auf', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    (fetchReaktionen as jest.Mock).mockResolvedValue({
      data: { p1: [{ post_id: 'p1', user_id: 'u1', emoji: '❤️' }] },
      error: null,
    });
    const { promise, loese } = unaufgeloest<{ error: string | null }>();
    (entferneReaktion as jest.Mock).mockReturnValue(promise);

    await wrap();
    await fireEvent.press(screen.getByTestId('player-emoji-herz'));
    // Optimistisch: noch VOR der Antwort schon inaktiv.
    expect(screen.getByTestId('player-emoji-herz').props.accessibilityState.selected).toBe(false);

    await act(async () => {
      loese({ error: 'Deine Reaktion konnte nicht entfernt werden. Probier es gleich nochmal.' });
    });
    expect(screen.getByTestId('player-emoji-herz').props.accessibilityState.selected).toBe(true);
    expect(
      screen.getByText('Deine Reaktion konnte nicht entfernt werden. Probier es gleich nochmal.')
    ).toBeTruthy();
  });

  test('Reaktionen anderer Personen erscheinen dezent, nur die Emojis, kein Name, kein Zähler', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    (fetchReaktionen as jest.Mock).mockResolvedValue({
      data: {
        p1: [
          { post_id: 'p1', user_id: 'u2', emoji: '😂' },
          { post_id: 'p1', user_id: 'u3', emoji: '😂' }, // dedupliziert
          { post_id: 'p1', user_id: 'u2', emoji: '👏' },
        ],
      },
      error: null,
    });
    await wrap();
    expect(screen.getByTestId('player-reaktionen-andere')).toBeTruthy();
    expect(screen.getByText('😂 👏')).toBeTruthy();
    expect(screen.queryByText('Jonas')).toBeNull();
  });

  test('kein Emoji der anderen wird angezeigt, solange nur die eigene Person reagiert hat', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    (fetchReaktionen as jest.Mock).mockResolvedValue({
      data: { p1: [{ post_id: 'p1', user_id: 'u1', emoji: '❤️' }] },
      error: null,
    });
    await wrap();
    expect(screen.queryByTestId('player-reaktionen-andere')).toBeNull();
  });

  // Fix-Runde 1, Mutation A aus dem Review: ohne den `user_id === userId`-
  // Filter in `eigeneEmojis` würde JEDE Reaktion auf dem Moment, egal von
  // wem, die eigene Pille aktiv färben. Effekt in Produktion: 😂 leuchtet
  // als "meine" Reaktion, obwohl sie von Jonas stammt, und ein Tipp darauf
  // löscht seine statt selbst zu reagieren.
  test('eine FREMDE Reaktion auf ein Emoji der Leiste färbt die eigene Pille NICHT aktiv', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    (fetchReaktionen as jest.Mock).mockResolvedValue({
      data: { p1: [{ post_id: 'p1', user_id: 'u2', emoji: '😂' }] }, // Jonas, nicht ich (u1)
      error: null,
    });
    (setzeReaktion as jest.Mock).mockResolvedValue({ error: null });

    await wrap();
    expect(screen.getByTestId('player-emoji-lachen').props.accessibilityState.selected).toBe(false);

    // Ein Tipp auf 😂 muss deshalb SETZEN, nicht Jonas' Reaktion entfernen.
    await fireEvent.press(screen.getByTestId('player-emoji-lachen'));
    expect(setzeReaktion).toHaveBeenCalledWith('p1', '😂');
    expect(entferneReaktion).not.toHaveBeenCalled();
  });

  // Fix-Runde 1, Mutation D aus dem Review: ohne den aktivIdRef-Abgleich
  // beim Rollback würde ein Fehler zu einem längst verlassenen Moment auf
  // dem FALSCHEN, inzwischen aktiven Moment aufblitzen.
  test('ein Reaktionsfehler zu einem verlassenen Moment erscheint NICHT auf dem inzwischen aktiven Moment', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, kein Tageswechsel zu p3
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    const { promise, loese } = unaufgeloest<{ error: string | null }>();
    (setzeReaktion as jest.Mock).mockReturnValue(promise);

    await wrap();
    await fireEvent.press(screen.getByTestId('player-emoji-herz')); // reagiert auf p2, hängt
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut'); // weiter zu p3

    await act(async () => {
      loese({ error: 'Deine Reaktion konnte nicht gespeichert werden. Probier es gleich nochmal.' });
    });
    expect(
      screen.queryByText('Deine Reaktion konnte nicht gespeichert werden. Probier es gleich nochmal.')
    ).toBeNull();
  });

  // Klein 4 aus dem Review: ein verschluckter Ladefehler liess jeden Moment
  // fälschlich reaktionslos wirken, ohne dass die Person je erfahren hätte,
  // warum.
  test('ein Ladefehler der Reaktionen wird angezeigt, statt verschluckt zu werden', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    (fetchReaktionen as jest.Mock).mockResolvedValue({
      data: {},
      error: 'Die Reaktionen konnten nicht geladen werden. Probier es gleich nochmal.',
    });
    await wrap();
    expect(
      screen.getByText('Die Reaktionen konnten nicht geladen werden. Probier es gleich nochmal.')
    ).toBeTruthy();
  });

  // Klein 5 aus dem Review: sozialApi fängt jeden ERWARTETEN Fehlerpfad
  // selbst ab (liefert { error }, wirft nicht), ein echtes reject() ist der
  // unerwartete Rest. Ohne das eigene .catch() bliebe der Pending-Schlüssel
  // für immer belegt, dieses Emoji auf diesem Moment liesse sich nie wieder
  // antippen.
  test('ein tatsächlich abgelehntes Promise (nicht nur { error }) rollt zurück und gibt das Emoji wieder frei', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    (setzeReaktion as jest.Mock).mockRejectedValueOnce(new Error('unerwarteter Absturz'));
    (setzeReaktion as jest.Mock).mockResolvedValueOnce({ error: null });

    await wrap();
    // Anders als bei den obigen Rücknahme-Tests bewusst OHNE Zwischen-
    // Assertion auf den optimistischen Zustand: ein bereits ABGELEHNTES
    // Promise (mockRejectedValueOnce) löst genauso schnell auf wie ein
    // bereits AUFGELÖSTES, der Rollback ist zum Zeitpunkt des awaiteten
    // fireEvent.press schon gelaufen (dieselbe Lehre wie bei "scheitert das
    // Setzen" weiter oben, das ursprünglich denselben Fehler hatte). Hier
    // zählt allein das Endergebnis: Rollback UND Fehlermeldung UND ein
    // freigegebener Pending-Schlüssel.
    await fireEvent.press(screen.getByTestId('player-emoji-herz'));

    await act(async () => {});
    // Rollback nach der Ablehnung, UND eine Fehlermeldung statt einer
    // Unhandled Rejection.
    expect(screen.getByTestId('player-emoji-herz').props.accessibilityState.selected).toBe(false);
    expect(
      screen.getByText('Deine Reaktion konnte nicht gespeichert werden. Probier es gleich nochmal.')
    ).toBeTruthy();

    // Der Pending-Schlüssel wurde freigegeben: ein erneuter Tipp löst eine
    // ZWEITE Anfrage aus, statt für immer gesperrt zu bleiben.
    await fireEvent.press(screen.getByTestId('player-emoji-herz'));
    expect(setzeReaktion).toHaveBeenCalledTimes(2);
  });
});

describe('Kommentar-Sheet (Task 12)', () => {
  test('öffnet das Sheet, lädt die Kommentare des aktiven Moments und pausiert den Player', async () => {
    mockParams = { id: 't1', start: '2' }; // p3
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    (fetchKommentare as jest.Mock).mockResolvedValue({
      data: [{ id: 'c1', post_id: 'p3', user_id: 'u2', text: 'Wow!', created_at: 't', autor_name: 'Jonas' }],
      error: null,
    });
    await wrap();

    await fireEvent.press(screen.getByTestId('player-kommentare-oeffnen'));
    await act(async () => {});
    expect(fetchKommentare).toHaveBeenCalledWith('p3');
    expect(screen.getByText('Jonas')).toBeTruthy();
    expect(screen.getByText('Wow!')).toBeTruthy();

    // Pausiert: selbst nach Ablauf der vollen Fotodauer bleibt p3 stehen.
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p3').medium_url });

    // Schliessen (Sheet-Backdrop-Tipp) setzt pausiert wieder zurück, der
    // Auto-Vorschub läuft danach normal weiter, ohne dass irgendetwas
    // anderes ihn manuell wieder anstossen müsste.
    await fireEvent.press(screen.getByTestId('sheet-backdrop'));
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('player-zwischenkarte')).toBeTruthy(); // p3 -> p4, Tageswechsel
  });

  // Wichtig 3 aus dem Review: eine noch laufende Sendung für einen
  // VERLASSENEN Moment (Sheet geschlossen, während schreibeKommentar noch
  // unterwegs war) darf den Senden-Knopf einer NEUEN Sitzung nicht für den
  // Rest der Player-Sitzung als "sendet gerade" (Spinner, disabled) stehen
  // lassen, ihre eigene, spät eintreffende Antwort trifft auf den
  // Stale-Guard in kommentarAbsenden und würde `kommentarSendetLaeuft`
  // sonst nie mehr zurücksetzen.
  test('eine hängende Sendung für einen verlassenen Moment lässt den Senden-Knopf einer neu geöffneten Sitzung nicht für immer als "sendet" stehen', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    (fetchKommentare as jest.Mock).mockResolvedValue({ data: [], error: null });
    const { promise } = unaufgeloest<{ error: string | null }>();
    (schreibeKommentar as jest.Mock).mockReturnValue(promise); // bleibt für p1 hängen

    await wrap(); // start=0 -> p1
    await fireEvent.press(screen.getByTestId('player-zwischenkarte')); // Tag-1-Karte weg
    await fireEvent.press(screen.getByTestId('player-kommentare-oeffnen')); // öffnet für p1
    await act(async () => {});
    await fireEvent.changeText(screen.getByTestId('kommentar-eingabe'), 'Hallo');
    await fireEvent.press(screen.getByTestId('kommentar-senden')); // sendetLaeuft=true, hängt

    await fireEvent.press(screen.getByTestId('sheet-backdrop')); // schliessen, OHNE auf die Antwort zu warten
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut'); // weiter zu p2
    await fireEvent.press(screen.getByTestId('player-kommentare-oeffnen')); // neu öffnen für p2
    await act(async () => {});

    // Fixiert: der Knopf zeigt "Senden", nicht dauerhaft den Spinner.
    expect(screen.getByText('Senden')).toBeTruthy();
  });

  // Review-Fund, Fix-Runde 2: der ursprüngliche Fix (Runde 1) hat bei JEDEM
  // Öffnen zurückgesetzt, auch beim Wiederöffnen DESSELBEN Moments,
  // während schreibeKommentar für GENAU DIESEN Moment noch läuft. Das war
  // VOR Runde 1 gar nicht möglich (dort wurde nie zurückgesetzt) und damit
  // eine neue Regression: der Senden-Knopf wäre wieder aktiv geworden,
  // OBWOHL die erste Anfrage noch offen ist, ein zweiter Tipp hätte einen
  // zweiten, überlappenden Versand ausgelöst.
  test('eine hängende Sendung für DENSELBEN Moment bleibt beim Wiederöffnen erkennbar "sendet", kein doppelter Versand möglich', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    (fetchKommentare as jest.Mock).mockResolvedValue({ data: [], error: null });
    const { promise } = unaufgeloest<{ error: string | null }>();
    (schreibeKommentar as jest.Mock).mockReturnValue(promise); // bleibt für p1 hängen

    await wrap(); // start=0 -> p1
    await fireEvent.press(screen.getByTestId('player-zwischenkarte')); // Tag-1-Karte weg
    await fireEvent.press(screen.getByTestId('player-kommentare-oeffnen')); // öffnet für p1
    await act(async () => {});
    await fireEvent.changeText(screen.getByTestId('kommentar-eingabe'), 'Hallo');
    await fireEvent.press(screen.getByTestId('kommentar-senden')); // sendetLaeuft=true, hängt
    expect(schreibeKommentar).toHaveBeenCalledTimes(1);

    // Schliessen (Player bleibt bei p1) und SOFORT wieder öffnen, derselbe
    // Moment, dieselbe noch laufende Sendung.
    await fireEvent.press(screen.getByTestId('sheet-backdrop'));
    await fireEvent.press(screen.getByTestId('player-kommentare-oeffnen'));
    await act(async () => {});

    // Der Knopf zeigt weiterhin den Spinner, nicht "Senden", ein Tipp
    // würde also keinen zweiten Versand auslösen (disabled bleibt aktiv).
    expect(screen.queryByText('Senden')).toBeNull();
    expect(
      screen.getByTestId('kommentar-senden').props.accessibilityState.disabled
    ).toBe(true);
  });

  // Mutationsschutz: ein Mutant, der `pausiert: false` beim Öffnen entfernt
  // (Sheet öffnet, ohne den Player anzuhalten), liesse GENAU diesen Test
  // fallen, ohne ihn würde der obige Test nicht zwingend unterscheiden
  // können, ob "p3 bleibt stehen" am Sheet oder an einem Zufall liegt, weil
  // dort auch andere Timer-Effekte mitspielen könnten.
  test('ein Video pausiert ebenfalls, solange das Sheet offen ist', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, Video
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    const spielVorherAnzahl = mockVideoPlayer.play.mock.calls.length;

    await fireEvent.press(screen.getByTestId('player-kommentare-oeffnen'));
    expect(mockVideoPlayer.pause).toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('sheet-backdrop'));
    expect(mockVideoPlayer.play.mock.calls.length).toBeGreaterThan(spielVorherAnzahl);
  });

  // Review-Fund, Fix-Runde 2: strukturell dieselbe Race wie beim
  // Zwischenkarten-Test oben ("ein Video unter der Zwischenkarte wird
  // wirklich pausiert..."), hier für das Kommentar-Sheet. `oeffneKommentare`
  // setzt `pausiert:true` synchron, VideoMoments echtes `player.pause()`
  // committet aber erst im nächsten Effekt-Durchlauf, ein `playToEnd`, das
  // GENAU in diesem Fenster eintrifft, darf den Player nicht HINTER dem
  // gerade geöffneten Sheet weiterschalten.
  test('ein playToEnd, das GENAU beim Öffnen des Sheets eintrifft, schaltet den Player nicht hinter dem Sheet weiter', async () => {
    mockParams = { id: 't1', start: '1' }; // p2, Video
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    (fetchKommentare as jest.Mock).mockResolvedValue({ data: [], error: null });
    await wrap();
    expect(screen.getByTestId('player-video')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('player-kommentare-oeffnen'));
    // Das Race-Fenster nachgestellt: playToEnd feuert, während das Sheet
    // gerade offen ist.
    await act(async () => {
      mockListeners.playToEnd?.forEach((cb) => cb());
    });
    // Weiterhin p2 (nicht zu p3 gewechselt), UND das Sheet ist weiterhin
    // offen, der Player also nicht heimlich dahinter weitergelaufen.
    expect(screen.getByTestId('player-video')).toBeTruthy();
    expect(screen.getByTestId('sheet-panel')).toBeTruthy();

    // Auch der Fallback-Timer schaltet nicht weiter, solange das Sheet
    // offen bleibt.
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('player-video')).toBeTruthy();

    // Schliessen lässt den Player normal weiterlaufen, kein dauerhafter
    // Stillstand.
    await fireEvent.press(screen.getByTestId('sheet-backdrop'));
    await act(async () => {
      jest.advanceTimersByTime(3000); // dauerFuer(p2) = duration_s(3) * 1000
    });
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p3').medium_url });
  });

  test('eine späte Antwort für einen längst verlassenen Moment überschreibt die Kommentare des NEUEN Moments nicht', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    const { promise: erstePromise, loese: loeseErste } =
      unaufgeloest<{ data: unknown; error: string | null }>();
    (fetchKommentare as jest.Mock)
      .mockReturnValueOnce(erstePromise) // Öffnen für p1, bleibt hängen
      .mockResolvedValueOnce({
        data: [{ id: 'c2', post_id: 'p2', user_id: 'u2', text: 'Zweiter Moment', created_at: 't', autor_name: 'Jonas' }],
        error: null,
      });

    await wrap(); // start=0 -> p1
    await fireEvent.press(screen.getByTestId('player-zwischenkarte')); // Tag-1-Karte weg
    await fireEvent.press(screen.getByTestId('player-kommentare-oeffnen')); // öffnet für p1, hängt
    await fireEvent.press(screen.getByTestId('sheet-backdrop')); // schliessen, läuft weiter

    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut'); // p1 -> p2
    await fireEvent.press(screen.getByTestId('player-kommentare-oeffnen')); // öffnet für p2
    await act(async () => {});
    expect(screen.getByText('Zweiter Moment')).toBeTruthy();

    // Die LÄNGST fällige Antwort für p1 trifft jetzt erst ein, sie darf die
    // bereits angezeigten Kommentare von p2 nicht verdrängen.
    await act(async () => {
      loeseErste({ data: [{ id: 'c1', post_id: 'p1', user_id: 'u2', text: 'Erster Moment', created_at: 't', autor_name: 'Jonas' }], error: null });
    });
    expect(screen.getByText('Zweiter Moment')).toBeTruthy();
    expect(screen.queryByText('Erster Moment')).toBeNull();
  });

  test('ein zu langer Kommentar wird vor dem Absenden abgefangen, schreibeKommentar meldet den Fehler, kein optimistisches Anhängen', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    (schreibeKommentar as jest.Mock).mockResolvedValue({
      error: 'Kommentare dürfen höchstens 500 Zeichen haben.',
    });

    await wrap();
    await fireEvent.press(screen.getByTestId('player-kommentare-oeffnen'));
    await act(async () => {});

    const zuLangerText = 'a'.repeat(501);
    await fireEvent.changeText(screen.getByTestId('kommentar-eingabe'), zuLangerText);
    await fireEvent.press(screen.getByTestId('kommentar-senden'));
    await act(async () => {});

    expect(schreibeKommentar).toHaveBeenCalledWith('p1', zuLangerText);
    expect(screen.getByText('Kommentare dürfen höchstens 500 Zeichen haben.')).toBeTruthy();
    // Kein zweiter fetchKommentare-Aufruf (kein Neuladen bei einem Fehler),
    // der einzige Aufruf ist der beim Öffnen des Sheets.
    expect(fetchKommentare).toHaveBeenCalledTimes(1);
  });

  test('ein erfolgreich gesendeter Kommentar leert das Feld und lädt die Liste neu', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    (schreibeKommentar as jest.Mock).mockResolvedValue({ error: null });
    (fetchKommentare as jest.Mock)
      .mockResolvedValueOnce({ data: [], error: null }) // beim Öffnen
      .mockResolvedValueOnce({
        data: [{ id: 'c1', post_id: 'p1', user_id: 'u1', text: 'Toller Moment!', created_at: 't', autor_name: 'Lea' }],
        error: null,
      });

    await wrap();
    await fireEvent.press(screen.getByTestId('player-kommentare-oeffnen'));
    await act(async () => {});

    await fireEvent.changeText(screen.getByTestId('kommentar-eingabe'), 'Toller Moment!');
    await fireEvent.press(screen.getByTestId('kommentar-senden'));
    await act(async () => {});

    expect(schreibeKommentar).toHaveBeenCalledWith('p1', 'Toller Moment!');
    expect(fetchKommentare).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('kommentar-eingabe').props.value).toBe('');
    expect(screen.getByText('Toller Moment!')).toBeTruthy();
  });
});

// Task 7: «In Galerie sichern» für den aktuellen Moment. exportApi selbst
// ist gemockt (eigene, vollständige Tests in exportApi.test.ts), hier wird
// nur geprüft, dass der Player sie mit dem richtigen Moment/URL aufruft und
// auf jedes ihrer drei Ergebnisse (Erfolg, keine Berechtigung, sonstiger
// Fehler) richtig reagiert.
describe('«In Galerie sichern»', () => {
  beforeEach(() => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
  });

  test('ruft sichereMomentInGalerie mit dem aktiven Moment und seiner MEDIUM-URL (nicht dem Thumbnail) auf', async () => {
    (sichereMomentInGalerie as jest.Mock).mockResolvedValue({ ok: true });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-sichern'));
    await act(async () => {});
    expect(sichereMomentInGalerie).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }),
      expect.objectContaining({ medium_url: bild('p1').medium_url, thumb_url: bild('p1').thumb_url })
    );
  });

  test('Erfolg zeigt eine kurze Bestätigung', async () => {
    (sichereMomentInGalerie as jest.Mock).mockResolvedValue({ ok: true });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-sichern'));
    await act(async () => {});
    expect(await screen.findByTestId('player-export-hinweis')).toHaveTextContent('In der Fotobibliothek gesichert.');
  });

  // Kernfall (Brief, wörtlich): NIE ein stiller Fehlschlag bei fehlender
  // Berechtigung, ein Alert mit Weg in die Einstellungen, nicht nur eine
  // leicht zu übersehende Pille.
  test('fehlende Berechtigung zeigt einen Alert mit Weg in die Einstellungen, keine stille Pille', async () => {
    (sichereMomentInGalerie as jest.Mock).mockResolvedValue({
      ok: false, grund: 'keine_berechtigung', text: 'Reelive braucht Zugriff auf deine Fotobibliothek …',
    });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-sichern'));
    await act(async () => {});
    expect(mockAlertSpion).toHaveBeenCalledWith(
      'Kein Zugriff auf die Fotobibliothek',
      'Reelive braucht Zugriff auf deine Fotobibliothek …',
      expect.any(Array)
    );
    expect(screen.queryByTestId('player-export-hinweis')).toBeNull();
  });

  test('"Einstellungen öffnen" im Alert ruft Linking.openSettings auf', async () => {
    (sichereMomentInGalerie as jest.Mock).mockResolvedValue({
      ok: false, grund: 'keine_berechtigung', text: 'Kein Zugriff.',
    });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-sichern'));
    await act(async () => {});
    const knoepfe = mockAlertSpion.mock.calls[0][2] as AlertKnopf[];
    knoepfe.find((k) => k.text === 'Einstellungen öffnen')?.onPress?.();
    expect(mockOpenSettings).toHaveBeenCalled();
  });

  test('ein sonstiger Fehlschlag (z.B. Netzwerk) zeigt die Ursache als Pille, ohne Alert', async () => {
    (sichereMomentInGalerie as jest.Mock).mockResolvedValue({
      ok: false, grund: 'fehler', text: 'Dieser Moment konnte nicht gesichert werden. Probier es gleich nochmal.',
    });
    await wrap();
    await fireEvent.press(screen.getByTestId('player-sichern'));
    await act(async () => {});
    expect(await screen.findByTestId('player-export-hinweis')).toHaveTextContent(
      'Dieser Moment konnte nicht gesichert werden. Probier es gleich nochmal.'
    );
    expect(mockAlertSpion).not.toHaveBeenCalled();
  });

  test('zeigt einen Ladeindikator, während sichereMomentInGalerie noch läuft', async () => {
    let aufloesen!: (wert: { ok: true }) => void;
    (sichereMomentInGalerie as jest.Mock).mockReturnValue(new Promise((resolve) => { aufloesen = resolve; }));
    await wrap();
    await fireEvent.press(screen.getByTestId('player-sichern'));
    await act(async () => {});
    expect(screen.getByTestId('player-sichern-laedt')).toBeTruthy();
    // Ein zweiter Tipp während des Ladens darf KEINEN zweiten Aufruf
    // auslösen (Doppel-Tipp-Schutz).
    await fireEvent.press(screen.getByTestId('player-sichern'));
    await act(async () => {
      aufloesen({ ok: true });
    });
    expect(sichereMomentInGalerie).toHaveBeenCalledTimes(1);
  });

  // Wechselt der Moment, WÄHREND sichereMomentInGalerie noch für den
  // VORHERIGEN Moment läuft, darf dessen verspätete Antwort weder eine
  // Pille auf dem NEUEN Moment zeigen noch dessen Sichern-Knopf für immer im
  // Ladezustand einfrieren (Stale-Guard, gleiches Prinzip wie beiLadefehler).
  test('eine verspätete Antwort für einen verlassenen Moment zeigt keine Pille auf dem neuen Moment', async () => {
    let aufloesen!: (wert: { ok: true }) => void;
    (sichereMomentInGalerie as jest.Mock).mockReturnValue(new Promise((resolve) => { aufloesen = resolve; }));
    await wrap();
    await fireEvent.press(screen.getByTestId('player-sichern'));
    await act(async () => {});

    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut');
    await act(async () => {});
    // p2 (Video) ist jetzt aktiv statt p1 (Foto), einziger Video-Moment der
    // Fixture, eindeutiger Beleg für den Momentwechsel als `player-video`.
    expect(screen.getByTestId('player-video')).toBeTruthy();

    await act(async () => {
      aufloesen({ ok: true });
    });
    expect(screen.queryByTestId('player-export-hinweis')).toBeNull();
    // Der Sichern-Knopf des NEUEN Moments bleibt bedienbar (kein
    // fälschlich hängender Ladezustand).
    await fireEvent.press(screen.getByTestId('player-sichern'));
    await act(async () => {});
    expect(sichereMomentInGalerie).toHaveBeenCalledTimes(2);
  });
});

// Task 8, Phase 6: Melden und Moderation. "Auf dem Gerät wirklich
// erreichbar" (Vorlage: der zIndex-Test aus Phase 5, siehe "Tages-
// Zwischenkarte"/"Reaktionen" oben) heisst hier etwas anderes als dort: in
// Phase 5 lag eine ZWEITE, konkurrierende Fläche versehentlich UNTER den
// Tipp-Zonen, ein reines fireEvent.press-Rendertest sah das nie, weil es
// keine Geometrie/Stapelung prüft. Für das lange Tippen gibt es keine zweite
// Fläche: `onLongPress` hängt an GENAU denselben Pressable-Knoten
// (`player-links`/`player-rechts`), die bereits onPressIn/onPressOut tragen
// und die die zIndex-Tests oben als vordersten, tatsächlich Berührungen
// empfangenden Layer in ihrer Bildschirmhälfte nachweisen, es gibt also
// keine neue Stapelfrage zu beweisen. Jeder Test unten feuert das Ereignis
// deshalb bewusst auf genau diesem, bereits als erreichbar erwiesenen
// Knoten (nicht auf einer neuen, separat einzuführenden Testkomponente).
describe('Melden (Task 8)', () => {
  test('ein langes Tippen auf die Tipp-Zone öffnet das Melden-Sheet und pausiert den Player', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();

    await fireEvent(screen.getByTestId('player-rechts'), 'longPress');
    await act(async () => {});
    expect(screen.getByText('Diesen Moment melden')).toBeTruthy();
    expect(screen.getByTestId('melden-grund')).toBeTruthy();

    // Pausiert: selbst nach Ablauf der vollen Fotodauer bleibt p1 stehen.
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p1').medium_url });
  });

  test('das lange Tippen funktioniert von der LINKEN wie von der RECHTEN Tipp-Zone aus', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-links'), 'longPress');
    await act(async () => {});
    expect(screen.getByTestId('melden-grund')).toBeTruthy();
  });

  // Brief, wörtlich: "Der Moment bleibt sichtbar, Melden ist kein
  // Verstecken." Weder das Öffnen des Sheets noch ein erfolgreiches Senden
  // (siehe weiter unten) dürfen `spielliste`/`urls` anfassen.
  test('der Moment bleibt sichtbar, während das Melden-Sheet offen ist', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-rechts'), 'longPress');
    await act(async () => {});
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p1').medium_url });
  });

  test('der Senden-Knopf bleibt deaktiviert, solange kein Grund eingetragen ist, auch bei reinen Leerzeichen', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-rechts'), 'longPress');
    await act(async () => {});
    expect(screen.getByTestId('melden-senden').props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByTestId('melden-grund'), '   ');
    expect(screen.getByTestId('melden-senden').props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByTestId('melden-grund'), 'Unpassend');
    expect(screen.getByTestId('melden-senden').props.accessibilityState.disabled).toBe(false);
  });

  test('Erfolg: sendet den Grund für den AKTIVEN Moment und zeigt danach eine Bestätigung', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-rechts'), 'longPress');
    await act(async () => {});
    await fireEvent.changeText(screen.getByTestId('melden-grund'), 'Sieht komisch aus');
    await fireEvent.press(screen.getByTestId('melden-senden'));
    await act(async () => {});

    expect(meldeMoment).toHaveBeenCalledWith('p1', 'Sieht komisch aus');
    expect(screen.getByTestId('melden-bestaetigung')).toBeTruthy();
    expect(screen.queryByTestId('melden-grund')).toBeNull();
    // Weiterhin derselbe Moment, die Bestätigung ersetzt nur den
    // Sheet-Inhalt, nicht den Player dahinter.
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p1').medium_url });
  });

  test('ein Fehlschlag zeigt die Ursache am Formular, ohne die Bestätigung zu zeigen, das Sheet bleibt bedienbar', async () => {
    (meldeMoment as jest.Mock).mockResolvedValue({
      error: 'Deine Meldung konnte nicht gesendet werden. Probier es gleich nochmal.',
    });
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-rechts'), 'longPress');
    await act(async () => {});
    await fireEvent.changeText(screen.getByTestId('melden-grund'), 'Sieht komisch aus');
    await fireEvent.press(screen.getByTestId('melden-senden'));
    await act(async () => {});

    expect(
      screen.getByText('Deine Meldung konnte nicht gesendet werden. Probier es gleich nochmal.')
    ).toBeTruthy();
    expect(screen.queryByTestId('melden-bestaetigung')).toBeNull();
    expect(screen.getByTestId('melden-grund')).toBeTruthy();
  });

  test('ein zweiter Tipp auf Senden, während die erste Anfrage noch läuft, löst KEINEN zweiten Aufruf aus', async () => {
    let aufloesen!: (wert: { error: null }) => void;
    (meldeMoment as jest.Mock).mockReturnValue(new Promise((resolve) => { aufloesen = resolve; }));
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-rechts'), 'longPress');
    await act(async () => {});
    await fireEvent.changeText(screen.getByTestId('melden-grund'), 'Sieht komisch aus');
    await fireEvent.press(screen.getByTestId('melden-senden')); // sendetLaeuft=true, hängt
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('melden-senden'));
    await act(async () => {
      aufloesen({ error: null });
    });
    expect(meldeMoment).toHaveBeenCalledTimes(1);
  });

  // Schliessen (Sheet-Backdrop-Tipp) setzt den Pausier-Grund zurück, der
  // Auto-Vorschub läuft danach normal weiter (gleiches Prinzip wie der
  // erste Kommentar-Sheet-Test oben). start='1' (p2, Video) wie im
  // Kommentar-Test dort, am ALLERERSTEN Moment (index 0) steht zusätzlich
  // die Tages-Zwischenkarte (eigener, unabhängiger Pausier-Grund), die die
  // Prüfung sonst verfälschen würde.
  test('Schliessen setzt den Pausier-Grund zurück, der Auto-Vorschub läuft danach normal weiter', async () => {
    mockParams = { id: 't1', start: '1' }; // p2 (Video), kein Tageswechsel zu p3
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();
    await fireEvent(screen.getByTestId('player-rechts'), 'longPress');
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('sheet-backdrop'));
    await act(async () => {
      jest.advanceTimersByTime(3000); // dauerFuer(p2) = max(1000, 3*1000) = 3000ms
    });
    expect(screen.getByTestId('player-foto').props.source).toEqual({ uri: bild('p3').medium_url });
  });

  // Stale-Guard (gleiches Prinzip wie kommentarAbsenden): eine spät
  // eintreffende Antwort für einen längst verlassenen Moment darf eine NEU
  // geöffnete Sitzung für einen ANDEREN Moment nicht fälschlich als
  // "bestätigt" zeigen.
  test('eine hängende Meldung für einen verlassenen Moment zeigt ihre späte Antwort NICHT auf einer neu geöffneten Sitzung', async () => {
    let aufloesenErsteAnfrage!: (wert: { error: null }) => void;
    (meldeMoment as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => { aufloesenErsteAnfrage = resolve; })
    );
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: MOMENTE, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
    await wrap();

    // Öffnet für p1, sendet, hängt.
    await fireEvent(screen.getByTestId('player-rechts'), 'longPress');
    await act(async () => {});
    await fireEvent.changeText(screen.getByTestId('melden-grund'), 'Erstes');
    await fireEvent.press(screen.getByTestId('melden-senden'));
    await act(async () => {});

    // Schliessen, ohne auf die Antwort zu warten, weiter zu p2, erneut öffnen
    // (frische Sitzung, noch nichts abgeschickt).
    await fireEvent.press(screen.getByTestId('sheet-backdrop'));
    await fireEvent(screen.getByTestId('player-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('player-rechts'), 'pressOut');
    await act(async () => {});
    await fireEvent(screen.getByTestId('player-rechts'), 'longPress');
    await act(async () => {});
    expect(screen.getByTestId('melden-grund')).toBeTruthy(); // frisches, leeres Formular für p2

    // Die alte, hängende Antwort für p1 trifft jetzt ein.
    await act(async () => {
      aufloesenErsteAnfrage({ error: null });
    });
    // Die neue Sitzung (p2) bleibt unberührt: keine fälschliche Bestätigung,
    // das Formular ist weiterhin da.
    expect(screen.queryByTestId('melden-bestaetigung')).toBeNull();
    expect(screen.getByTestId('melden-grund')).toBeTruthy();
  });
});
