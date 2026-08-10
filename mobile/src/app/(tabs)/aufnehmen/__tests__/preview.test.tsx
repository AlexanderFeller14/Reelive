import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import * as React from 'react';

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
jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockReplace,
    back: mockBack,
    push: jest.fn(),
    canGoBack: () => mockKannZurueck,
  }),
  useLocalSearchParams: () => mockParams,
}));

const mockSetStatusBarStyle = jest.fn();
jest.mock('expo-status-bar', () => ({
  setStatusBarStyle: (...args: unknown[]) => mockSetStatusBarStyle(...args),
}));

// expo-video braucht ein natives Modul, das es in diesem Jest-Setup nicht
// gibt (gleiche Einschränkung wie expo-image in Task 8, siehe dessen
// Bericht), deshalb gemockt statt real importiert. `useVideoPlayer` liefert
// ein greifbares Fake-Player-Objekt, damit der Video-Nachzug prüfen kann,
// dass die Vorschau stumm und in Schleife läuft.
const mockVideoPlayer = { loop: false, muted: false, play: jest.fn() };
const mockUseVideoPlayer = jest.fn((source: unknown, setup?: (p: typeof mockVideoPlayer) => void) => {
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

// Die echte Inszenierung (Task 9) läuft 700–900 ms und ist bereits für sich
// getestet (Versiegelung.test.tsx), hier interessiert nur der Vertrag „wird
// sichtbar, sobald der Job eingereiht ist, und navigiert über onFertig weiter".
// Der Mock feuert onFertig synchron, sobald er sichtbar wird, damit die
// bestehenden Erwartungen an mockReplace ohne Timer-Steuerung auskommen.
const mockVersiegelungSichtbar = jest.fn();
jest.mock('@/components/Versiegelung', () => {
  const react = jest.requireActual('react');
  return {
    Versiegelung: ({ sichtbar, onFertig }: { sichtbar: boolean; onFertig: () => void }) => {
      mockVersiegelungSichtbar(sichtbar);
      react.useEffect(() => {
        if (sichtbar) onFertig();
      }, [sichtbar, onFertig]);
      return null;
    },
  };
});

import PreviewScreen from '../preview';

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

beforeEach(() => {
  jest.clearAllMocks();
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
  mockJetzt.mockReturnValue({ captured_at: CAPTURED_AT, captured_tz: 'Europe/Zurich' });
  mockKannZurueck = true;
  // Standardmässig hängend (nie auflösend): jeder Test, der eine bestimmte
  // Antwort braucht, überschreibt das explizit. So bleibt sichtbar, dass die
  // Anzeige nicht auf den Ort wartet, bevor sie den Screen zeigt.
  mockOrtBestimmen.mockImplementation(() => new Promise(() => {}));
});

test('die Aufnahme erscheint sofort, ohne auf den Ort zu warten', async () => {
  await render(<PreviewScreen />);
  expect(await screen.findByText('Einsenden')).toBeTruthy();
});

test('eine Caption über 120 Zeichen wird begrenzt', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);
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

test('die Versiegelung wird erst sichtbar, nachdem der Job eingereiht ist, und navigiert erst über ihr onFertig', async () => {
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);
  // Vor dem Senden: die Inszenierung ist unsichtbar.
  expect(mockVersiegelungSichtbar).toHaveBeenLastCalledWith(false);

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

  expect(mockVersiegelungSichtbar).toHaveBeenLastCalledWith(true);
  expect(reihenfolge).toEqual(['eingereiht', 'navigiert']);
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
  expect(mockVideoPlayer.play).toHaveBeenCalled();
  expect(screen.getByTestId('video-vorschau')).toBeTruthy();
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

  await fireEvent.press(screen.getByText('Verwerfen'));

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
