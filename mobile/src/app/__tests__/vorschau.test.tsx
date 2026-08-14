import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import { Keyboard, Platform, StyleSheet } from 'react-native';
import * as React from 'react';
import { spacing } from '@/theme/tokens';

const mockReplace = jest.fn();
const mockBack = jest.fn();
// Final-Review, Important 3: die Vorschau wird vom Stapel GENOMMEN statt durch
// einen neuen Kamera-Screen ersetzt. Nur ohne Rückweg (Deep Link) bleibt
// replace übrig, deshalb steuerbar.
let mockKannZurueck = true;
let mockParams: Record<string, string | undefined> = {
  uri: 'file://foto.jpg',
  typ: 'photo',
  dauer: '0',
  tripId: 't1',
};
const mockStackScreenOptionen = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockReplace,
    back: mockBack,
    push: jest.fn(),
    canGoBack: () => mockKannZurueck,
  }),
  useLocalSearchParams: () => mockParams,
  Stack: {
    Screen: (props: { options?: object }) => {
      mockStackScreenOptionen(props.options);
      return null;
    },
  },
}));

// expo-image ist ein natives View; der Platzhalter reicht den source-Prop
// durch, damit die Tests prüfen können, ob Ref oder URI ankommt.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

const mockSetStatusBarStyle = jest.fn();
jest.mock('expo-status-bar', () => ({
  setStatusBarStyle: (...args: unknown[]) => mockSetStatusBarStyle(...args),
}));

// expo-video braucht ein natives Modul, das es in diesem Jest-Setup nicht
// gibt (gleiche Einschränkung wie expo-image in Task 8, siehe dessen
// Bericht), deshalb gemockt statt real importiert. `useVideoPlayer` liefert
// ein greifbares Fake-Player-Objekt, damit der Video-Nachzug prüfen kann,
// dass die Vorschau stumm und in Schleife läuft.
const mockVideoPlayer = {
  loop: false,
  muted: false,
  playing: false,
  audioMixingMode: 'auto',
  play: jest.fn(),
  addListener: jest.fn(
    (_ereignis: string, _horcher: (e: { isPlaying: boolean }) => void) => ({ remove: jest.fn() })
  ),
};
const mockUseVideoPlayer = jest.fn((source: unknown, setup?: (p: typeof mockVideoPlayer) => void) => {
  setup?.(mockVideoPlayer);
  return mockVideoPlayer;
});
jest.mock('expo-video', () => ({
  useVideoPlayer: (source: unknown, setup?: (p: unknown) => void) => mockUseVideoPlayer(source, setup),
  VideoView: (props: Record<string, unknown>) => {
    const ReactActual = require('react');
    const { View } = require('react-native');
    // player und onFirstFrameRender werden durchgereicht: die Tests prüfen,
    // ob der vorgewärmte Player aus der Übergabe spielt und ob das Poster
    // dem ersten gezeichneten Bild weicht.
    return ReactActual.createElement(View, {
      testID: props.testID,
      player: props.player,
      onFirstFrameRender: props.onFirstFrameRender,
    });
  },
}));

const mockNeuePostId = jest.fn();
const mockFotoAufbereiten = jest.fn();
const mockVideoAufbereiten = jest.fn();
// Final-Review, Critical 2: Aufnahmen wandern beim Einreihen aus dem
// flüchtigen Cache an einen dauerhaften Ort, und beide Verlassenswege
// (Verwerfen, gescheitertes Einsenden) räumen auf.
const mockDauerhaftSichern = jest.fn();
const mockMomentDateienEntfernen = jest.fn();
const mockDateiVerwerfen = jest.fn();
const mockZwischenfassungenVerwerfen = jest.fn();
jest.mock('@/features/moments/medien', () => ({
  neuePostId: () => mockNeuePostId(),
  fotoAufbereiten: (uri: string) => mockFotoAufbereiten(uri),
  videoAufbereiten: (uri: string) => mockVideoAufbereiten(uri),
  dauerhaftSichern: (postId: string, dateien: unknown) => mockDauerhaftSichern(postId, dateien),
  momentDateienEntfernen: (postId: string) => mockMomentDateienEntfernen(postId),
  dateiVerwerfen: (uri: string) => mockDateiVerwerfen(uri),
  zwischenfassungenVerwerfen: (roh: string, aufbereitet: unknown) =>
    mockZwischenfassungenVerwerfen(roh, aufbereitet),
  storageKey: (tripId: string, postId: string, endung: string) =>
    `trips/${tripId}/${postId}.${endung}`,
  // Important 5: die Endung kommt aus der tatsächlichen Aufnahme.
  medienEndung: (typ: string, uri: string) =>
    typ === 'video' ? (uri.endsWith('.mov') ? 'mov' : 'mp4') : 'jpg',
  thumbKey: (tripId: string, postId: string) => `trips/${tripId}/${postId}_t.jpg`,
}));

const mockJobEinreihen = jest.fn();
jest.mock('@/features/moments/uploadWorker', () => ({
  jobEinreihen: (job: unknown) => mockJobEinreihen(job),
}));

// Task-13-Fix-Runde-2: die Autoren-Kennung wird beim Einreihen aus useAuth()
// gelesen, nicht mehr erst vom Worker beim Schreiben aus der Sitzung.
const mockAuth: { userId: string | null } = { userId: 'u1' };
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));

const mockJetzt = jest.fn();
const mockOrtBestimmen = jest.fn();
jest.mock('@/features/moments/ortUndZeit', () => ({
  jetzt: () => mockJetzt(),
  ortBestimmen: () => mockOrtBestimmen(),
}));

// Die echte Erfolgsanimation läuft ~2,5 s und ist für sich getestet
// (MemorySubmissionAnimation.test.tsx), hier interessiert nur der Vertrag
// «wird sichtbar, sobald der Job eingereiht ist, und navigiert über
// onFinished weiter». Der Mock feuert onFinished synchron, sobald er
// sichtbar wird, damit die bestehenden Erwartungen an mockReplace/mockBack
// ohne Timer-Steuerung auskommen.
const mockAnimationSichtbar = jest.fn();
const mockAnimationProps = jest.fn();
jest.mock('@/components/MemorySubmissionAnimation', () => {
  const react = jest.requireActual('react');
  return {
    MemorySubmissionAnimation: ({
      visible,
      onFinished,
      zaehler,
    }: {
      visible: boolean;
      onFinished: () => void;
      zaehler?: number | null;
    }) => {
      mockAnimationSichtbar(visible);
      mockAnimationProps({ visible, zaehler });
      react.useEffect(() => {
        if (visible) onFinished();
      }, [visible, onFinished]);
      return null;
    },
  };
});

// Der Zählerstand vor dem Moment kommt aus zaehler.ts (offline-fest); die
// Animation rollt darauf +1 hoch. Der Abruf darf scheitern, dann entfällt
// nur die Zahl.
const mockEigenerZaehler = jest.fn();
jest.mock('@/features/moments/zaehler', () => ({
  eigenerZaehler: (tripId: string) => mockEigenerZaehler(tripId),
}));

import * as uebergabe from '@/features/kamera/uebergabe';
import type { VideoPlayer } from 'expo-video';
import PreviewScreen from '../vorschau';

// Nicht hart auf "14:34" verdrahtet: welche lokale Uhrzeit aus dem UTC-ISO-Wert
// wird, hängt von der Zeitzone der ausführenden Maschine ab (hier zufällig
// Europe/Zurich/CEST, auf einem CI-Runner mit UTC wäre es "12:34"). Dieselbe
// Umrechnung wie preview.tsx macht die Erwartung unabhängig davon korrekt.
const CAPTURED_AT = '2026-08-07T12:34:00.000Z';
function erwarteteZeit(iso: string): string {
  const datum = new Date(iso);
  const zweistellig = (n: number) => String(n).padStart(2, '0');
  return `${zweistellig(datum.getHours())}:${zweistellig(datum.getMinutes())}`;
}

// In Ruhe steht an der Stelle der Bildunterschrift nur ein Chip; das
// Eingabefeld entsteht erst mit dem Tipp darauf (und holt sich per autoFocus
// die Tastatur). Wer im Test schreiben will, muss es also erst öffnen.
async function bildunterschriftOeffnen() {
  await fireEvent.press(screen.getByTestId('bildunterschrift-chip'));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockVideoPlayer.playing = false;
  mockAuth.userId = 'u1';
  mockParams = { uri: 'file://foto.jpg', typ: 'photo', dauer: '0', tripId: 't1' };
  mockNeuePostId.mockReturnValue('post-1');
  mockFotoAufbereiten.mockResolvedValue({ medium: 'file://medium.jpg', thumb: 'file://thumb.jpg' });
  mockVideoAufbereiten.mockResolvedValue({ medium: 'file://video.mp4', thumb: 'file://thumb.jpg' });
  // Gibt zurück, was die echte Fassung zurückgibt: die Pfade im dauerhaften
  // Ordner. Genau diese müssen im Job landen, nicht die Cache-Pfade.
  mockDauerhaftSichern.mockImplementation(async (postId: string) => ({
    medium: `file://dokumente/momente/${postId}/medium.jpg`,
    thumb: `file://dokumente/momente/${postId}/thumb.jpg`,
  }));
  mockJobEinreihen.mockResolvedValue(undefined);
  mockEigenerZaehler.mockResolvedValue(4);
  mockJetzt.mockReturnValue({ captured_at: CAPTURED_AT, captured_tz: 'Europe/Zurich' });
  mockKannZurueck = true;
  // Standardmässig hängend (nie auflösend): jeder Test, der eine bestimmte
  // Antwort braucht, überschreibt das explizit. So bleibt sichtbar, dass die
  // Anzeige nicht auf den Ort wartet, bevor sie den Screen zeigt.
  mockOrtBestimmen.mockImplementation(() => new Promise(() => {}));
  // Leert den Holder zwischen den Tests: ohne Test-Foto läuft jeder
  // bestehende Foto-Test über den alten uri-Weg (foto === null), ohne
  // Test-Player jeder Video-Test über den eigenen Hook-Player.
  uebergabe.abholen();
  uebergabe.videoAbholen();
});

test('die Aufnahme erscheint sofort, ohne auf den Ort zu warten', async () => {
  await render(<PreviewScreen />);
  expect(await screen.findByText('Einsenden')).toBeTruthy();
});

test('eine Caption über 120 Zeichen wird begrenzt', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);
  await bildunterschriftOeffnen();
  const eingabe = screen.getByLabelText('Bildunterschrift');
  await fireEvent.changeText(eingabe, 'a'.repeat(150));
  expect((eingabe.props.value as string).length).toBe(120);
});

test('Ort und Zeit erscheinen klein, sobald ortBestimmen geantwortet hat', async () => {
  let aufloesen: (v: { lat: number; lng: number; place_name: string }) => void = () => {};
  mockOrtBestimmen.mockImplementation(
    () =>
      new Promise((resolve) => {
        aufloesen = resolve;
      })
  );
  await render(<PreviewScreen />);
  expect(screen.queryByText(/Luzern/)).toBeNull();

  await act(async () => {
    aufloesen({ lat: 47.05, lng: 8.31, place_name: 'Luzern' });
  });

  expect(await screen.findByText(`Luzern · ${erwarteteZeit(CAPTURED_AT)}`)).toBeTruthy();
});

test('ohne Ortsnamen zeigt die Pille nur die Zeit', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);
  expect(await screen.findByText(erwarteteZeit(CAPTURED_AT))).toBeTruthy();
});

test('Einsenden reiht genau einen Job ein und navigiert zur Kamera zurück', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: 47.05, lng: 8.31, place_name: 'Luzern' });
  await render(<PreviewScreen />);
  await bildunterschriftOeffnen();
  await fireEvent.changeText(screen.getByLabelText('Bildunterschrift'), 'Was für ein Abend');

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockFotoAufbereiten).toHaveBeenCalledWith('file://foto.jpg');
  expect(mockJobEinreihen).toHaveBeenCalledTimes(1);
  const job = mockJobEinreihen.mock.calls[0][0];
  expect(job).toMatchObject({
    id: 'post-1',
    post_id: 'post-1',
    trip_id: 't1',
    author_id: 'u1',
    typ: 'photo',
    // Die dauerhaften Pfade, nicht die aus dem Cache (Critical 2).
    medium_uri: 'file://dokumente/momente/post-1/medium.jpg',
    thumb_uri: 'file://dokumente/momente/post-1/thumb.jpg',
    storage_key: 'trips/t1/post-1.jpg',
    thumb_key: 'trips/t1/post-1_t.jpg',
    caption: 'Was für ein Abend',
    captured_at: CAPTURED_AT,
    captured_tz: 'Europe/Zurich',
    lat: 47.05,
    lng: 8.31,
    place_name: 'Luzern',
    duration_s: null,
    zustand: 'wartet',
    versuche: 0,
    zeile_angelegt: false,
    medium_geladen: false,
    thumb_geladen: false,
  });
  // Important 3: die Vorschau wird vom Stapel genommen, nicht durch einen
  // zweiten Kamera-Screen ersetzt.
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
});

// Ohne Rückweg (per Deep Link direkt in die Vorschau) gibt es nichts vom
// Stapel zu nehmen, nur dort bleibt replace richtig.
test('ohne Rückweg im Stapel führt der Weg zurück per replace zur Kamera', async () => {
  mockKannZurueck = false;
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockReplace).toHaveBeenCalledWith('/aufnehmen');
  expect(mockBack).not.toHaveBeenCalled();
});

test('die Erfolgsanimation wird erst sichtbar, nachdem der Job eingereiht ist, und navigiert erst über ihr onFinished', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);
  // Vor dem Senden: die Animation ist unsichtbar.
  expect(mockAnimationSichtbar).toHaveBeenLastCalledWith(false);

  const reihenfolge: string[] = [];
  mockJobEinreihen.mockImplementation(async () => {
    reihenfolge.push('eingereiht');
  });
  mockBack.mockImplementation(() => {
    reihenfolge.push('navigiert');
  });

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockAnimationSichtbar).toHaveBeenLastCalledWith(true);
  expect(reihenfolge).toEqual(['eingereiht', 'navigiert']);
  // Die Navigation kommt genau einmal, aus genau einem onFinished.
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('die Erfolgsanimation bekommt den Zählerstand der Reise fürs Hochrollen', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  mockEigenerZaehler.mockResolvedValue(11);
  await render(<PreviewScreen />);
  expect(mockEigenerZaehler).toHaveBeenCalledWith('t1');

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockAnimationProps).toHaveBeenLastCalledWith({ visible: true, zaehler: 11 });
});

test('scheitert der Zählerabruf, läuft die Erfolgsanimation ohne Zahl', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  mockEigenerZaehler.mockRejectedValue(new Error('kaputte Warteschlange'));
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockAnimationProps).toHaveBeenLastCalledWith({ visible: true, zaehler: null });
});

// Gerätefund 2026-08-14: eine Übergabe ohne brauchbare uri (die iOS-Form von
// savePictureAsync vor der Begradigung in uebergabe.ts) liess das Einsenden
// KOMMENTARLOS abbrechen: kein Job, keine Meldung, der Screen stand einfach
// da. Fehlt die Quelle, muss das sichtbar scheitern wie jeder Sendefehler.
test('eine Übergabe ohne uri lässt das Einsenden sichtbar scheitern statt still', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  uebergabe.uebergeben({ ref: {}, datei: Promise.resolve({}) } as never);
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockJobEinreihen).not.toHaveBeenCalled();
  expect(screen.getByText(/konnte nicht gesichert werden/)).toBeTruthy();
  expect(mockAnimationSichtbar).toHaveBeenLastCalledWith(false);
});

test('bei einem Fehler beim Einreihen bleibt die Erfolgsanimation unsichtbar und nichts navigiert', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  mockJobEinreihen.mockRejectedValue(new Error('SQLITE_FULL'));
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockAnimationSichtbar).toHaveBeenLastCalledWith(false);
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

test('eine leere Caption wird als null statt als Leerstring eingereiht', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockJobEinreihen.mock.calls[0][0]).toMatchObject({ caption: null });
});

test('ein Video trägt seine Dauer in duration_s ein und ruft videoAufbereiten auf', async () => {
  mockParams = { uri: 'file://video.mp4', typ: 'video', dauer: '12', tripId: 't1' };
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockVideoAufbereiten).toHaveBeenCalledWith('file://video.mp4');
  expect(mockFotoAufbereiten).not.toHaveBeenCalled();
  expect(mockJobEinreihen.mock.calls[0][0]).toMatchObject({
    typ: 'video',
    duration_s: 12,
    storage_key: 'trips/t1/post-1.mp4',
  });
});

// Final-Review, Important 5: expo-camera nimmt auf iOS QuickTime auf. Bis zur
// Fix-Welle landete das unter ….mp4 mit Content-Type video/mp4, dauerhaft
// falsch etikettiert, und weil der Schlüssel pro Moment unveränderlich ist,
// nachträglich nicht mehr zu heilen.
test('eine iOS-Aufnahme (.mov) bekommt einen Schlüssel mit der tatsächlichen Endung', async () => {
  mockParams = { uri: 'file://video.mov', typ: 'video', dauer: '12', tripId: 't1' };
  mockVideoAufbereiten.mockResolvedValue({ medium: 'file://video.mov', thumb: 'file://thumb.jpg' });
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockJobEinreihen.mock.calls[0][0]).toMatchObject({
    storage_key: 'trips/t1/post-1.mov',
    // Das Thumbnail bleibt JPEG, unabhängig vom Container des Mediums.
    thumb_key: 'trips/t1/post-1_t.jpg',
  });
});

// Nachzug aus Task 8: der letzte Blick vor dem Versiegeln zeigt bei Videos
// «das Aufgenommene formatfüllend» (Spec) statt nur eines Symbols mit Dauer,
// stumm, in Schleife, ohne Bedienelemente (eine Vorschau, kein Player).
test('ein Video wird als stumme, endlos wiederholte Vorschau ohne Bedienelemente angezeigt', async () => {
  mockParams = { uri: 'file://video.mp4', typ: 'video', dauer: '12', tripId: 't1' };
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  expect(mockUseVideoPlayer).toHaveBeenCalledWith('file://video.mp4', expect.any(Function));
  expect(mockVideoPlayer.loop).toBe(true);
  expect(mockVideoPlayer.muted).toBe(true);
  // mixWithOthers: der Player beansprucht die Audio-Session nicht exklusiv —
  // sonst pausiert ihn der Mikrofon-Umbau des Kamera-Screens darunter kurz
  // nach dem Öffnen, und der Einstieg ruckelt (Gerätefund 2026-08-14).
  expect(mockVideoPlayer.audioMixingMode).toBe('mixWithOthers');
  expect(mockVideoPlayer.play).toHaveBeenCalled();
  expect(screen.getByTestId('video-vorschau')).toBeTruthy();
});

// Gerätefund 2026-08-14: der Kamera-Screen unter dieser Vorschau gibt beim
// Verlassen sein Mikrofon frei und baut dabei seine Capture-Session um —
// iOS pausiert währenddessen auch den stummen Player hier drüber, einmalig,
// kurz nach dem Öffnen. Ohne Antwort darauf stand jedes Video als Standbild.
function playingChangeHorcher(): ((e: { isPlaying: boolean }) => void) | undefined {
  const aufruf = mockVideoPlayer.addListener.mock.calls.find(
    ([ereignis]) => ereignis === 'playingChange'
  );
  return aufruf?.[1];
}

test('eine Fremd-Pause des Players wird sofort mit Weiterspielen beantwortet', async () => {
  mockParams = { uri: 'file://video.mp4', typ: 'video', dauer: '12', tripId: 't1' };
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  const horcher = playingChangeHorcher();
  expect(horcher).toBeDefined();
  mockVideoPlayer.play.mockClear();
  await act(async () => {
    horcher?.({ isPlaying: false });
  });
  expect(mockVideoPlayer.play).toHaveBeenCalled();
});

test('verschluckt der Session-Umbau das sofortige Weiterspielen, greift ein Nachzügler', async () => {
  mockParams = { uri: 'file://video.mp4', typ: 'video', dauer: '12', tripId: 't1' };
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);
  const horcher = playingChangeHorcher();
  expect(horcher).toBeDefined();

  jest.useFakeTimers();
  try {
    mockVideoPlayer.play.mockClear();
    mockVideoPlayer.playing = false;
    await act(async () => {
      horcher?.({ isPlaying: false });
      jest.advanceTimersByTime(300);
    });
    expect(mockVideoPlayer.play.mock.calls.length).toBeGreaterThanOrEqual(2);
  } finally {
    jest.useRealTimers();
  }
});

// Gerätefund 2026-08-14: weder Slide noch Blende — seit das Poster (Bild 0)
// sofort steht, gibt es keinen dunklen Frame mehr zu überbrücken, und der
// harte Schnitt vom lebendigen Sucher aufs volle Vorschaubild ist das
// Snapchat-Muster (§5-Ausnahme, Spec 2026-08-13 §6). Eine Blende würde den
// Wechsel nur künstlich verlangsamen.
test('der Wechsel von der Kamera hierher schneidet hart, ohne Slide und ohne Blende', async () => {
  mockParams = { uri: 'file://video.mp4', typ: 'video', dauer: '12', tripId: 't1' };
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  expect(mockStackScreenOptionen).toHaveBeenCalledWith(
    expect.objectContaining({ animation: 'none' })
  );
});

// Der vorgewärmte Player aus der Übergabe (Gerätefund 2026-08-14,
// Snapchat-Massstab): die Kamera erzeugt und lädt ihn VOR der Navigation,
// die Vorschau zeigt ihn nur noch — und gibt ihn beim Verlassen frei
// (createVideoPlayer verlangt ein explizites release, sonst leckt der
// native Player).
function vorgewaermterPlayer() {
  return {
    playing: true,
    play: jest.fn(),
    release: jest.fn(),
    addListener: jest.fn(
      (_ereignis: string, _horcher: (e: { isPlaying: boolean }) => void) => ({ remove: jest.fn() })
    ),
  };
}

test('ein vorgewärmter Player aus der Übergabe geht direkt an die VideoView', async () => {
  mockParams = { uri: 'file://video.mp4', typ: 'video', dauer: '12', tripId: 't1' };
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  const player = vorgewaermterPlayer();
  uebergabe.videoUebergeben({ art: 'player', player: player as unknown as VideoPlayer, poster: null });
  await render(<PreviewScreen />);

  expect(screen.getByTestId('video-vorschau').props.player).toBe(player);
  // Kein zweites Laden derselben Datei: der eigene Hook bekommt keine Quelle.
  expect(mockUseVideoPlayer).toHaveBeenCalledWith(null, expect.any(Function));
});

// Das Poster (Bild 0, vom Stopp mitgeliefert) steht sofort über der
// VideoView — die braucht am Gerät ~0,8 s zum ersten Zeichnen (gemessen
// 2026-08-14) — und weicht dann unsichtbar, weil die Schleife bei Bild 0
// beginnt.
test('das Poster steht sofort über dem Video und weicht dem ersten gezeichneten Bild', async () => {
  mockParams = { uri: 'file://video.mp4', typ: 'video', dauer: '12', tripId: 't1' };
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  const player = vorgewaermterPlayer();
  uebergabe.videoUebergeben({
    art: 'player',
    player: player as unknown as VideoPlayer,
    poster: 'file://poster.jpg',
  });
  await render(<PreviewScreen />);

  expect(screen.getByTestId('video-poster').props.source).toEqual({ uri: 'file://poster.jpg' });

  await act(async () => {
    screen.getByTestId('video-vorschau').props.onFirstFrameRender();
  });
  expect(screen.queryByTestId('video-poster')).toBeNull();
});

test('der übernommene Player wird beim Verlassen freigegeben, das Poster aufgeräumt', async () => {
  mockParams = { uri: 'file://video.mp4', typ: 'video', dauer: '12', tripId: 't1' };
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  const player = vorgewaermterPlayer();
  uebergabe.videoUebergeben({
    art: 'player',
    player: player as unknown as VideoPlayer,
    poster: 'file://poster.jpg',
  });
  const { unmount } = await render(<PreviewScreen />);

  expect(player.release).not.toHaveBeenCalled();
  await act(async () => {
    unmount();
  });
  expect(player.release).toHaveBeenCalled();
  expect(mockDateiVerwerfen).toHaveBeenCalledWith('file://poster.jpg');
});

test('auch der übernommene Player wird bei einer Fremd-Pause weitergespielt', async () => {
  mockParams = { uri: 'file://video.mp4', typ: 'video', dauer: '12', tripId: 't1' };
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  const player = vorgewaermterPlayer();
  uebergabe.videoUebergeben({ art: 'player', player: player as unknown as VideoPlayer, poster: null });
  await render(<PreviewScreen />);

  const aufruf = player.addListener.mock.calls.find(([ereignis]) => ereignis === 'playingChange');
  const horcher = aufruf?.[1];
  expect(horcher).toBeDefined();
  player.play.mockClear();
  await act(async () => {
    horcher?.({ isPlaying: false });
  });
  expect(player.play).toHaveBeenCalled();
});

test('bei einem Foto wird kein Video-Player angelegt', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  expect(mockUseVideoPlayer).toHaveBeenCalledWith(null, expect.any(Function));
  expect(screen.queryByTestId('video-vorschau')).toBeNull();
});

test('Verwerfen reiht nichts ein, räumt die Rohaufnahme weg und geht zurück zur Kamera', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  // Verwerfen ist das X in der Kopfzeile, kein Textknopf mehr neben dem
  // Einsenden: es ist der Rückweg, keine gleichrangige Alternative.
  await fireEvent.press(screen.getByTestId('verwerfen-knopf'));

  expect(mockJobEinreihen).not.toHaveBeenCalled();
  expect(mockFotoAufbereiten).not.toHaveBeenCalled();
  // Critical 2: auch dieser Weg hinterliess bisher eine Datei im Cache.
  expect(mockDateiVerwerfen).toHaveBeenCalledWith('file://foto.jpg');
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('erst nach dem Einreihen werden Rohaufnahme und Zwischenfassungen freigegeben', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockDauerhaftSichern).toHaveBeenCalledWith('post-1', {
    medium: 'file://medium.jpg',
    thumb: 'file://thumb.jpg',
  });
  expect(mockDateiVerwerfen).toHaveBeenCalledWith('file://foto.jpg');
  expect(mockZwischenfassungenVerwerfen).toHaveBeenCalledWith('file://foto.jpg', {
    medium: 'file://medium.jpg',
    thumb: 'file://thumb.jpg',
  });
  expect(mockMomentDateienEntfernen).not.toHaveBeenCalled();
});

// Ohne Job in der Warteschlange käme nie wieder jemand an diesen Dateien
// vorbei, der sie aufräumt, sie lägen für immer im Dokumentenverzeichnis.
test('scheitert das Einreihen, wird der dauerhafte Ordner wieder abgeräumt', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  mockJobEinreihen.mockRejectedValue(new Error('SQLITE_FULL'));
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockMomentDateienEntfernen).toHaveBeenCalledWith('post-1');
  // Die Rohaufnahme bleibt: der Screen bleibt stehen, ein zweiter Versuch
  // braucht sie noch.
  expect(mockDateiVerwerfen).not.toHaveBeenCalled();
});

// === Re-Review: der Aufräumpfad vernichtete bei Videos die Aufnahme ===
// videoAufbereiten gibt die Rohaufnahme SELBST als Medium zurück. Solange
// dauerhaftSichern verschob, nahm der Fehlerpfad (momentDateienEntfernen) die
// einzige Kopie mit: ein zweiter Druck auf «Einsenden» scheiterte schon beim
// Standbild, der Moment war weg. Der Foto-Test darüber hat die Lücke
// durchgelassen, weil fotoAufbereiten ohnehin neue Dateien erzeugt.
test('bei einem Video überlebt die Rohaufnahme ein gescheitertes Einreihen', async () => {
  mockParams = { uri: 'file://video.mov', typ: 'video', dauer: '12', tripId: 't1' };
  // Genau der Fall: medium IST die Rohaufnahme.
  mockVideoAufbereiten.mockResolvedValue({ medium: 'file://video.mov', thumb: 'file://thumb.jpg' });
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  mockJobEinreihen.mockRejectedValue(new Error('SQLITE_FULL'));
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  // Die dauerhafte KOPIE wird abgeräumt, sie ist ohne Job herrenlos.
  expect(mockMomentDateienEntfernen).toHaveBeenCalledWith('post-1');
  // Die Rohaufnahme aber unter keinen Umständen: sie ist die einzige Kopie.
  expect(mockDateiVerwerfen).not.toHaveBeenCalledWith('file://video.mov');
  expect(mockDateiVerwerfen).not.toHaveBeenCalled();
  // Und auch nicht über den Umweg „Zwischenfassungen": die Funktion bekommt
  // die Rohaufnahme mit, damit sie genau diese auslassen kann.
  expect(mockZwischenfassungenVerwerfen).toHaveBeenCalledWith('file://video.mov', {
    medium: 'file://video.mov',
    thumb: 'file://thumb.jpg',
  });
});

// Die Probe aufs Exempel: der zweite Versuch läuft wirklich durch.
test('nach einem gescheiterten Einsenden gelingt der zweite Versuch bei einem Video', async () => {
  mockParams = { uri: 'file://video.mov', typ: 'video', dauer: '12', tripId: 't1' };
  mockVideoAufbereiten.mockResolvedValue({ medium: 'file://video.mov', thumb: 'file://thumb.jpg' });
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  mockJobEinreihen.mockRejectedValueOnce(new Error('SQLITE_FULL'));
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });
  expect(await screen.findByText(/Speicherplatz/)).toBeTruthy();

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockVideoAufbereiten).toHaveBeenCalledTimes(2);
  expect(mockJobEinreihen).toHaveBeenCalledTimes(2);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

// Der Kopiervorgang selbst scheitert (kein Platz): auch dann muss die Aufnahme
// überleben, genau dafür wird kopiert statt verschoben.
test('scheitert schon das dauerhafte Sichern, bleibt die Rohaufnahme liegen', async () => {
  mockParams = { uri: 'file://video.mov', typ: 'video', dauer: '12', tripId: 't1' };
  mockVideoAufbereiten.mockResolvedValue({ medium: 'file://video.mov', thumb: 'file://thumb.jpg' });
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  mockDauerhaftSichern.mockRejectedValue(new Error('ENOSPC'));
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockDateiVerwerfen).not.toHaveBeenCalled();
  expect(await screen.findByText(/Speicherplatz/)).toBeTruthy();
});

test('ein Fehler beim Aufbereiten reiht keinen Job ein, zeigt eine Meldung und der Screen bleibt stehen', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  mockFotoAufbereiten.mockRejectedValue(new Error('ENOSPC: no space left on device'));
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockJobEinreihen).not.toHaveBeenCalled();
  expect(mockBack).not.toHaveBeenCalled();
  expect(await screen.findByText(/Speicherplatz/)).toBeTruthy();
  // Der Screen bleibt stehen, Einsenden ist weiterhin da und lässt sich
  // erneut versuchen.
  expect(screen.getByText('Einsenden')).toBeTruthy();
});

test('ein Fehler beim Einreihen reiht keinen zweiten Versuch fälschlich als Erfolg und der Screen bleibt stehen', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  mockJobEinreihen.mockRejectedValue(new Error('SQLITE_FULL'));
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockBack).not.toHaveBeenCalled();
  expect(await screen.findByText(/Speicherplatz/)).toBeTruthy();
});

test('ohne trip_id (Navigationslücke aus dem Kamera-Screen) wird das Einsenden mit klarer Ursache abgelehnt', async () => {
  mockParams = { uri: 'file://foto.jpg', typ: 'photo', dauer: '0', tripId: undefined };
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockFotoAufbereiten).not.toHaveBeenCalled();
  expect(mockJobEinreihen).not.toHaveBeenCalled();
  expect(mockBack).not.toHaveBeenCalled();
  expect(await screen.findByText(/keiner Reise zuordnen/)).toBeTruthy();
});

// Task-13-Fix-Runde-2: ein Job ohne Autoren-Kennung darf nie entstehen, in
// der Praxis lässt das Root-Layout diesen Screen ohne Sitzung gar nicht erst
// zu, aber der Screen rät hier bewusst nicht, sondern lehnt sichtbar ab
// (gleiches Prinzip wie ohne trip_id oben).
test('ohne Sitzung (userId fehlt) wird das Einsenden abgelehnt, statt einen Job ohne Autoren-Kennung einzureihen', async () => {
  mockAuth.userId = null;
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockFotoAufbereiten).not.toHaveBeenCalled();
  expect(mockJobEinreihen).not.toHaveBeenCalled();
  expect(mockBack).not.toHaveBeenCalled();
  expect(await screen.findByText(/nicht angemeldet/)).toBeTruthy();
});

test('setzt die StatusBar beim Erscheinen auf hell und beim Verlassen zurück auf dunkel', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  const { unmount } = await render(<PreviewScreen />);
  expect(mockSetStatusBarStyle).toHaveBeenCalledWith('light');
  await unmount();
  expect(mockSetStatusBarStyle).toHaveBeenCalledWith('dark');
});

test('ein zweiter Tipp auf Einsenden während des Sendens reiht keinen zweiten Job ein', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  let aufloesen: (v: { medium: string; thumb: string }) => void = () => {};
  mockFotoAufbereiten.mockImplementation(
    () =>
      new Promise((resolve) => {
        aufloesen = resolve;
      })
  );
  await render(<PreviewScreen />);
  const knopf = screen.getByTestId('einsenden-knopf');

  await fireEvent.press(knopf);
  await fireEvent.press(knopf);

  await act(async () => {
    aufloesen({ medium: 'file://medium.jpg', thumb: 'file://thumb.jpg' });
  });
  await waitFor(() => expect(mockBack).toHaveBeenCalled());

  expect(mockFotoAufbereiten).toHaveBeenCalledTimes(1);
  expect(mockJobEinreihen).toHaveBeenCalledTimes(1);
});

// Die Bildunterschrift lag hinter der stehenden Tastatur, und aus dem
// mehrzeiligen Feld kam man nicht mehr heraus: Return setzt dort einen
// Zeilenumbruch, iOS bietet keine Fertig-Taste an, und alle anderen
// Bedienelemente des Screens lagen selbst unter der Tastatur. Die
// KeyboardAvoidingView, die das verhindern sollte, konnte hier nie wirken:
// sie setzt bei `behavior="padding"` nur ein `paddingBottom` an ihrem eigenen
// View, und dieses Padding erreicht absolut positionierte Kinder nicht. Auf
// diesem Screen ist aber JEDE Ebene absolut positioniert. Der Screen weicht
// deshalb selbst aus, anhand der gemeldeten Tastaturhöhe.
describe('stehende Tastatur', () => {
  const zuhoerer: Record<string, (e: unknown) => void> = {};
  let dismiss: jest.SpyInstance;

  // Der Name des Ereignisses ist plattformabhängig: iOS meldet die Tastatur
  // an, bevor sie steht (will), Android erst danach (did). Der Test spricht
  // denselben Zuhörer an, den der Screen auf der jeweiligen Plattform bestellt.
  const ZEIGEN = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
  const VERBERGEN = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
  const TASTATUR_HOEHE = 336;

  beforeEach(() => {
    for (const schluessel of Object.keys(zuhoerer)) delete zuhoerer[schluessel];
    jest
      .spyOn(Keyboard, 'addListener')
      .mockImplementation(((typ: string, rueckruf: (e: unknown) => void) => {
        zuhoerer[typ] = rueckruf;
        return { remove: jest.fn() };
      }) as unknown as typeof Keyboard.addListener);
    dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function tastaturAuf(hoehe = TASTATUR_HOEHE) {
    await act(async () => {
      zuhoerer[ZEIGEN]?.({
        endCoordinates: { height: hoehe, screenX: 0, screenY: 812 - hoehe, width: 390 },
        duration: 250,
        easing: 'keyboard',
      });
    });
  }

  async function tastaturZu() {
    await act(async () => {
      zuhoerer[VERBERGEN]?.({
        endCoordinates: { height: 0, screenX: 0, screenY: 812, width: 390 },
        duration: 250,
        easing: 'keyboard',
      });
    });
  }

  function unterkanteDerBildunterschrift(): number {
    const feld = screen.getByTestId('bildunterschrift-feld');
    return StyleSheet.flatten(feld.props.style).bottom as number;
  }

  test('die Bildunterschrift rückt direkt über die stehende Tastatur', async () => {
    await render(<PreviewScreen />);
    await tastaturAuf();

    // Auf iOS bleibt das Fenster gleich gross, der Screen muss die volle
    // Tastaturhöhe selbst überbrücken. Auf Android verkleinert das Fenster
    // sich bereits (softwareKeyboardLayoutMode "resize", Expo-Standard), dort
    // zählt nur noch der gestaltete Abstand zur neuen Unterkante.
    const erwartet = Platform.OS === 'ios' ? TASTATUR_HOEHE + spacing.base : spacing.base;
    expect(unterkanteDerBildunterschrift()).toBe(erwartet);
  });

  // Beim Tippen tauscht iOS die Leiste über den Tasten aus (der
  // «Write with Siri»-Hinweis weicht den Wortvorschlägen) und meldet dabei
  // eine andere Tastaturhöhe. Folgte das Feld jeder Meldung, ruckte es beim
  // Schreiben auf und ab. Es hält deshalb die grösste gemeldete Höhe: lieber
  // ein paar Punkte zu hoch stehen als wackeln.
  test('eine schrumpfende Tastatur zieht das Feld nicht mit nach unten', async () => {
    await render(<PreviewScreen />);
    await bildunterschriftOeffnen();
    await tastaturAuf(TASTATUR_HOEHE);
    const stand = unterkanteDerBildunterschrift();

    await tastaturAuf(TASTATUR_HOEHE - 45);

    expect(unterkanteDerBildunterschrift()).toBe(stand);
  });

  // Andersherum muss es mitgehen, sonst verschwände das Feld hinter einer
  // Tastatur, die höher wird (Emoji-Tastatur, andere Sprache).
  test('eine wachsende Tastatur schiebt das Feld weiter hoch', async () => {
    await render(<PreviewScreen />);
    await bildunterschriftOeffnen();
    await tastaturAuf(TASTATUR_HOEHE);
    const stand = unterkanteDerBildunterschrift();

    await tastaturAuf(TASTATUR_HOEHE + 60);

    expect(unterkanteDerBildunterschrift()).toBeGreaterThan(stand);
  });

  test('nach dem Schliessen steht die Bildunterschrift wieder an ihrem Platz', async () => {
    await render(<PreviewScreen />);
    const ruhe = unterkanteDerBildunterschrift();

    await tastaturAuf();
    await tastaturZu();

    expect(unterkanteDerBildunterschrift()).toBe(ruhe);
  });

  // Der Weg aus dem Feld, den die Tastatur selbst anbietet: Bei einem
  // EINZEILIGEN Feld heisst die Eingabetaste unten rechts «Fertig» und
  // schliesst. Bei `multiline` setzt dieselbe Taste einen Zeilenumbruch, es
  // gibt dann gar keine Fertig-Taste, und genau daran blieb man hängen.
  test('die Eingabetaste schliesst die Tastatur, statt eine Zeile umzubrechen', async () => {
    await render(<PreviewScreen />);
    await bildunterschriftOeffnen();
    const feld = screen.getByLabelText('Bildunterschrift');

    expect(feld.props.multiline).toBeFalsy();
    expect(feld.props.returnKeyType).toBe('done');

    await fireEvent(feld, 'submitEditing');

    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test('ein Tipp neben das Feld schliesst die Tastatur', async () => {
    await render(<PreviewScreen />);
    expect(screen.queryByLabelText('Tastatur schliessen')).toBeNull();

    await tastaturAuf();
    await fireEvent.press(screen.getByLabelText('Tastatur schliessen'));

    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  // Der Auffangbereich liegt über dem ganzen Medium. Läge er über den
  // Bedienelementen, wäre der erste Tipp auf «Einsenden» nach dem Schreiben
  // verschluckt.
  test('bei stehender Tastatur bleibt das Feld selbst bedienbar', async () => {
    await render(<PreviewScreen />);
    await bildunterschriftOeffnen();
    await tastaturAuf();

    await fireEvent.changeText(screen.getByLabelText('Bildunterschrift'), 'Abendlicht');

    expect(screen.getByLabelText('Bildunterschrift').props.value).toBe('Abendlicht');
    expect(dismiss).not.toHaveBeenCalled();
  });
});

// Die Bildunterschrift und der Einsenden-Knopf gehören zusammen: Vorher stand
// sie an einer festen Zahl (168) und liess eine Lücke von einem halben
// Bildschirm zwischen sich und dem Knopf. Jetzt hängt sie an der GEMESSENEN
// Höhe des Fusses, damit sie auch dann direkt darüber steht, wenn eine
// Fehlermeldung den Fuss wachsen lässt.
test('die Bildunterschrift hängt an der gemessenen Höhe des Fusses, nicht an einer festen Zahl', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  // Im Test gibt es keine Layout-Phase, die Höhe kommt darum von Hand.
  await act(async () => {
    fireEvent(screen.getByTestId('fuss'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 52 } },
    });
  });

  // Insets sind im Test 0 (siehe jest.setup.ts). Ohne Home-Indicator bleibt
  // vom Fuss-Abstand der gestaltete Mindestrand spacing.base.
  const unterkante = spacing.base;
  const feld = screen.getByTestId('bildunterschrift-feld');
  expect(StyleSheet.flatten(feld.props.style).bottom).toBe(unterkante + 52 + spacing.base);
});

// Ein leeres Eingabefeld über die ganze Breite ist ein Kasten, der nichts
// zeigt und dem Foto den Platz nimmt. In Ruhe steht deshalb nur ein Chip da,
// so breit wie sein Text; das Feld entsteht erst mit dem Tipp darauf.
test('in Ruhe steht nur ein Chip, das Eingabefeld kommt erst mit dem Tipp darauf', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  expect(screen.queryByLabelText('Bildunterschrift')).toBeNull();
  expect(screen.getByText('Schreib etwas dazu')).toBeTruthy();

  await bildunterschriftOeffnen();

  expect(screen.getByLabelText('Bildunterschrift')).toBeTruthy();
  expect(screen.queryByTestId('bildunterschrift-chip')).toBeNull();
});

// Auf iOS legt eine gesetzte Zeilenhöhe im Eingabefeld einen Absatz-Stil über
// den EINGEGEBENEN Text, nicht aber über den Platzhalter: Der Text sprang
// dadurch beim ersten Zeichen ein paar Punkte nach unten. `type.body` bringt
// eine mit (24), das Feld darf sie deshalb nicht übernehmen.
test('das Eingabefeld setzt keine Zeilenhöhe', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);
  await bildunterschriftOeffnen();

  const stil = StyleSheet.flatten(screen.getByLabelText('Bildunterschrift').props.style);
  expect(stil.lineHeight).toBeUndefined();
  expect(stil.fontSize).toBe(16);
});

// ——— Instant-Foto (Spec 2026-08-13-aufnahme-tempo-design.md §4) ———
//
// Das Foto kommt als natives Speicher-Objekt über das Übergabe-Modul, nicht
// mehr als Datei-URI durch die Params. Die Datei entsteht im Hintergrund;
// Einsenden wartet auf sie, der Rest der Pipeline bleibt unverändert.
const fakeRef = { breite: 1920 } as never;

test('ein übergebenes Foto wird aus dem Speicher angezeigt', async () => {
  mockParams = { typ: 'photo', dauer: '0', tripId: 't1' };
  uebergabe.uebergeben({ ref: fakeRef, datei: Promise.resolve({ uri: 'file://gespeichert.jpg' }) });
  await render(<PreviewScreen />);
  expect(screen.getByTestId('foto-vorschau').props.source).toBe(fakeRef);
});

test('Einsenden wartet auf die im Hintergrund gespeicherte Datei', async () => {
  mockParams = { typ: 'photo', dauer: '0', tripId: 't1' };
  let dateiAufloesen: (v: { uri: string }) => void = () => {};
  uebergabe.uebergeben({
    ref: fakeRef,
    datei: new Promise((resolve) => {
      dateiAufloesen = resolve;
    }),
  });
  await render(<PreviewScreen />);
  await fireEvent.press(screen.getByTestId('einsenden-knopf'));

  // Vor der Datei darf nichts aufbereitet werden.
  expect(mockFotoAufbereiten).not.toHaveBeenCalled();

  await act(async () => {
    dateiAufloesen({ uri: 'file://gespeichert.jpg' });
  });
  await waitFor(() => expect(mockFotoAufbereiten).toHaveBeenCalledWith('file://gespeichert.jpg'));
});

test('scheitert das Hintergrund-Speichern, sagt es der bestehende Fehlerpfad', async () => {
  mockParams = { typ: 'photo', dauer: '0', tripId: 't1' };
  uebergabe.uebergeben({ ref: fakeRef, datei: Promise.reject(new Error('voll')) });
  await render(<PreviewScreen />);
  await fireEvent.press(screen.getByTestId('einsenden-knopf'));
  expect(
    await screen.findByText(
      'Der Moment konnte nicht gesichert werden, oft weil kein Speicherplatz mehr frei ist. Räum etwas Platz frei und versuch es nochmal.'
    )
  ).toBeTruthy();
  expect(mockJobEinreihen).not.toHaveBeenCalled();
});

test('Verwerfen räumt auch die im Hintergrund entstandene Datei ab', async () => {
  mockParams = { typ: 'photo', dauer: '0', tripId: 't1' };
  uebergabe.uebergeben({ ref: fakeRef, datei: Promise.resolve({ uri: 'file://gespeichert.jpg' }) });
  await render(<PreviewScreen />);
  await fireEvent.press(screen.getByTestId('verwerfen-knopf'));
  await waitFor(() => expect(mockDateiVerwerfen).toHaveBeenCalledWith('file://gespeichert.jpg'));
  expect(mockBack).toHaveBeenCalled();
});

test('ohne Übergabe und ohne uri führt die Vorschau zurück zur Kamera', async () => {
  mockParams = { typ: 'photo', dauer: '0', tripId: 't1' };
  await render(<PreviewScreen />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/aufnehmen'));
});
