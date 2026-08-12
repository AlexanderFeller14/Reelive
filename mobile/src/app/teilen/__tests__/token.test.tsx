import { StyleSheet } from 'react-native';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

// Fake Timers global (wie player.test.tsx): Date.now() läuft synchron mit den
// Timern mit, das braucht dieser Screen für dieselbe Halten-vs-Tipp-
// Unterscheidung wie der native Player.
jest.useFakeTimers();

let mockToken = 'tok123';
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ token: mockToken }),
}));

const mockSetStatusBarStyle = jest.fn();
jest.mock('expo-status-bar', () => ({ setStatusBarStyle: (...a: unknown[]) => mockSetStatusBarStyle(...a) }));

// expo-image: einfacher View-Platzhalter, der alle Props (inkl. `source`,
// `testID`) durchreicht (gleiches Muster wie player.test.tsx), dazu ein
// eigener `prefetch`-Spy.
const mockPrefetch = jest.fn();
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  const Image = (props: Record<string, unknown>) => ReactActual.createElement(View, props);
  Image.prefetch = (...args: unknown[]) => mockPrefetch(...args);
  return { Image };
});

// expo-video: ein einziges Fake-Player-Objekt mit steuerbaren Listenern
// (gleiches Muster wie player.test.tsx).
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

jest.mock('@/features/teilen/shareApi', () => ({
  loeseTokenAuf: jest.fn(),
  LINK_TOT_TEXT: 'Dieser Link funktioniert nicht mehr.',
}));

// DESIGN-LANGUAGE §5: «Haptik: selection (Tabs, Zoom)», der Gruppen-Zoom der
// Karte meldet sie. Muster wie in player.test.tsx/karte.test.tsx: das native
// Modul gibt es im Testlauf nicht.
const mockHaptik = jest.fn(() => Promise.resolve());
jest.mock('expo-haptics', () => ({ selectionAsync: () => mockHaptik() }));
// Steuerbar wie in karte.test.tsx: ohne das liesse sich der Sprung-Zweig der
// Kamera gar nicht erreichen, AccessibilityInfo meldet im Testlauf immer
// «keine Reduktion».
let mockReduziert = false;
jest.mock('@/theme/useReducedMotion', () => ({ useReducedMotion: () => mockReduziert }));

import GeteilterRecapScreen from '../[token]';
import { loeseTokenAuf } from '@/features/teilen/shareApi';
import type { GeteilterRecap } from '@/features/teilen/shareApi';

const mockLoeseTokenAuf = loeseTokenAuf as jest.MockedFunction<typeof loeseTokenAuf>;

beforeEach(() => {
  jest.clearAllMocks();
  mockToken = 'tok123';
  mockReduziert = false;
  for (const key of Object.keys(mockListeners)) delete mockListeners[key];
  mockLastSource = undefined;
});

function reise(overrides: Partial<GeteilterRecap['reise']> = {}) {
  return { name: 'Lissabon Städtetrip', start_date: '2026-08-10', end_date: '2026-08-14', ...overrides };
}

// Ohne Koordinaten als Vorgabe: die Momente der bestehenden Blöcke prüfen den
// Player, und ein Recap ohne einen einzigen Ort hat keinen Karten-Einstieg
// (Spec K9), sie bleiben damit genau die Story, die sie vorher waren.
function moment(overrides: Partial<GeteilterRecap['medien'][number]> = {}): GeteilterRecap['medien'][number] {
  return {
    post_id: 'p0', autor_name: 'Lea', autor_avatar_key: null, type: 'photo', duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Zurich', place_name: 'Lissabon',
    lat: null, lng: null,
    medium_url: 'https://s3/p0', thumb_url: null,
    ...overrides,
  };
}

// Tag 1 (10.8.): p1 (Foto, 09:00), p2 (Video, 10:00, duration_s=3). Tag 2
// (11.8., kein place_name): p3 (Foto, 09:00, letzter Moment).
const p1 = moment({ post_id: 'p1', captured_at: '2026-08-10T09:00:00.000Z' });
const p2 = moment({
  post_id: 'p2', type: 'video', duration_s: 3, caption: 'Schön hier',
  captured_at: '2026-08-10T10:00:00.000Z',
});
const p3 = moment({
  post_id: 'p3', captured_at: '2026-08-11T09:00:00.000Z', place_name: null,
});

function erfolg(
  medien: GeteilterRecap['medien'],
  reiseOverrides: Partial<GeteilterRecap['reise']> = {},
  ausgelassen = 0
) {
  return {
    data: { reise: reise(reiseOverrides), medien, gueltigBis: Date.now() + 3600_000, ausgelassen },
    error: null,
  };
}

// Gleiches Muster wie player.test.tsx (dortiges `wrap()`): render() ist unter
// RNTL v14 selbst schon vollständig async, der zusätzliche leere act()-Flush
// lässt das await loeseTokenAuf(...) in laden() plus den daraus folgenden
// setState-Schwung sicher committen, BEVOR der Test die erste Assertion
// macht, ohne diesen zweiten Flush bliebe der Screen in manchen Läufen noch
// auf 'laedt' hängen.
async function bereit() {
  const utils = await render(<GeteilterRecapScreen />);
  await act(async () => {});
  return utils;
}

describe('Laden', () => {
  test('zeigt zuerst einen Ladeindikator und ruft loeseTokenAuf mit dem Token aus der URL auf', async () => {
    mockToken = 'abc';
    mockLoeseTokenAuf.mockReturnValue(new Promise(() => {})); // hängt bewusst
    await render(<GeteilterRecapScreen />);
    expect(screen.getByTestId('teilen-laedt')).toBeTruthy();
    expect(mockLoeseTokenAuf).toHaveBeenCalledWith('abc');
  });

  test('ein abgelehnter/toter Link zeigt exakt den Fehlertext, "Nochmal versuchen" lädt erneut', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce({ data: null, error: 'Dieser Link funktioniert nicht mehr.' });
    await bereit();
    expect(screen.getByTestId('teilen-fehler')).toBeTruthy();
    expect(screen.getByText('Dieser Link funktioniert nicht mehr.')).toBeTruthy();

    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([p1]));
    await fireEvent.press(screen.getByText('Nochmal versuchen'));
    await act(async () => {});
    expect(mockLoeseTokenAuf).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
  });

  test('eine aufgelöste, aber leere Filmrolle zeigt die Leer-Meldung mit Reisename', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([], { name: 'Herbstwanderung' }));
    await bereit();
    expect(screen.getByTestId('teilen-leer')).toBeTruthy();
    expect(screen.getByText('Herbstwanderung ist leer geblieben.')).toBeTruthy();
  });
});

describe('Story-Anzeige', () => {
  test('zeigt Fortschrittsbalken, Autor, Ort/Zeit-Pille und Caption des aktiven Moments', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([p1, p2]));
    await bereit();
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
    expect(screen.getByTestId('fortschrittsbalken')).toBeTruthy();
    expect(screen.getAllByTestId(/fortschritt-segment-/)).toHaveLength(2);
    expect(screen.getByText('Lea')).toBeTruthy();
    expect(screen.getByText(/Lissabon · \d{2}:\d{2}/)).toBeTruthy();
    expect(screen.queryByTestId('teilen-caption')).toBeNull(); // p1 hat keine Caption
  });

  test('ein Video zeigt die Caption des Videos', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([p2]));
    await bereit();
    expect(screen.getByTestId('teilen-video')).toBeTruthy();
    expect(screen.getByText('Schön hier')).toBeTruthy();
  });

  // Task 10: der Screen benutzt jetzt den gemeinsamen Avatar (components/
  // Avatar.tsx) statt einer eigenen AvatarInitiale-Kopie. Ein Moment mit
  // autor_avatar_key muss also wirklich ein <Image> zeigen (gleiches Muster
  // wie player.test.tsx, "der Player zeigt das Profilbild der Autorin"),
  // nicht bloss das gemappte Feld tragen.
  test('zeigt das Profilbild der Autorin, wenn der Moment einen Bild-Schlüssel trägt', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(
      erfolg([moment({ post_id: 'p1', autor_avatar_key: 'profiles/u1/a.jpg' })])
    );
    await bereit();
    expect(await screen.findByTestId('avatar-bild')).toBeTruthy();
  });

  // Gegenprobe: ohne Bild-Schlüssel bleibt die Initiale, kein <Image> im
  // Baum, sonst wäre der Test oben kein Beweis, sondern zeigte ein <Image>,
  // das immer da ist.
  test('ohne Bild-Schlüssel steht nur die Initiale, kein Profilbild', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([moment({ post_id: 'p1', autor_avatar_key: null })]));
    await bereit();
    expect(screen.getByText('L')).toBeTruthy();
    expect(screen.queryByTestId('avatar-bild')).toBeNull();
  });

  test('die Fussleiste (Reelive-Wortzug + "Hol dir die App") ist sichtbar und nicht interaktiv', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([p1]));
    await bereit();
    const fussleiste = screen.getByTestId('teilen-fussleiste');
    expect(screen.getByText('Reelive')).toBeTruthy();
    expect(screen.getByText('Hol dir die App')).toBeTruthy();
    // Nicht interaktiv: eine Berührung an dieser Stelle muss der Tipp-Zone
    // darunter gelten, nicht der Fusszeile (die hat ohnehin keinen
    // Knopf/onPress, es gibt noch keinen Store-Link, siehe Kommentar im
    // Screen).
    expect(fussleiste.props.pointerEvents).toBe('none');
  });
});

describe('Navigation: Tipp, Halten, Auto-Vorschub, Ende', () => {
  test('ein kurzer Tipp rechts schaltet zum nächsten Moment, ein Tipp links zurück', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([p1, p2]));
    await bereit();
    expect(screen.getByText('Lea')).toBeTruthy();

    await fireEvent(screen.getByTestId('teilen-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('teilen-rechts'), 'pressOut');
    expect(screen.getByTestId('teilen-video')).toBeTruthy();

    await fireEvent(screen.getByTestId('teilen-links'), 'pressIn');
    await fireEvent(screen.getByTestId('teilen-links'), 'pressOut');
    expect(screen.getByTestId('teilen-foto')).toBeTruthy();
  });

  test('ein Tipp links am allerersten Moment bleibt beim ersten Moment stehen', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([p1, p2]));
    await bereit();
    await fireEvent(screen.getByTestId('teilen-links'), 'pressIn');
    await fireEvent(screen.getByTestId('teilen-links'), 'pressOut');
    expect(screen.getByTestId('teilen-foto')).toBeTruthy(); // immer noch p1
  });

  test('Halten (>=250ms) pausiert den Auto-Vorschub, Loslassen setzt beim selben Moment fort statt zu navigieren', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([p1, p2]));
    await bereit();
    // Der allererste Moment zeigt IMMER die Tages-Zwischenkarte (tagWechselt
    // liefert für index 0 unbedingt true), erst dismissed lässt sich der
    // Auto-Vorschub von p1 selbst isoliert prüfen, sonst wäre unklar, OB ein
    // ausbleibender Vorschub am Halten liegt oder noch an der Karte.
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(screen.queryByTestId('teilen-zwischenkarte')).toBeNull();

    await fireEvent(screen.getByTestId('teilen-rechts'), 'pressIn');
    await act(async () => {
      jest.advanceTimersByTime(300); // > TAP_SCHWELLE_MS: gilt als Halten, nicht als Tipp
    });
    // Selbst nach Ablauf der vollen Fotodauer bleibt der Moment stehen,
    // solange gehalten wird (gleiches Muster wie player.test.tsx).
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('teilen-foto')).toBeTruthy(); // immer noch p1

    await fireEvent(screen.getByTestId('teilen-rechts'), 'pressOut');
    // Losgelassen nach Halten: derselbe Moment (p1), kein Sprung zu p2.
    expect(screen.getByTestId('teilen-foto')).toBeTruthy();
    expect(screen.getByText('Lea')).toBeTruthy();
  });

  test('nach Ablauf der Foto-Dauer schaltet der Player automatisch weiter', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([p1, p2]));
    await bereit();
    expect(screen.getByTestId('teilen-foto')).toBeTruthy();

    // Zwei GETRENNTE advanceTimersByTime-Aufrufe (nicht einer über 6500ms):
    // der zweite Timer (Auto-Vorschub) wird erst DURCH den State-Wechsel des
    // ersten (Zwischenkarte weg) überhaupt geplant, cascading Timer
    // brauchen einen eigenen act()-Zyklus, um sicher zu feuern (gleiches
    // Muster wie player.test.tsx, "erscheint vor dem allerersten Moment...").
    await act(async () => {
      jest.advanceTimersByTime(1500); // Zwischenkarte weg (p1 ist index 0)
    });
    await act(async () => {
      jest.advanceTimersByTime(5000); // FOTO_DAUER_MS
    });
    expect(screen.getByTestId('teilen-video')).toBeTruthy();
  });

  test('ein Video-Ende-Event (playToEnd) schaltet weiter, ohne auf die Foto-Dauer zu warten', async () => {
    // Bewusst NUR p2 (ein einzelner Video-Moment): sortiereMomente sortiert
    // IMMER nach captured_at (CLAUDE.md-Eckpfeiler), [p2, p1] als
    // Eingabereihenfolge würde also ohnehin zu [p1, p2] umsortiert, ein
    // zweiter Moment ist für diesen Test nicht nötig. Der Beweis liegt
    // darin, dass die Phase auf 'ende' wechselt, OHNE dass FOTO_DAUER_MS
    // (5000ms) je verstrichen wäre.
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([p2]));
    await bereit();
    expect(screen.getByTestId('teilen-video')).toBeTruthy();
    // Zwischenkarte des allerersten Moments zuerst abwarten,
    // blockiertAutomatischenVorschub blockt playToEnd, solange sie steht.
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    await act(async () => {
      for (const cb of mockListeners.playToEnd ?? []) cb();
    });
    expect(screen.getByTestId('teilen-ende')).toBeTruthy();
  });

  test('am letzten Moment schaltet Tippen rechts auf die Ende-Phase, "Nochmal ansehen" beginnt neu', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([p1], { name: 'Herbstwanderung' }));
    await bereit();
    await fireEvent(screen.getByTestId('teilen-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('teilen-rechts'), 'pressOut');
    expect(screen.getByTestId('teilen-ende')).toBeTruthy();
    expect(screen.getByText('Das war der Recap von „Herbstwanderung".')).toBeTruthy();

    await fireEvent.press(screen.getByText('Nochmal ansehen'));
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
    expect(screen.getByTestId('teilen-foto')).toBeTruthy();
    // Kein zweiter Netzwerkaufruf für den Neustart, nur der ursprüngliche.
    expect(mockLoeseTokenAuf).toHaveBeenCalledTimes(1);
  });
});

describe('Tages-Zwischenkarte', () => {
  test('erscheint beim Wechsel zu einem neuen Tag, verschwindet nach 1,5s von selbst', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([p1, p3]));
    await bereit();
    // Der allererste Moment zeigt IMMER die Tages-Zwischenkarte
    // (tagWechselt liefert für index 0 unbedingt true).
    expect(screen.getByTestId('teilen-zwischenkarte')).toBeTruthy();
    expect(screen.getByText(/Tag 1 · Lissabon · 10\. August/)).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(screen.queryByTestId('teilen-zwischenkarte')).toBeNull();

    // Weiter zu p3 (Tag 2, anderes Datum), die Karte erscheint erneut.
    await fireEvent(screen.getByTestId('teilen-rechts'), 'pressIn');
    await fireEvent(screen.getByTestId('teilen-rechts'), 'pressOut');
    expect(screen.getByTestId('teilen-zwischenkarte')).toBeTruthy();
    expect(screen.getByText(/Tag 2 · 11\. August/)).toBeTruthy();
  });

  test('ein Tipp auf die Zwischenkarte überspringt sie SOFORT, navigiert aber NICHT gleichzeitig weiter', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([p1, p3]));
    await bereit();
    expect(screen.getByTestId('teilen-zwischenkarte')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('teilen-zwischenkarte'));
    expect(screen.queryByTestId('teilen-zwischenkarte')).toBeNull();
    expect(screen.getByText('Lea')).toBeTruthy(); // immer noch p1, kein Sprung zu p3
  });

  // Gleiches Prinzip wie player.test.tsx: kein echtes Hit-Testing in RNTL,
  // die Stapel-Reihenfolge wird über StyleSheet.flatten(zIndex) belegt.
  test('die Zwischenkarte liegt per zIndex über den Tipp-Zonen', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([p1]));
    await bereit();
    const links = StyleSheet.flatten(screen.getByTestId('teilen-links').props.style);
    const rechts = StyleSheet.flatten(screen.getByTestId('teilen-rechts').props.style);
    const karte = StyleSheet.flatten(screen.getByTestId('teilen-zwischenkarte').props.style);
    expect(links.zIndex).toBe(1);
    expect(rechts.zIndex).toBe(1);
    expect(karte.zIndex).toBeGreaterThan(links.zIndex as number);
  });
});

describe('Die Karte im geteilten Recap (Spec §5.10)', () => {
  // Wie lange die Tages-Zwischenkarte steht (ZWISCHENKARTE_DAUER_MS im
  // Screen), dieselbe Zahl wie in den Blöcken darüber, hier benannt, weil
  // zwei Tests unten sie brauchen.
  const ZWISCHENKARTE_MS = 1500;

  // Drei Momente an EINEM Reisetag, damit keine Tages-Zwischenkarte über dem
  // Sprungziel steht: q1 mit Ort (Index 0), q2 OHNE Ort (Index 1), q3 mit Ort
  // (Index 2).
  //
  // Der Moment ohne Ort in der Mitte ist die Pointe dieser Aufstellung: er
  // bekommt keine Nadel, zählt in der Spielliste aber mit. Wer den Player mit
  // der Stelle innerhalb der NADELN startet, landet bei q3 also auf Index 1,
  // und damit auf q2. Genau diesen Fehler nagelt der Sprung-Test unten fest.
  const q1 = moment({
    post_id: 'q1', autor_name: 'Lea', captured_at: '2026-08-10T09:00:00.000Z',
    place_name: 'Alfama', lat: 38.7139, lng: -9.1301, thumb_url: 'https://s3/q1-thumb',
  });
  const q2 = moment({
    post_id: 'q2', autor_name: 'Jonas', captured_at: '2026-08-10T10:00:00.000Z',
    place_name: null, caption: 'Im Zug',
  });
  const q3 = moment({
    post_id: 'q3', autor_name: 'Mira', captured_at: '2026-08-10T11:00:00.000Z',
    place_name: 'Bairro Alto', caption: 'Fado im Hinterhof', lat: 38.75, lng: -9.16,
  });

  async function aufDerKarte(medien = [q1, q2, q3]) {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg(medien));
    await bereit();
    await fireEvent.press(await screen.findByText('Auf der Karte'));
  }

  test('der geteilte Recap bietet die Karte an', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([q1, q2, q3]));
    await bereit();
    expect(await screen.findByText('Auf der Karte')).toBeTruthy();
    // Beide Beschriftungen stehen immer da, die aktive Hälfte sagt nur, wo
    // man gerade ist.
    expect(screen.getByText('Ansehen')).toBeTruthy();
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
  });

  test('ohne einen einzigen Ort gibt es keinen Karten-Einstieg', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([p1, p2, p3]));
    await bereit();
    expect(screen.queryByText('Auf der Karte')).toBeNull();
    expect(screen.queryByText('Ansehen')).toBeNull();
  });

  test('die Karte ersetzt den Player im selben Screen, «Ansehen» holt ihn zurück', async () => {
    await aufDerKarte();
    expect(screen.getByTestId('teilen-karte')).toBeTruthy();
    // Der Player ist WEG, nicht bloss verdeckt: eine zweite Route gibt es
    // nicht (der expo-router-Mock oben bietet gar keinen `router` an, ein
    // `router.push` in diesem Screen liesse den Test hier abstürzen).
    expect(screen.queryByTestId('teilen-bereit')).toBeNull();

    await fireEvent.press(screen.getByText('Ansehen'));
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
    // Und die Fläche ist abgebaut, nicht versteckt (siehe Begründung im
    // Screen: eine unsichtbare Leaflet-Karte baut sich auf 0 × 0 auf).
    expect(screen.queryByTestId('karte-flaeche')).toBeNull();
  });

  test('die Karte zeigt die Momente mit Ort, und nur die', async () => {
    await aufDerKarte();
    expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(2);
    expect(screen.getByTestId('karte-nadel-q1')).toBeTruthy();
    expect(screen.getByTestId('karte-nadel-q3')).toBeTruthy();
    expect(screen.queryByTestId('karte-nadel-q2')).toBeNull();
  });

  test('sie öffnet mit einem Ausschnitt, in dem beide Momente liegen (K2)', async () => {
    await aufDerKarte();
    const region = screen.getByTestId('karte-flaeche').props.initialRegion;
    const nord = region.latitude + region.latitudeDelta / 2;
    const sued = region.latitude - region.latitudeDelta / 2;
    const ost = region.longitude + region.longitudeDelta / 2;
    const west = region.longitude - region.longitudeDelta / 2;
    for (const m of [q1, q3]) {
      expect(m.lat!).toBeGreaterThan(sued);
      expect(m.lat!).toBeLessThan(nord);
      expect(m.lng!).toBeGreaterThan(west);
      expect(m.lng!).toBeLessThan(ost);
    }
  });

  test('die Linie verbindet die Momente in Aufnahmereihenfolge (K3)', async () => {
    await aufDerKarte();
    expect(screen.getByTestId('karte-linie').props.coordinates).toEqual([
      { latitude: q1.lat, longitude: q1.lng },
      { latitude: q3.lat, longitude: q3.lng },
    ]);
  });

  test('auf der Karte gibt es keinen Tagesfilter (Spec §5.10)', async () => {
    await aufDerKarte();
    expect(screen.queryByText('Alle Tage')).toBeNull();
    expect(screen.queryByText('Tag 1')).toBeNull();
  });

  test('die Momente ohne Ort werden benannt, statt still zu fehlen (K6)', async () => {
    await aufDerKarte();
    expect(screen.getByText('1 Moment ohne Ort. Er läuft im Recap mit.')).toBeTruthy();
  });

  // Der Kern des Tasks: der Sprung führt auf GENAU den angetippten Moment,
  // gezählt in die Liste, die der geteilte Player spielt.
  test('«Ab hier ansehen» springt im geteilten Player an genau diese Stelle', async () => {
    await aufDerKarte();
    await fireEvent.press(screen.getByTestId('karte-nadel-q3'));
    expect(screen.getByText('Bairro Alto')).toBeTruthy(); // das Sheet steht offen

    await fireEvent.press(screen.getByText('Ab hier ansehen'));

    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
    expect(screen.getByText('Fado im Hinterhof')).toBeTruthy();
    expect(screen.getByText('Mira')).toBeTruthy();
    // Und der Index nachgezählt, nicht bloss «irgendetwas ist passiert»: der
    // Fortschrittsbalken füllt genau die Segmente VOR dem aktiven ganz aus,
    // zwei volle heissen also Index 2. Zählte der Sprung in die Nadel-Liste
    // (q1, q3), stünde hier eine 1, und der Player liefe bei q2 los.
    expect(screen.getAllByTestId(/^fortschritt-voll-/)).toHaveLength(2);
  });

  // Nicht im Test darüber mitgeprüft, und zwar aus einem Grund, der beim
  // ersten Versuch durchgerutscht ist: nach dem Sprung ist die Kartenansicht
  // ohnehin nicht mehr im Baum, ein `queryByText('Ab hier ansehen')` wäre
  // dort auch dann null, wenn das Sheet gar nie geschlossen würde. Sichtbar
  // wird ein offen gebliebenes Sheet erst beim ZURÜCKKOMMEN, dann läge es
  // über der Karte, ohne dass jemand eine Nadel angetippt hat.
  test('die Karte öffnet ohne das Sheet von vorhin', async () => {
    await aufDerKarte();
    await fireEvent.press(screen.getByTestId('karte-nadel-q3'));
    await fireEvent.press(screen.getByText('Ab hier ansehen'));
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();

    await fireEvent.press(screen.getByText('Auf der Karte'));
    expect(screen.getByTestId('teilen-karte')).toBeTruthy();
    expect(screen.queryByText('Ab hier ansehen')).toBeNull();
    expect(screen.queryByTestId('sheet-root')).toBeNull();
  });

  test('der Sprung startet neu und nicht mitten im Abspann', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([q1, q2, q3]));
    await bereit();
    // Bis ans Ende durchtippen: drei Momente, also dreimal rechts, der
    // dritte Tipp führt vom letzten Moment auf den Abspann.
    for (let i = 0; i < 3; i++) {
      await fireEvent(screen.getByTestId('teilen-rechts'), 'pressIn');
      await fireEvent(screen.getByTestId('teilen-rechts'), 'pressOut');
    }
    expect(screen.getByTestId('teilen-ende')).toBeTruthy();

    // Die Karte bleibt aus dem Abspann heraus erreichbar.
    await fireEvent.press(screen.getByText('Auf der Karte'));
    await fireEvent.press(screen.getByTestId('karte-nadel-q1'));
    await fireEvent.press(screen.getByText('Ab hier ansehen'));
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
    expect(screen.getByText('Lea')).toBeTruthy();
    expect(screen.getByText(/Alfama · \d{2}:\d{2}/)).toBeTruthy();
    // Index 0: vor dem aktiven Segment ist keines voll.
    expect(screen.queryAllByTestId(/^fortschritt-voll-/)).toHaveLength(0);
  });

  test('Momente auf derselben Koordinate öffnen die Liste, jeder Eintrag führt an seine eigene Stelle', async () => {
    // s1 und s2 liegen bitgleich aufeinander, keine Zoomstufe trennt sie
    // (features/karte/gruppierung.ts), sie teilen sich eine Nadel.
    const s1 = moment({
      post_id: 's1', autor_name: 'Lea', captured_at: '2026-08-10T09:00:00.000Z',
      place_name: 'Alfama', lat: 38.7139, lng: -9.1301,
    });
    const s2 = moment({
      post_id: 's2', autor_name: 'Jonas', captured_at: '2026-08-10T10:00:00.000Z',
      place_name: 'Alfama', caption: 'Direkt daneben', lat: 38.7139, lng: -9.1301,
    });
    const s3 = moment({
      post_id: 's3', autor_name: 'Mira', captured_at: '2026-08-10T11:00:00.000Z', place_name: null,
    });
    await aufDerKarte([s1, s2, s3]);

    expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('karte-nadel-s1'));
    expect(screen.getByText('2 Momente an diesem Ort')).toBeTruthy();
    // Kein Primär-Button in dieser Liste (DESIGN-LANGUAGE §4): den trägt das
    // Sheet des einzelnen Moments.
    expect(screen.queryByText('Ab hier ansehen')).toBeNull();

    await fireEvent.press(screen.getByTestId('teilen-gruppe-eintrag-s2'));
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
    expect(screen.getByText('Direkt daneben')).toBeTruthy();
    expect(screen.getAllByTestId(/^fortschritt-voll-/)).toHaveLength(1);
  });

  // Der Player bleibt beim Umschalten als ZUSTAND bestehen, nur seine
  // Ansicht ist weg. Ohne eine Bremse liefe seine Uhr hinter der Karte
  // weiter, und wer eine halbe Minute auf der Karte sucht, käme an einer
  // ganz anderen Stelle wieder heraus.
  test('die Story läuft nicht hinter der offenen Karte weiter', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([q1, q2, q3]));
    await bereit();
    // Die Zwischenkarte des allerersten Moments ZUERST wegwarten: solange sie
    // steht, ist der Player ohnehin pausiert, und ein ausbleibender Vorschub
    // liesse sich nicht der Karte zuschreiben (genau daran ist die erste
    // Fassung dieses Tests vorbeigelaufen, die Mutation überlebte).
    await act(async () => {
      jest.advanceTimersByTime(ZWISCHENKARTE_MS);
    });
    expect(screen.queryByTestId('teilen-zwischenkarte')).toBeNull();

    await fireEvent.press(screen.getByText('Auf der Karte'));
    // Weit mehr als die Foto-Dauer (5000 ms), und mehr, als alle drei
    // Momente zusammen bräuchten.
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(screen.getByTestId('teilen-karte')).toBeTruthy();

    await fireEvent.press(screen.getByText('Ansehen'));
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();
    // Noch immer beim ersten Moment, nicht im Abspann.
    expect(screen.queryAllByTestId(/^fortschritt-voll-/)).toHaveLength(0);
    expect(screen.getByText('Lea')).toBeTruthy();
  });

  // Und dasselbe für die Tages-Zwischenkarte, auf einem anderen Weg: sie
  // WARTET nicht hinter der Karte, sie wird verworfen und beim Zurückkommen
  // neu aufgesetzt (`ansicht` steht in den Abhängigkeiten ihres Effekts).
  // Sichtbar ist dasselbe, der Tag ist beim Zurückkommen nicht schon
  // angesagt, ohne dass ihn jemand gelesen hat.
  test('die Tages-Zwischenkarte beginnt nach der Karte von vorn', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([q1, q2, q3]));
    await bereit();
    expect(screen.getByTestId('teilen-zwischenkarte')).toBeTruthy();

    await fireEvent.press(screen.getByText('Auf der Karte'));
    await act(async () => {
      jest.advanceTimersByTime(ZWISCHENKARTE_MS * 4);
    });
    await fireEvent.press(screen.getByText('Ansehen'));
    expect(screen.getByTestId('teilen-zwischenkarte')).toBeTruthy();
  });

  // DESIGN-LANGUAGE §1: Kino nur auf den Medien-Screens. Unter der
  // Statusleiste liegen auf der Karte helle Kacheln.
  test('die Statusleiste wird auf der Karte dunkel und im Player wieder hell', async () => {
    await aufDerKarte();
    expect(mockSetStatusBarStyle).toHaveBeenLastCalledWith('dark');

    await fireEvent.press(screen.getByText('Ansehen'));
    expect(mockSetStatusBarStyle).toHaveBeenLastCalledWith('light');
  });

  // Finding 3 des Abschluss-Reviews: die Segment-Zeile liegt per zIndex ÜBER
  // dem Sheet und ist damit auch bei offenem Sheet antippbar (gewollt, der
  // Weg zurück darf von nichts verdeckt werden). Räumt «Ansehen» das Sheet
  // nicht mit ab, öffnet die Karte beim nächsten Mal mit einem Sheet, das
  // niemand angetippt hat. Über «Ab hier ansehen» war dieser Weg zu, über die
  // Segment-Zeile stand er offen.
  test('«Ansehen» räumt ein offenes Moment-Sheet mit ab', async () => {
    await aufDerKarte();
    await fireEvent.press(screen.getByTestId('karte-nadel-q3'));
    expect(screen.getByText('Ab hier ansehen')).toBeTruthy();

    await fireEvent.press(screen.getByText('Ansehen'));
    expect(screen.getByTestId('teilen-bereit')).toBeTruthy();

    await fireEvent.press(screen.getByText('Auf der Karte'));
    expect(screen.getByTestId('teilen-karte')).toBeTruthy();
    expect(screen.queryByText('Ab hier ansehen')).toBeNull();
    expect(screen.queryByTestId('sheet-root')).toBeNull();
  });

  // Finding 1: die Karte hat eine letzte Zoomstufe. Bleibt der sichtbare
  // Ausschnitt nach einem Gruppen-Tipp derselbe, richtet ein weiterer nichts
  // aus, dann gehört der Gruppe das Sheet, obwohl ihre Koordinaten
  // verschieden sind. Im Testlauf meldet die Karte von sich aus nie einen
  // neuen Ausschnitt; sie steht also genau so still wie am Anschlag.
  test('bewegt ein Gruppen-Tipp die Kamera nicht, öffnet der nächste das Sheet', async () => {
    const g1 = moment({
      post_id: 'g1', autor_name: 'Lea', captured_at: '2026-08-10T09:00:00.000Z',
      place_name: 'Alfama', lat: 38.7139, lng: -9.1301,
    });
    const g2 = moment({
      post_id: 'g2', autor_name: 'Jonas', captured_at: '2026-08-10T10:00:00.000Z',
      place_name: 'Alfama', caption: 'Fünf Meter weiter', lat: 38.71408, lng: -9.1301,
    });
    const g3 = moment({
      post_id: 'g3', captured_at: '2026-08-10T11:00:00.000Z', place_name: 'Belém',
      lat: 38.7, lng: -9.2,
    });
    await aufDerKarte([g1, g2, g3]);

    await fireEvent.press(screen.getByTestId('karte-nadel-g1'));
    expect(screen.queryByTestId('teilen-gruppe-liste')).toBeNull(); // erst fahren

    await fireEvent.press(screen.getByTestId('karte-nadel-g1'));
    expect(screen.getByText('2 Momente an diesem Ort')).toBeTruthy();
    expect(screen.getByTestId('teilen-gruppe-eintrag-g2')).toBeTruthy();
  });

  // Und die Gegenprobe, die den Zoom-Weg am Leben hält: hat sich der
  // Ausschnitt zwischen den beiden Tipps geändert, kann die Kamera noch etwas
  // ausrichten, dann gibt es weiterhin kein Sheet.
  test('hat sich der Ausschnitt bewegt, zoomt auch der zweite Tipp weiter', async () => {
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
    await aufDerKarte([g1, g2, g3]);

    await fireEvent.press(screen.getByTestId('karte-nadel-g1'));
    // Die Karte meldet einen deutlich engeren Ausschnitt, sie IST gefahren.
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

  // Finding 2: was die Function gar nicht herausgeben konnte, fehlt im Player
  // UND auf der Karte. Ohne diesen Satz behauptete die Seite, sie zeige die
  // ganze Reise.
  const AUSGELASSEN_SATZ = '2 Momente liessen sich gerade nicht laden. Schau später nochmal rein.';

  test('ausgelassene Momente werden auf der Karte benannt', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([q1, q2, q3], {}, 2));
    await bereit();
    await fireEvent.press(await screen.findByText('Auf der Karte'));
    expect(screen.getByTestId('teilen-ausgelassen')).toBeTruthy();
    expect(screen.getByText(AUSGELASSEN_SATZ)).toBeTruthy();
  });

  // «Das war der Recap» ist die zweite Stelle, an der eine unvollständige
  // Filmrolle es sagen muss: dort behauptet die Seite, alles gezeigt zu haben.
  test('ausgelassene Momente stehen auch im Abspann', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([q1, q2, q3], {}, 2));
    await bereit();
    for (let i = 0; i < 3; i++) {
      await fireEvent(screen.getByTestId('teilen-rechts'), 'pressIn');
      await fireEvent(screen.getByTestId('teilen-rechts'), 'pressOut');
    }
    expect(screen.getByTestId('teilen-ende')).toBeTruthy();
    expect(screen.getByText(AUSGELASSEN_SATZ)).toBeTruthy();
  });

  test('ohne ausgelassene Momente behauptet nichts das Gegenteil', async () => {
    await aufDerKarte();
    expect(screen.queryByTestId('teilen-ausgelassen')).toBeNull();
    expect(screen.queryByText(/liessen sich gerade nicht laden/)).toBeNull();
  });

  test('ein Tipp auf eine Gruppe, die sich trennen lässt, fährt hinein statt ein Sheet zu öffnen', async () => {
    // Zwei Momente, die auf DIESEM Ausschnitt zusammenfallen (rund 20 Meter
    // auseinander, die Karte zeigt gut 4 Kilometer), aber nicht auf
    // derselben Koordinate liegen.
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
    await aufDerKarte([g1, g2, g3]);
    expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(2);

    await fireEvent.press(screen.getByTestId('karte-nadel-g1'));
    // Kein Sheet, die Karte fährt hinein (Spec §5.5), und meldet das per
    // selection-Haptik (DESIGN-LANGUAGE §5).
    expect(screen.queryByText('Ab hier ansehen')).toBeNull();
    expect(screen.queryByTestId('teilen-gruppe-liste')).toBeNull();
    expect(mockHaptik).toHaveBeenCalledTimes(1);
  });
});

describe('Ladefehler eines einzelnen Moments (bewusst OHNE stillen Neuversuch, anders als der native Player)', () => {
  test('ein Foto, das nicht lädt, zeigt SOFORT nach dem ERSTEN Fehler die Hinweis-Pille', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([p1]));
    await bereit();
    await fireEvent(screen.getByTestId('teilen-foto'), 'error');
    expect(screen.getByText('Dieses Foto lässt sich gerade nicht laden.')).toBeTruthy();
  });

  test('ein Video, das nicht lädt, zeigt SOFORT nach dem ERSTEN Fehler die Hinweis-Pille', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([p2]));
    await bereit();
    await act(async () => {
      for (const cb of mockListeners.statusChange ?? []) cb({ status: 'error' });
    });
    expect(screen.getByText('Dieses Video lässt sich gerade nicht laden.')).toBeTruthy();
  });
});
