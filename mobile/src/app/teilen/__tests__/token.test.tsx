import { StyleSheet } from 'react-native';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

// Fake Timers global (wie player.test.tsx): Date.now() läuft synchron mit den
// Timern mit — das braucht dieser Screen für dieselbe Halten-vs-Tipp-
// Unterscheidung wie der native Player.
jest.useFakeTimers();

let mockToken = 'tok123';
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ token: mockToken }),
}));

const mockSetStatusBarStyle = jest.fn();
jest.mock('expo-status-bar', () => ({ setStatusBarStyle: (...a: unknown[]) => mockSetStatusBarStyle(...a) }));

// expo-image: einfacher View-Platzhalter, der alle Props (inkl. `source`,
// `testID`) durchreicht (gleiches Muster wie player.test.tsx) — dazu ein
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

import GeteilterRecapScreen from '../[token]';
import { loeseTokenAuf } from '@/features/teilen/shareApi';
import type { GeteilterRecap } from '@/features/teilen/shareApi';

const mockLoeseTokenAuf = loeseTokenAuf as jest.MockedFunction<typeof loeseTokenAuf>;

beforeEach(() => {
  jest.clearAllMocks();
  mockToken = 'tok123';
  for (const key of Object.keys(mockListeners)) delete mockListeners[key];
  mockLastSource = undefined;
});

function reise(overrides: Partial<GeteilterRecap['reise']> = {}) {
  return { name: 'Lissabon Städtetrip', start_date: '2026-08-10', end_date: '2026-08-14', ...overrides };
}

function moment(overrides: Partial<GeteilterRecap['medien'][number]> = {}): GeteilterRecap['medien'][number] {
  return {
    post_id: 'p0', autor_name: 'Lea', type: 'photo', duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Zurich', place_name: 'Lissabon',
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

function erfolg(medien: GeteilterRecap['medien'], reiseOverrides: Partial<GeteilterRecap['reise']> = {}) {
  return { data: { reise: reise(reiseOverrides), medien, gueltigBis: Date.now() + 3600_000 }, error: null };
}

// Gleiches Muster wie player.test.tsx (dortiges `wrap()`): render() ist unter
// RNTL v14 selbst schon vollständig async, der zusätzliche leere act()-Flush
// lässt das await loeseTokenAuf(...) in laden() plus den daraus folgenden
// setState-Schwung sicher committen, BEVOR der Test die erste Assertion
// macht — ohne diesen zweiten Flush bliebe der Screen in manchen Läufen noch
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

  test('die Fussleiste (Reelive-Wortzug + "Hol dir die App") ist sichtbar und nicht interaktiv', async () => {
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([p1]));
    await bereit();
    const fussleiste = screen.getByTestId('teilen-fussleiste');
    expect(screen.getByText('Reelive')).toBeTruthy();
    expect(screen.getByText('Hol dir die App')).toBeTruthy();
    // Nicht interaktiv: eine Berührung an dieser Stelle muss der Tipp-Zone
    // darunter gelten, nicht der Fusszeile (die hat ohnehin keinen
    // Knopf/onPress — es gibt noch keinen Store-Link, siehe Kommentar im
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
    // liefert für index 0 unbedingt true) — erst dismissed lässt sich der
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
    // ersten (Zwischenkarte weg) überhaupt geplant — cascading Timer
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
    // IMMER nach captured_at (CLAUDE.md-Eckpfeiler) — [p2, p1] als
    // Eingabereihenfolge würde also ohnehin zu [p1, p2] umsortiert, ein
    // zweiter Moment ist für diesen Test nicht nötig. Der Beweis liegt
    // darin, dass die Phase auf 'ende' wechselt, OHNE dass FOTO_DAUER_MS
    // (5000ms) je verstrichen wäre.
    mockLoeseTokenAuf.mockResolvedValueOnce(erfolg([p2]));
    await bereit();
    expect(screen.getByTestId('teilen-video')).toBeTruthy();
    // Zwischenkarte des allerersten Moments zuerst abwarten —
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
    // Kein zweiter Netzwerkaufruf für den Neustart — nur der ursprüngliche.
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

    // Weiter zu p3 (Tag 2, anderes Datum) — die Karte erscheint erneut.
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
