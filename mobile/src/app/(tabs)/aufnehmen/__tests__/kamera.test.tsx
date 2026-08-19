import { render, screen, fireEvent, act } from '@testing-library/react-native';
import * as React from 'react';
import { Animated, Easing, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { cinema, palette, spacing } from '@/theme/tokens';
import * as kinoBuehne from '@/features/kamera/kinoBuehne';
import type { Trip } from '@/features/trips/types';

const mockPush = jest.fn();

// useFocusEffect als echter Effekt statt als Aufruf beim Rendern.
//
// Die Vorfassung rief den Callback bei JEDEM Rendern auf (wie in
// reise/__tests__/liste.test.tsx). Das ging nur so lange gut, wie `laden()`
// bei gleichbleibendem Ergebnis dieselbe Array-Referenz zurücksetzte und
// React deshalb aus dem Rendern ausstieg, sobald der Ladeweg eine neue Liste
// erzeugt (etwa den aus dem Speicher geparsten Bestand, Critical 1), dreht
// sich das endlos. Ein Effekt mit Abhängigkeiten bildet das echte Verhalten
// ohnehin näher ab: einmal beim Fokussieren, nicht bei jedem Rendern.
//
// `mockFokusStand`/`mockFokusHoerer` machen ein erneutes Fokussieren
// auslösbar (siehe erneutFokussieren), Voraussetzung dafür, dass sich der
// Zähler-Nachzug beim Zurückkehren aus der Vorschau überhaupt prüfen lässt.
const mockFokusHoerer = new Set<(stand: number) => void>();
let mockFokusStand = 0;

jest.mock('expo-router', () => {
  const ReactActual = require('react');
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      const [stand, setStand] = ReactActual.useState(mockFokusStand);
      ReactActual.useEffect(() => {
        mockFokusHoerer.add(setStand);
        return () => {
          mockFokusHoerer.delete(setStand);
        };
      }, []);
      // Ein negativer Stand heisst «nicht fokussiert» (siehe fokusVerlieren):
      // der laufende Effekt räumt auf (Dep-Wechsel) und startet nicht neu —
      // genau das Verhalten des echten useFocusEffect beim Blur.
      ReactActual.useEffect(() => {
        if (stand < 0) return;
        return cb();
      }, [cb, stand]);
    },
  };
});

// Simuliert die Rückkehr auf den Screen (z.B. aus der Vorschau).
async function erneutFokussieren() {
  mockFokusStand = Math.abs(mockFokusStand) + 1;
  await act(async () => {
    mockFokusHoerer.forEach((setzen) => setzen(mockFokusStand));
  });
}

// Simuliert das Verlassen des Screens (Vorschau überdeckt den Tab, oder ein
// anderer Tab wird gewählt): die Fokus-Effekte räumen auf und bleiben aus,
// bis erneutFokussieren() den Fokus zurückbringt.
async function fokusVerlieren() {
  mockFokusStand = -Math.abs(mockFokusStand) - 1;
  await act(async () => {
    mockFokusHoerer.forEach((setzen) => setzen(mockFokusStand));
  });
}

// expo-image ist ein natives View, im Test reicht ein Platzhalter, der alle
// Props durchreicht (gleiches Muster wie recap/__tests__/liste.test.tsx). Ohne
// Mock scheitert schon der Import, expo-image/src/observe.ts erwartet eine
// native Umgebung.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

// Synchron gemockt statt über AccessibilityInfo (Muster aus Sheet.test.tsx):
// der echte Hook liefert seinen Wert erst asynchron nach, der Screen liefe
// dann kurz mit Bewegung an, bevor er sie zurücknimmt, und der Test prüfte
// diesen Übergang statt der Regel.
const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/theme/useReducedMotion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

jest.mock('@/features/trips/tripsApi', () => ({ fetchTrips: jest.fn() }));

// Der lokale Reise-Bestand (Final-Review, Critical 1) wird hier NICHT gemockt,
// sondern echt benutzt, nur AsyncStorage darunter ist ein Doppelgänger. So
// prüft der Offline-Test wirklich den Weg «erfolgreicher Abruf schreibt fort →
// gescheiterter Abruf greift darauf zurück», statt einen Mock zu befragen.
const mockSpeicher = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (key: string) => mockSpeicher.get(key) ?? null,
  setItem: async (key: string, wert: string) => {
    mockSpeicher.set(key, wert);
  },
}));

const mockAuth: { userId: string | null } = { userId: 'u1' };
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));

// Task 10 (Nachzug aus Task 9): der Zähler in der Kopf-Pille kommt aus
// eigenerZaehler (Serverstand + wartende Momente derselben Reise), nicht
// mehr aus reise.my_post_count, sonst bewegt er sich nach einer Offline-
// Aufnahme nicht (Spec §7). Default 0, einzelne Tests überschreiben mit
// mockResolvedValueOnce passend zum jeweiligen Trip-Fixture.
const mockEigenerZaehler = jest.fn(async (_tripId: string) => 0);
jest.mock('@/features/moments/zaehler', () => ({
  eigenerZaehler: (tripId: string) => mockEigenerZaehler(tripId),
}));

const mockSetStatusBarStyle = jest.fn();
jest.mock('expo-status-bar', () => ({
  setStatusBarStyle: (...args: unknown[]) => mockSetStatusBarStyle(...args),
}));

const mockOpenSettings = jest.fn();
jest.mock('expo-linking', () => ({ openSettings: () => mockOpenSettings() }));

// jest.setup.ts stellt allen Suiten Insets 0 hin, also ein Gerät ohne Dynamic
// Island. Für den Sucher ist genau der andere Fall der interessante: was oben
// auf dem Kamerabild liegt, darf nicht hinter die Uhr geraten, auch wenn das
// Bild selbst randlos bleibt. Deshalb hier ein steuerbarer Ersatz, der den
// globalen Mock für diese Datei überschreibt.
let mockInsets = { top: 0, left: 0, right: 0, bottom: 0 };
jest.mock('react-native-safe-area-context', () => ({
  ...require('react-native-safe-area-context/jest/mock').default,
  useSafeAreaInsets: () => mockInsets,
}));

const mockTakePictureAsync = jest.fn();
const mockRecordAsync = jest.fn();
const mockStopRecording = jest.fn();
const mockPausePreview = jest.fn();
const mockResumePreview = jest.fn();
const mockSavePictureAsync = jest.fn();

type PermissionMock = { status: string; granted: boolean; canAskAgain: boolean; expires: 'never' };
const GEWAEHRT: PermissionMock = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
let mockCameraPermission: PermissionMock = GEWAEHRT;
let mockMicPermission: PermissionMock = GEWAEHRT;
const mockRequestCameraPermission = jest.fn();
const mockRequestMicPermission = jest.fn();

// Merkt sich die zuletzt gerenderten Props, damit sich prüfen lässt, was die
// Kamera tatsächlich bekommt (Richtung, Blitz), Important 7.
const mockCameraProps = jest.fn();
jest.mock('expo-camera', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    CameraView: ReactActual.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      mockCameraProps(props);
      ReactActual.useImperativeHandle(ref, () => ({
        takePictureAsync: mockTakePictureAsync,
        recordAsync: mockRecordAsync,
        stopRecording: mockStopRecording,
        pausePreview: mockPausePreview,
        resumePreview: mockResumePreview,
      }));
      // Eine leere View mit fester Kennung statt `null`: seit der Sucher zwei
      // Zweige hat (MultiCam-Session oder CameraView), muss sich prüfen
      // lassen, WELCHER von beiden im Bild steht. Die Props gehen bewusst
      // nicht mit hinein, gelesen werden sie über mockCameraProps.
      return ReactActual.createElement(View, { testID: 'kameraview-attrappe' });
    }),
    useCameraPermissions: () => [mockCameraPermission, mockRequestCameraPermission, jest.fn()],
    useMicrophonePermissions: () => [mockMicPermission, mockRequestMicPermission, jest.fn()],
  };
});

// Die Zoom-Stufen kommen vom Gerät (modules/kamera-zoom, Swift). Im Test gibt
// es kein natives Modul und am Simulator keine Kamera, hier steht darum ein
// nachgebautes iPhone 17 Pro Max: Ultraweitwinkel, Haupt und Tele in einem
// virtuellen Gerät, das bei den Faktoren 2 und 8 die Linse wechselt — was der
// Oberfläche als 0,5× / 1× / 4× erscheint.
const DREIFACH = {
  name: 'Rückseitige Dreifach-Kamera',
  typ: 'triple',
  bestandteile: ['ultraWide', 'wide', 'telephoto'],
  umschaltpunkte: [2, 8],
};
const EINZELN = { name: 'Frontkamera', typ: 'wide', bestandteile: [], umschaltpunkte: [] };

const mockNativeLinsen = jest.fn((position: string) => (position === 'back' ? [DREIFACH] : [EINZELN]));
const mockSetzeZoom = jest.fn();
const mockZoomGrenzen = jest.fn((_name: string) => ({ min: 1, max: 120 }));
const mockFokussiere = jest.fn();
// Der vorgewärmte Video-Player (Gerätefund 2026-08-14): der Stopp erzeugt ihn
// selbst (createVideoPlayer), konfiguriert ihn und navigiert erst, wenn er
// abspielbereit ist — die Vorschau blendet dann in ein bereits laufendes
// Video. Standard-Status ist readyToPlay, damit die übrigen Stopp-Tests ohne
// Timer-Steuerung auskommen; die Vorwärm-Tests stellen explizit auf 'loading'.
const mockErzeugterPlayer = {
  loop: false,
  muted: false,
  audioMixingMode: 'auto',
  status: 'readyToPlay' as string,
  play: jest.fn(),
  release: jest.fn(),
  addListener: jest.fn(
    (_ereignis: string, _horcher: (e: { status: string }) => void) => ({ remove: jest.fn() })
  ),
};
const mockCreateVideoPlayer = jest.fn((_quelle: unknown) => mockErzeugterPlayer);
jest.mock('expo-video', () => ({
  createVideoPlayer: (quelle: unknown) => mockCreateVideoPlayer(quelle),
}));

// Das Poster (Bild 0) entsteht beim Stopp gleich mit und reist neben dem
// Player zur Vorschau — es überbrückt dort die ~0,8 s, die die VideoView
// zum ersten Zeichnen braucht (Gerätefund 2026-08-14).
const mockGetThumbnail = jest.fn(async (_uri: string, _optionen: unknown) => ({
  uri: 'file://poster.jpg',
}));
jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: (uri: string, optionen: unknown) => mockGetThumbnail(uri, optionen),
}));

function statusChangeHorcher(): ((e: { status: string }) => void) | undefined {
  const aufruf = mockErzeugterPlayer.addListener.mock.calls.find(
    ([ereignis]) => ereignis === 'statusChange'
  );
  return aufruf?.[1];
}

jest.mock('@/features/kamera/nativeZoom', () => ({
  linsen: (position: string) => mockNativeLinsen(position),
  setzeZoom: (name: string, faktor: number, sanft: boolean) => mockSetzeZoom(name, faktor, sanft),
  zoomGrenzen: (name: string) => mockZoomGrenzen(name),
  fokussiere: (x: number, y: number) => mockFokussiere(x, y),
}));

// Die native Aufnahme-Pipeline (Task 2/10): Standard-Antwort ist `true` in
// diesem Objekt selbst, `beforeEach` zieht sie unten bewusst auf `false`
// zurück (Ruling 2 aus dem Auftrag) — sonst liefen alle bestehenden
// recordAsync-Tests plötzlich den nativen Weg, nur weil dieser Mock dazukam.
//
// Die Fabrik reicht die Aufrufe über eine eigene Hülle weiter (statt
// `mockNativeAufnahme` selbst zurückzugeben, gleiches Muster wie beim
// nativeZoom-Mock oben): jest.mock() wird beim Hochziehen von `../index`
// ausgeführt, bevor die `const mockNativeAufnahme`-Zeile unten selbst
// läuft — ein direkt zurückgegebenes Objekt wäre zu diesem Zeitpunkt noch
// nicht initialisiert. Die Hülle liest die Variable erst beim TATSÄCHLICHEN
// Aufruf aus den Tests, dann längst zugewiesen.
const mockNativeAufnahme = {
  aufnahmeStarten: jest.fn(async (_s: number) => true),
  aufnahmeStoppen: jest.fn(async () => ({ uri: 'file://nativ.mov', dauerS: 3.4 })),
  dateiFertig: jest.fn(() => Promise.resolve()),
  verwerfen: jest.fn(),
  verfuegbar: jest.fn(() => true),
  SofortVorschau: () => null,
};
jest.mock('@/features/kamera/nativeAufnahme', () => ({
  aufnahmeStarten: (s: number) => mockNativeAufnahme.aufnahmeStarten(s),
  aufnahmeStoppen: () => mockNativeAufnahme.aufnahmeStoppen(),
  dateiFertig: () => mockNativeAufnahme.dateiFertig(),
  verwerfen: () => mockNativeAufnahme.verwerfen(),
  verfuegbar: () => mockNativeAufnahme.verfuegbar(),
  SofortVorschau: () => mockNativeAufnahme.SofortVorschau(),
}));

// Die eigene MultiCam-Session (Task 3/4). Standard ist «nicht verfügbar»,
// genau wie bei der nativen Aufnahme oben: so sehen ALLE bestehenden Tests
// weiterhin den expo-camera-Zweig, und nur die MultiCam-Gruppe am Ende der
// Datei stellt um. Die Fabrik reicht über eine Hülle weiter (dieselbe
// Hochzieh-Falle wie beim nativeAufnahme-Mock, siehe dort).
type Druckstufe = 'nominal' | 'ernst' | 'kritisch';
type MultiCamZielMock = { kamera: string; faktor: number };
const mockMultiKamera = {
  verfuegbar: jest.fn(() => false),
  starten: jest.fn(async () => true),
  stoppen: jest.fn(),
  wechsleKamera: jest.fn(async () => 'front' as 'front' | 'back' | null),
  zoomSetzen: jest.fn((_ziel: MultiCamZielMock, _sanft: boolean) => {}),
  fokussiere: jest.fn((_x: number, _y: number) => {}),
  aufDruck: jest.fn((_hoerer: (stufe: Druckstufe) => void) => () => {}),
  // Die Video-Aufnahme der eigenen Session (Task 5): sie erzeugt nativ
  // dieselbe Aufnahme wie die KameraAufnahme-Pipeline und hängt sie in deren
  // `aktuelle`: deshalb bleibt alles Nachgelagerte (dateiFertig, verwerfen,
  // Sofort-Vorschau) unverändert bei nativeAufnahme.
  aufnahmeStarten: jest.fn(async (_maxSekunden: number) => true),
  aufnahmeStoppen: jest.fn(
    async () => ({ uri: 'file://multicam.mov', dauerS: 5.6 }) as { uri: string; dauerS: number } | null
  ),
  // Das Foto der eigenen Session (Task 6): ein Griff in den laufenden Strom,
  // fertig als JPEG im tmp: kein PictureRef, kein zweiter Foto-Ausgang.
  fotoAufnehmen: jest.fn(
    async (_blitz: boolean) =>
      ({ uri: 'file:///tmp/reelive-foto-1.jpg', breite: 1080, hoehe: 1920 }) as {
        uri: string;
        breite: number;
        hoehe: number;
      } | null
  ),
  blitz: jest.fn((_an: boolean) => {}),
};
jest.mock('@/features/kamera/multiKamera', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    verfuegbar: () => mockMultiKamera.verfuegbar(),
    starten: () => mockMultiKamera.starten(),
    stoppen: () => mockMultiKamera.stoppen(),
    wechsleKamera: () => mockMultiKamera.wechsleKamera(),
    zoomSetzen: (ziel: MultiCamZielMock, sanft: boolean) => mockMultiKamera.zoomSetzen(ziel, sanft),
    fokussiere: (x: number, y: number) => mockMultiKamera.fokussiere(x, y),
    aufDruck: (hoerer: (stufe: Druckstufe) => void) => mockMultiKamera.aufDruck(hoerer),
    aufnahmeStarten: (maxSekunden: number) => mockMultiKamera.aufnahmeStarten(maxSekunden),
    aufnahmeStoppen: () => mockMultiKamera.aufnahmeStoppen(),
    fotoAufnehmen: (blitz: boolean) => mockMultiKamera.fotoAufnehmen(blitz),
    blitz: (an: boolean) => mockMultiKamera.blitz(an),
    // Der Sucher des MultiCam-Pfads: am Gerät eine native View, hier eine
    // schlichte, die ihre Props (und damit die testID) durchreicht.
    MultiKameraSucher: (props: object) => ReactActual.createElement(View, props),
  };
});

import AufnehmenScreen from '../index';
import { fetchTrips } from '@/features/trips/tripsApi';
import * as uebergabe from '@/features/kamera/uebergabe';
import * as aufnahmeSperre from '@/features/kamera/aufnahmeSperre';

const reise = (over: Partial<Trip> = {}): Trip => ({
  id: 't1',
  name: 'Norwegen mit dem Camper',
  start_date: '2026-08-01',
  end_date: '2026-08-14',
  status: 'active',
  owner_id: 'u1',
  mitglieder: [{ name: 'Lea', avatarKey: null }],
  member_count: 1,
  my_post_count: 4,
  ...over,
});

const geladen = (data: Trip[]) => ({ data, error: null, zaehlerFehler: null });

beforeEach(() => {
  jest.clearAllMocks();
  mockSpeicher.clear();
  mockAuth.userId = 'u1';
  // jest.clearAllMocks() setzt nur die Aufruf-Historie zurück, NICHT eine per
  // mockResolvedValue gesetzte Implementierung, sonst sickerte sie in jeden
  // folgenden Test durch (gleiche Falle wie in uploadWorker.test.ts).
  mockEigenerZaehler.mockImplementation(async () => 0);
  mockUseReducedMotion.mockReturnValue(false);
  mockCameraPermission = GEWAEHRT;
  mockMicPermission = GEWAEHRT;
  mockInsets = { top: 0, left: 0, right: 0, bottom: 0 };
  mockSavePictureAsync.mockResolvedValue({ uri: 'file://gespeichert.jpg', width: 1920, height: 1080 });
  // takePictureAsync liefert mit pictureRef:true einen PictureRef — im Test
  // reicht ein Objekt, das savePictureAsync trägt.
  mockTakePictureAsync.mockResolvedValue({ width: 1920, height: 1080, savePictureAsync: mockSavePictureAsync });
  uebergabe.abholen();
  // Auch der Video-Holder beginnt leer, und der Fake-Player wieder fertig
  // geladen (die Vorwärm-Tests verstellen beides).
  uebergabe.videoAbholen();
  mockErzeugterPlayer.status = 'readyToPlay';
  // Modul-Zustand, überlebt Tests: immer entsperrt beginnen.
  aufnahmeSperre.sperren(false);
  // Ein fokusVerlieren() aus einem früheren Test darf nicht nachwirken:
  // jeder Test beginnt fokussiert (negativer Stand hiesse «unfokussiert»,
  // die Fokus-Effekte liefen dann nie an und kein Screen lüde).
  mockFokusStand = 0;
  // Ruling 2 aus dem Auftrag: Default ist der FALLBACK, damit alle
  // bestehenden recordAsync-Tests unverändert bleiben. Nur die eigenen
  // Nativ-Tests stellen explizit auf `true` (bzw. mockResolvedValueOnce).
  mockNativeAufnahme.aufnahmeStarten.mockResolvedValue(false);
  // Dieselbe Regel für die MultiCam-Session: Standard ist der
  // expo-camera-Zweig, nur die MultiCam-Gruppe stellt auf verfügbar.
  // (jest.clearAllMocks() räumt nur die Historie, nicht die Implementierung,
  // sonst sickerte ein mockReturnValue in jeden folgenden Test durch.)
  mockMultiKamera.verfuegbar.mockReturnValue(false);
  mockMultiKamera.starten.mockResolvedValue(true);
  mockMultiKamera.wechsleKamera.mockResolvedValue('front');
  mockMultiKamera.aufDruck.mockImplementation(() => () => {});
  // Anders als bei der nativen Aufnahme oben ist hier der ERFOLG der
  // Standard: im MultiCam-Zweig gibt es keinen recordAsync-Rückweg (es gibt
  // keine CameraView), ein dauerhaft ablehnender Start wäre also kein
  // realistischer Ausgangszustand, sondern ein Dauerfehler.
  mockMultiKamera.aufnahmeStarten.mockResolvedValue(true);
  mockMultiKamera.aufnahmeStoppen.mockResolvedValue({ uri: 'file://multicam.mov', dauerS: 5.6 });
  mockMultiKamera.fotoAufnehmen.mockResolvedValue({
    uri: 'file:///tmp/reelive-foto-1.jpg',
    breite: 1080,
    hoehe: 1920,
  });
  mockMultiKamera.blitz.mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
});

test('ohne laufende Reise zeigt der Screen den Weg zum Anlegen', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([]));
  await render(<AufnehmenScreen />);
  expect(await screen.findByText('Keine laufende Reise')).toBeTruthy();
  await fireEvent.press(screen.getByText('Neue Reise anlegen'));
  expect(mockPush).toHaveBeenCalledWith('/reise/neu');
});

test('sind alle Reisen bereits versiegelt, gilt das ebenfalls als „keine laufende Reise"', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise({ status: 'revealed' })]));
  await render(<AufnehmenScreen />);
  expect(await screen.findByText('Keine laufende Reise')).toBeTruthy();
});

// Final-Review, Critical 1: DIESER Test behauptete bis zur Fix-Welle das
// Falsche. Er schrieb fest, dass ein Ladefehler die Kamera durch eine
// Fehlerseite ersetzt, und damit, dass «Aufnehmen funktioniert vollständig
// offline» (Spec §1) an seinem allerersten Screen bricht. Die Fehlerseite
// gehört nur noch dorthin, wo es auch nichts Vorgehaltenes gibt.
test('ohne je geladenen Bestand zeigt ein Ladefehler die Ursache mit einer Wiederholen-Möglichkeit', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: 'Offline, ohne Netz keine aktuellen Daten.', zaehlerFehler: 'Offline' });
  await render(<AufnehmenScreen />);
  expect(await screen.findByText('Offline, ohne Netz keine aktuellen Daten.')).toBeTruthy();

  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await fireEvent.press(screen.getByText('Nochmal versuchen'));
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
});

test('im Flugmodus erscheint der Sucher aus dem vorgehaltenen Bestand statt einer Fehlerseite', async () => {
  // Erster Lauf mit Netz: der Bestand wird fortgeschrieben.
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  const ersteSitzung = await render(<AufnehmenScreen />);
  expect(await screen.findByLabelText('Auslöser')).toBeTruthy();
  await ersteSitzung.unmount();

  // Zweiter Lauf ohne Netz: fetchTrips liefert nur noch den Fehler.
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: 'Offline, ohne Netz keine aktuellen Daten.', zaehlerFehler: 'Offline' });
  await render(<AufnehmenScreen />);

  expect(await screen.findByLabelText('Auslöser')).toBeTruthy();
  expect(screen.getByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.queryByText('Das hat nicht geklappt')).toBeNull();
  expect(screen.queryByText('Offline, ohne Netz keine aktuellen Daten.')).toBeNull();
});

// Der Bestand gehört zur Person, nicht zum Gerät: sonst sähe B im Flugmodus
// A's Reisen.
test('der vorgehaltene Bestand einer anderen Person wird nicht angezeigt', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  const ersteSitzung = await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');
  await ersteSitzung.unmount();

  mockAuth.userId = 'person-b';
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: 'Offline, ohne Netz keine aktuellen Daten.', zaehlerFehler: 'Offline' });
  await render(<AufnehmenScreen />);

  expect(await screen.findByText('Offline, ohne Netz keine aktuellen Daten.')).toBeTruthy();
  expect(screen.queryByText('Norwegen mit dem Camper')).toBeNull();
});

// Ein vorgehaltener LEERER Bestand ist eine Aussage («du hattest zuletzt keine
// Reise»), kein fehlender Bestand, er führt auf den Einladungs-Weg, nicht auf
// die Fehlerseite.
test('ein vorgehaltener leerer Bestand führt offline auf «Keine laufende Reise»', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([]));
  const ersteSitzung = await render(<AufnehmenScreen />);
  await screen.findByText('Keine laufende Reise');
  await ersteSitzung.unmount();

  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: 'Offline, ohne Netz keine aktuellen Daten.', zaehlerFehler: 'Offline' });
  await render(<AufnehmenScreen />);

  expect(await screen.findByText('Keine laufende Reise')).toBeTruthy();
  expect(screen.queryByText('Das hat nicht geklappt')).toBeNull();
});

test('bei mehreren laufenden Reisen wählt man zuerst eine aus', async () => {
  const a = reise({ id: 'a', name: 'Norwegen' });
  const b = reise({ id: 'b', name: 'Lissabon', my_post_count: 2 });
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([a, b]));
  // Deckungsgleich mit b.my_post_count, damit die Anzeige unabhängig davon
  // stimmt, ob der Zähler-Fetch schon aufgelöst ist, wenn die Assertion läuft.
  mockEigenerZaehler.mockResolvedValueOnce(2);
  await render(<AufnehmenScreen />);
  expect(await screen.findByText('Für welche Reise?')).toBeTruthy();
  await fireEvent.press(screen.getByText('Lissabon'));
  expect(await screen.findByText('2 Momente')).toBeTruthy();
  expect(screen.queryByText('Für welche Reise?')).toBeNull();
});

test('ohne Kamera- oder Mikrofon-Berechtigung zeigt der Screen den Weg in die Einstellungen', async () => {
  mockCameraPermission = { status: 'denied', granted: false, canAskAgain: false, expires: 'never' };
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  expect(await screen.findByText('Kamera-Zugriff fehlt')).toBeTruthy();
  await fireEvent.press(screen.getByText('Einstellungen öffnen'));
  expect(mockOpenSettings).toHaveBeenCalledTimes(1);
});

test('bei genau einer laufenden Reise erscheint direkt die Kamera mit Reisename und Zähler', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise({ name: 'Norwegen mit dem Camper', my_post_count: 4 })]));
  mockEigenerZaehler.mockResolvedValueOnce(4);
  await render(<AufnehmenScreen />);
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('4 Momente')).toBeTruthy();
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
});

// Task 10: der Zähler ist Task 9s eigenerZaehler, er zählt wartende Momente
// derselben Reise mit, statt beim reinen Serverstand (my_post_count) stehen
// zu bleiben. Genau das unterscheidet diesen Test vom vorigen.
test('nach einer Offline-Aufnahme bewegt sich der Zähler nach vorn statt stehen zu bleiben', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise({ my_post_count: 4 })]));
  mockEigenerZaehler.mockResolvedValueOnce(5);
  await render(<AufnehmenScreen />);
  expect(await screen.findByText('5 Momente')).toBeTruthy();
  expect(screen.queryByText('4 Momente')).toBeNull();
  expect(mockEigenerZaehler).toHaveBeenCalledWith('t1');
});

// Final-Review, Important 3: bis zur Fix-Welle wirkte der Zähler nur deshalb
// richtig, weil preview.tsx per replace bei JEDER Aufnahme einen neuen
// Kamera-Screen erzeugte, der Effekt lief also zwangsläufig neu. Sobald die
// Vorschau sauber vom Stapel genommen wird, bleibt derselbe Screen stehen und
// der Abruf MUSS am Fokussieren hängen, sonst friert die Zahl für die ganze
// Sitzung ein (die Regression, für die es Task 10 gab).
test('nach der Rückkehr aus der Vorschau zieht der Zähler nach, ohne dass der Screen neu entsteht', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise({ my_post_count: 4 })]));
  mockEigenerZaehler.mockResolvedValueOnce(4);
  await render(<AufnehmenScreen />);
  expect(await screen.findByText('4 Momente')).toBeTruthy();

  // Ein Moment ist eingesendet und liegt jetzt in der Warteschlange.
  mockEigenerZaehler.mockResolvedValueOnce(5);
  await erneutFokussieren();

  expect(await screen.findByText('5 Momente')).toBeTruthy();
  expect(mockEigenerZaehler).toHaveBeenCalledTimes(2);
});

// Fix-Runde 1: eigenerZaehler kann ablehnen (kaputte lokale Warteschlange).
// Ohne .catch() an dieser Stelle bliebe eine unbehandelte Ablehnung stehen,
// der Screen soll stattdessen einfach beim my_post_count-Fallback bleiben.
test('eigenerZaehler schlägt fehl: die Pille zeigt trotzdem den Serverstand, kein Absturz', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise({ my_post_count: 4 })]));
  mockEigenerZaehler.mockRejectedValueOnce(new Error('kaputt'));
  await render(<AufnehmenScreen />);
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('4 Momente')).toBeTruthy();
});

test('ein Tipp friert den Sucher ein, übergibt das Foto im Speicher und navigiert sofort', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  // Ohne Shutter-Sound (die Haptik bleibt das Feedback) und als Ref im
  // Speicher statt als JPEG auf der Platte — DAS ist der Instant-Anteil.
  // `mirror: true` wirkt NUR auf die Frontkamera (expo-camera prüft die
  // Blickrichtung selbst) und speichert dort, was der Sucher zeigte — ohne
  // das Flag kippte ein Selfie nach der Aufnahme spiegelverkehrt
  // (Gerätefund 2026-08-18); die Video-Pipeline übernimmt die Spiegelung
  // ohnehin vom Sucher.
  expect(mockTakePictureAsync).toHaveBeenCalledWith({
    pictureRef: true,
    shutterSound: false,
    mirror: true,
  });
  expect(mockPausePreview).toHaveBeenCalledTimes(1);

  // Die Navigation trägt kein uri mehr: das Bild geht über die Übergabe.
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/vorschau',
    params: { typ: 'photo', dauer: '0', tripId: 't1' },
  });
  const abgeholt = uebergabe.abholen();
  expect(abgeholt).not.toBeNull();
  await expect(abgeholt!.datei).resolves.toEqual(
    expect.objectContaining({ uri: 'file://gespeichert.jpg' })
  );
});

// Gerätefund 2026-08-14: die native iOS-Seite von savePictureAsync liefert
// das Feld `url`, nicht das im TS-Typ versprochene `uri` (Android liefert
// `uri`). Die Übergabe muss beide Formen auf `uri` begradigen, sonst zieht
// die Vorschau beim Einsenden undefined heraus und bricht kommentarlos ab.
test('die Übergabe begradigt die iOS-Form (url) von savePictureAsync auf uri', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockSavePictureAsync.mockResolvedValue({ url: 'file://ios-form.jpg', width: 1920, height: 1080 });
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  const abgeholt = uebergabe.abholen();
  expect(abgeholt).not.toBeNull();
  await expect(abgeholt!.datei).resolves.toEqual({ uri: 'file://ios-form.jpg' });
});

// Mit Blitz ist das Bild NICHT in wenigen Dutzend ms da: iOS fährt erst die
// Messsequenz (Vorblitz, Belichtungs-Konvergenz, Hauptblitz), 1–2 s. Ein
// sofort eingefrorener Sucher stünde die ganze Zeit als dunkler Freeze da
// (Gerätetest 2026-08-13). Er bleibt darum live — man sieht den Blitz zünden,
// wie in der Kamera-App — und friert erst ein, wenn das Bild da ist.
test('mit Blitz bleibt der Sucher bis zum fertigen Bild live und friert erst dann ein', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  let aufloesen: (v: { width: number; height: number; savePictureAsync: typeof mockSavePictureAsync }) => void =
    () => {};
  // Löst erst auf Kommando auf: das Zeitfenster der Blitz-Sequenz.
  mockTakePictureAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        aufloesen = resolve;
      })
  );
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');
  await fireEvent.press(screen.getByLabelText('Blitz einschalten'));

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  // Solange die Blitz-Sequenz läuft: kein Einfrieren, keine Navigation.
  expect(mockPausePreview).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();

  await act(async () => {
    aufloesen({ width: 1920, height: 1080, savePictureAsync: mockSavePictureAsync });
  });

  // Erst mit dem fertigen Bild friert der Sucher ein (ruhiger Stand für den
  // Übergang, wie beim Video-Stopp), dann kommt die Vorschau.
  expect(mockPausePreview).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/vorschau',
    params: { typ: 'photo', dauer: '0', tripId: 't1' },
  });
});

// Ohne dieses Auftauen bliebe der Sucher nach einem gescheiterten Foto
// eingefroren — pausePreview ist gelaufen, und niemand navigiert weg.
test('scheitert das Foto, läuft der Sucher weiter und der Screen sagt es', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockTakePictureAsync.mockRejectedValue(new Error('SimulatorNotSupported'));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  expect(await screen.findByText('Das Foto hat nicht geklappt. Versuch es nochmal.')).toBeTruthy();
  expect(mockResumePreview).toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});

// Zwischen `pressOut` und dem Navigations-Commit bleibt der Auslöser
// bedienbar (die Navigation selbst ist async): Ein zweiter, schneller Tipp
// würde ohne Sperre einen zweiten Foto-Zyklus anstossen — zweites
// `pausePreview`, der Übergabe-Holder überschrieben (die erste Aufnahme samt
// Hintergrund-Datei verwaist), zwei gestapelte Vorschauen.
test('ein zweiter, schneller Tipp löst während der ersten Aufnahme kein zweites Foto aus', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  let aufloesen: (v: { width: number; height: number; savePictureAsync: typeof mockSavePictureAsync }) => void =
    () => {};
  // Löst erst NACH dem zweiten Tipp auf: genau das Zeitfenster, in dem ein
  // zweiter Zyklus ohne Sperre starten würde.
  mockTakePictureAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        aufloesen = resolve;
      })
  );
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  await act(async () => {
    aufloesen({ width: 1920, height: 1080, savePictureAsync: mockSavePictureAsync });
  });

  expect(mockTakePictureAsync).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledTimes(1);
});

// Ein Tab-Wechsel mitten in einer Aufnahme feuert das Fokus-Cleanup in die
// laufende Session (das mute-Umhängen wäre eine Session-Rekonfiguration) und
// navigiert von einer Aufnahme weg, die gleich in die Vorschau will. Der
// Screen setzt darum die Aufnahme-Sperre; dass der Tab-Navigator sie im
// tabPress liest, prüft __tests__/_layout.test.tsx.
test('während des Foto-Zyklus ist die Tab-Bar gesperrt, mit dem fertigen Bild wieder frei', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  let aufloesen: (v: { width: number; height: number; savePictureAsync: typeof mockSavePictureAsync }) => void =
    () => {};
  mockTakePictureAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        aufloesen = resolve;
      })
  );
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(aufnahmeSperre.istGesperrt()).toBe(true);

  await act(async () => {
    aufloesen({ width: 1920, height: 1080, savePictureAsync: mockSavePictureAsync });
  });
  expect(aufnahmeSperre.istGesperrt()).toBe(false);
});

// Der Fehlerfall muss die Sperre ebenso lösen, sonst bleibt die Tab-Bar nach
// einem gescheiterten Foto für den Rest der Sitzung tot.
test('scheitert das Foto, ist die Tab-Bar danach wieder frei', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockTakePictureAsync.mockRejectedValue(new Error('SimulatorNotSupported'));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  await screen.findByText('Das Foto hat nicht geklappt. Versuch es nochmal.');
  expect(aufnahmeSperre.istGesperrt()).toBe(false);
});

test('während der Video-Aufnahme ist die Tab-Bar gesperrt, nach dem Stopp wieder frei', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  let recordAufloesen: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        recordAufloesen = resolve;
      })
  );
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  expect(aufnahmeSperre.istGesperrt()).toBe(true);

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  await act(async () => {
    recordAufloesen({ uri: 'file://video.mp4' });
  });
  expect(aufnahmeSperre.istGesperrt()).toBe(false);
});

// Sicherheitsnetz: verlässt der Screen die Bühne, während die Sperre steht
// (etwa ein Deep Link mitten in der Aufnahme), muss das Blur-Cleanup sie
// lösen — sonst bleibt die Tab-Bar app-weit dauerhaft tot.
test('ein Unmount während laufender Aufnahme löst die Sperre', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  const gerendert = await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  expect(aufnahmeSperre.istGesperrt()).toBe(true);

  // In act eingehüllt: React flusht den Unmount (und damit das
  // Effekt-Cleanup) nicht synchron im Aufruf selbst.
  await act(async () => {
    gerendert.unmount();
  });
  expect(aufnahmeSperre.istGesperrt()).toBe(false);
});

// Gerätefund 2026-08-14: das Einfrieren beim Video-Stopp stammte aus der Zeit
// des harten Schnitts zur Vorschau — als Standbild war es genau der Ruckler,
// den man beim Loslassen spürte (~0,1–0,3 s Datei-Finalisierung). Seit die
// Vorschau überblendet (vorschau.tsx), läuft der Sucher bis zur Blende live
// weiter; den Zeitsprung ins Video deckt die Blende ab.
test('beim Video-Stopp läuft der Sucher live weiter, statt einzufrieren', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  let recordAufloesen: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        recordAufloesen = resolve;
      })
  );
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  await act(async () => {
    recordAufloesen({ uri: 'file://video.mp4' });
  });

  expect(mockPausePreview).not.toHaveBeenCalled();
});

// Das Vorwärmen (Gerätefund 2026-08-14, Snapchat-Massstab): der Player
// entsteht beim Stopp und lädt, während der Sucher live weiterläuft;
// navigiert wird erst, wenn er abspielbereit ist — die Blende geht dann in
// ein bereits LAUFENDES Video statt in eine dunkle Fläche, in die das erste
// Bild hineinpoppt. Eine Frist deckelt das Warten (PLAYER_VORLAUF_MS).
async function videoGestoppt(recordAufloesen: (v: { uri: string }) => void) {
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');
  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  await act(async () => {
    recordAufloesen({ uri: 'file://video.mp4' });
  });
}

test('der Video-Stopp wärmt den Player vor und navigiert erst, wenn er abspielbereit ist', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  let recordAufloesen: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        recordAufloesen = resolve;
      })
  );
  mockErzeugterPlayer.status = 'loading';
  await videoGestoppt((v) => recordAufloesen(v));

  // Die Datei ist da, der Player entsteht und lädt — navigiert wird noch nicht.
  expect(mockCreateVideoPlayer).toHaveBeenCalledWith('file://video.mp4');
  expect(mockErzeugterPlayer.loop).toBe(true);
  expect(mockErzeugterPlayer.muted).toBe(true);
  expect(mockErzeugterPlayer.audioMixingMode).toBe('mixWithOthers');
  expect(mockErzeugterPlayer.play).toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();

  const horcher = statusChangeHorcher();
  expect(horcher).toBeDefined();
  await act(async () => {
    mockErzeugterPlayer.status = 'readyToPlay';
    horcher?.({ status: 'readyToPlay' });
  });

  const geholt = uebergabe.videoAbholen();
  expect(geholt?.art).toBe('player');
  expect(geholt && geholt.art === 'player' ? geholt.player : null).toBe(mockErzeugterPlayer);
  // Das Poster reist mit: Bild 0 der Aufnahme, als Sofort-Brücke.
  expect(mockGetThumbnail).toHaveBeenCalledWith('file://video.mp4', expect.objectContaining({ time: 0 }));
  expect(geholt && geholt.art === 'player' ? geholt.poster : null).toBe('file://poster.jpg');
  expect(mockPush).toHaveBeenCalled();
});

test('scheitert die Poster-Erzeugung, wird ohne Poster navigiert statt gar nicht', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  let recordAufloesen: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        recordAufloesen = resolve;
      })
  );
  mockGetThumbnail.mockRejectedValueOnce(new Error('Mini-Video ohne Standbild'));
  await videoGestoppt((v) => recordAufloesen(v));

  expect(mockPush).toHaveBeenCalled();
  const geholt = uebergabe.videoAbholen();
  expect(geholt?.art).toBe('player');
  expect(geholt && geholt.art === 'player' ? geholt.player : null).toBe(mockErzeugterPlayer);
  expect(geholt && geholt.art === 'player' ? geholt.poster : undefined).toBeNull();
});

test('lädt der Player zu zäh, navigiert der Stopp nach der Frist trotzdem', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  let recordAufloesen: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        recordAufloesen = resolve;
      })
  );
  mockErzeugterPlayer.status = 'loading';
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');
  jest.useFakeTimers();
  try {
    await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
    await act(async () => {
      recordAufloesen({ uri: 'file://video.mp4' });
    });
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(450);
    });
  } finally {
    jest.useRealTimers();
  }

  expect(mockPush).toHaveBeenCalled();
  // Der noch ladende Player wird trotzdem übergeben: besser spät fertig
  // laden als in der Vorschau ein zweites Mal von vorn.
  const geholt = uebergabe.videoAbholen();
  expect(geholt && geholt.art === 'player' ? geholt.player : null).toBe(mockErzeugterPlayer);
});

test('scheitert der vorgewärmte Player, wird er freigegeben und die Vorschau lädt selbst', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  let recordAufloesen: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        recordAufloesen = resolve;
      })
  );
  mockErzeugterPlayer.status = 'loading';
  await videoGestoppt((v) => recordAufloesen(v));

  const horcher = statusChangeHorcher();
  expect(horcher).toBeDefined();
  await act(async () => {
    mockErzeugterPlayer.status = 'error';
    horcher?.({ status: 'error' });
  });

  expect(mockPush).toHaveBeenCalled();
  expect(mockErzeugterPlayer.release).toHaveBeenCalled();
  expect(uebergabe.videoAbholen()).toBeNull();
});

// ——— Native Aufnahme-Pipeline (Task 11: die Screen-Weiche) ———
//
// Ist das eigene native Modul da (Task 2), läuft weder recordAsync noch der
// Vorwärm-Player: der Stopp liefert Datei und Dauer direkt aus dem Modul und
// navigiert, sobald es geantwortet hat.
test('mit nativer Pipeline navigiert der Stopp sofort, ohne recordAsync und ohne Vorwärmen', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  // Der `beforeEach`-Default ist der Fallback (Ruling 2) — dieser Test ist
  // der einzige, der ausdrücklich die native Pipeline anfordert.
  mockNativeAufnahme.aufnahmeStarten.mockResolvedValue(true);
  await videoGestoppt(() => {});
  expect(mockNativeAufnahme.aufnahmeStarten).toHaveBeenCalledWith(90);
  expect(mockRecordAsync).not.toHaveBeenCalled();
  expect(mockCreateVideoPlayer).not.toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalled();
  const geholt = uebergabe.videoAbholen();
  expect(geholt?.art).toBe('nativ');
  // dauer kommt vom Modul, gerundet.
  expect(mockPush.mock.calls[0][0]).toMatchObject({ params: expect.objectContaining({ dauer: '3', uri: 'file://nativ.mov' }) });
});

// Fehlt das native Modul (Android, alter Build, Simulator ohne den
// Zusatzbuild), meldet der Start `false` und der bisherige recordAsync-Weg
// übernimmt unverändert — Default aus `beforeEach`, hier nur zur Klarheit
// noch einmal ausdrücklich gesetzt.
test('startet die native Aufnahme nicht, läuft alles über den bisherigen Weg', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockNativeAufnahme.aufnahmeStarten.mockResolvedValueOnce(false);
  let recordAufloesen: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(() => new Promise((r) => { recordAufloesen = r; }));
  await videoGestoppt((v) => recordAufloesen(v));
  expect(mockRecordAsync).toHaveBeenCalled();
  expect(uebergabe.videoAbholen()?.art).toBe('player');
});

test('ein Halten auf dem Auslöser nimmt ein Video auf und navigiert nach dem Loslassen zur Vorschau', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  let resolveRecord: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRecord = resolve;
      })
  );

  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  // 90 statt 30: User-Entscheid vom 2026-08-14, das Snapchat-Mass war im
  // Reise-Alltag zu knapp.
  expect(mockRecordAsync).toHaveBeenCalledWith({ maxDuration: 90 });

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(mockStopRecording).toHaveBeenCalledTimes(1);
  // Die Navigation wartet auf das Ergebnis von recordAsync, vor der
  // Auflösung darf noch nichts geschehen.
  expect(mockPush).not.toHaveBeenCalled();

  await act(async () => {
    resolveRecord({ uri: 'file://video.mp4' });
  });

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/vorschau',
    params: { uri: 'file://video.mp4', typ: 'video', dauer: expect.any(String), tripId: 't1' },
  });
});

// Fix-Runde 1: die Vorfassung behandelte 'undetermined' (weder gefragt noch
// beantwortet, die Systemabfrage kann gerade laufen) fälschlich wie eine
// Ablehnung, weil `granted: false` bei beiden Zuständen gleich aussieht.
test('vor der ersten Antwort behauptet der Screen keine fehlende Berechtigung', async () => {
  mockCameraPermission = { status: 'undetermined', granted: false, canAskAgain: true, expires: 'never' };
  mockMicPermission = { status: 'undetermined', granted: false, canAskAgain: true, expires: 'never' };
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  const { rerender } = await render(<AufnehmenScreen />);
  // Erneutes Rendern (statt eines blossen `findByText`, das hier ins Leere
  // liefe, der Screen bleibt in diesem Zustand bewusst blank) treibt über
  // dasselbe `act()` alle bis dahin ausstehenden Mikrotasks durch, u.a. das
  // aufgelöste `fetchTrips()`. Damit ist sichergestellt, dass die Reise
  // wirklich geladen ist und wir den Berechtigungs-Zweig prüfen, nicht bloss
  // noch im (visuell identischen) Trips-Ladezustand stecken.
  await rerender(<AufnehmenScreen />);

  expect(screen.queryByText('Kamera-Zugriff fehlt')).toBeNull();
  expect(screen.queryByLabelText('Auslöser')).toBeNull();
  expect(mockRequestCameraPermission).toHaveBeenCalled();
  expect(mockRequestMicPermission).toHaveBeenCalled();

  // Gegenprobe: sobald die Antwort da ist (granted), erscheint der Sucher,
  // der Screen blockiert nicht dauerhaft, er wartet nur wirklich.
  mockCameraPermission = GEWAEHRT;
  mockMicPermission = GEWAEHRT;
  await rerender(<AufnehmenScreen />);
  expect(await screen.findByLabelText('Auslöser')).toBeTruthy();
});

// === Final-Review, Important 7 ===
// Spec §4 verlangt beides wörtlich: «Kamera wechseln und Blitz als translucente
// Pillen». §10 nimmt nur den Trip-Umschalter aus; im Plan kam «Blitz» nirgends
// vor. Für ein gemeinsames Reisetagebuch heisst keine Frontkamera: keine
// Gruppenbilder.
const letzteKameraProps = () =>
  mockCameraProps.mock.calls.at(-1)![0] as Record<string, unknown>;

test('Kamera wechseln schaltet zwischen Rück- und Frontkamera', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  expect(letzteKameraProps().facing).toBe('back');

  await fireEvent.press(screen.getByLabelText('Kamera wechseln'));
  expect(letzteKameraProps().facing).toBe('front');

  await fireEvent.press(screen.getByLabelText('Kamera wechseln'));
  expect(letzteKameraProps().facing).toBe('back');
});

test('der Blitz lässt sich ein- und ausschalten und benennt beim Namen, was passiert', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  expect(letzteKameraProps().flash).toBe('off');

  await fireEvent.press(screen.getByLabelText('Blitz einschalten'));
  expect(letzteKameraProps().flash).toBe('on');

  // Der Knopf sagt jetzt, was der nächste Druck tut (DESIGN-LANGUAGE §6).
  await fireEvent.press(screen.getByLabelText('Blitz ausschalten'));
  expect(letzteKameraProps().flash).toBe('off');
});

// Beim Video greift `flash` nicht, dort braucht es das Dauerlicht. Derselbe
// Schalter, zwei Prop-Namen.
test('bei eingeschaltetem Blitz läuft im Video-Modus das Dauerlicht', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent.press(screen.getByLabelText('Blitz einschalten'));
  expect(letzteKameraProps().enableTorch).toBe(false);

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  expect(letzteKameraProps().enableTorch).toBe(true);
});

// Re-Review, Minor 1: die Steuerung sitzt rechts oben auf derselben Höhe wie
// die Kopf-Pille. Vor der Ergänzung war rechts nichts zu überdecken, seither
// schon, ein langer Reisename lief unter die Bedienelemente. Begrenzt wird
// die Pille, nicht die Steuerung verschoben.
test('ein langer Reisename wird gekürzt, statt unter die Bedienelemente zu laufen', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(
    geladen([reise({ name: 'Sommerreise quer durch Skandinavien mit dem alten Camper' })])
  );
  await render(<AufnehmenScreen />);

  const name = await screen.findByText('Sommerreise quer durch Skandinavien mit dem alten Camper');
  expect(name.props.numberOfLines).toBe(1);
});

// Re-Review, Minor 2: die Reisen laden, nur die my_post_counts-rpc scheitert.
// Dann trägt jede Reise `my_post_count: 0`, und diese Nullen wanderten sowohl
// in den Auswahl-Screen als auch in den vorgehaltenen Bestand. Dieselbe Klasse
// wie Important 6, eine Ebene weiter.
test('scheitert nur der Zähler-Abruf, greift der zuletzt bekannte Stand statt einer 0', async () => {
  // Erster Lauf mit vollständiger Antwort: 40 Momente werden vorgehalten.
  const a = reise({ id: 'a', name: 'Norwegen', my_post_count: 40 });
  const b = reise({ id: 'b', name: 'Lissabon', my_post_count: 7 });
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([a, b]));
  const ersteSitzung = await render(<AufnehmenScreen />);
  await screen.findByText('Für welche Reise?');
  expect(screen.getByText('40 Momente')).toBeTruthy();
  await ersteSitzung.unmount();

  // Zweiter Lauf: Reisen kommen an, der Zähler nicht.
  (fetchTrips as jest.Mock).mockResolvedValue({
    data: [
      { ...a, my_post_count: 0 },
      { ...b, my_post_count: 0 },
    ],
    error: null,
    zaehlerFehler: 'Du bist offline. Verbinde dich und probier es nochmal.',
  });
  await render(<AufnehmenScreen />);

  expect(await screen.findByText('Für welche Reise?')).toBeTruthy();
  expect(screen.getByText('40 Momente')).toBeTruthy();
  expect(screen.getByText('7 Momente')).toBeTruthy();
  expect(screen.queryByText('0 Momente')).toBeNull();
});

// «Helles Reisejournal, dunkles Kino» (DESIGN-LANGUAGE, Leitidee): die
// Kino-Palette gehört den Medien-Screens. In diesem Tab ist das NUR der Sucher.
// Bis zu dieser Runde lagen auch die vier Zustände ohne Kamera — kein Reise,
// kein Zugriff, Ladefehler, Reise-Auswahl — im dunklen Saal, obwohl in keinem
// davon je ein Bild vorkam; neben Reise-, Recap- und Profil-Tab wirkte der
// Aufnehmen-Tab dadurch wie eine fremde App.
//
// Geprüft wird über die tatsächlich gesetzten Flächen statt über eine testID:
// gemessen wird, was der Nutzer sieht, und die Zusicherung überlebt jedes
// Umbenennen. Beide Kino-Töne, sonst rutschte eine `bg-1`-Fläche (die
// Auswahl-Zeilen) unbemerkt durch.
const KINO_FLAECHEN: readonly string[] = [cinema['bg-0'], cinema['bg-1']];

// Gelesen wird der fertig gerenderte Baum (screen.toJSON), nicht der
// Komponenten-Baum: dort steht genau das, was an die native Seite ginge.
type Gerendert = { props?: { style?: StyleProp<ViewStyle> }; children?: unknown[] | null };

function flaechenFarben(): (string | undefined)[] {
  const farben: (string | undefined)[] = [];
  const gehe = (knoten: unknown): void => {
    if (!knoten || typeof knoten !== 'object') return;
    if (Array.isArray(knoten)) {
      knoten.forEach(gehe);
      return;
    }
    const { props, children } = knoten as Gerendert;
    const stil = StyleSheet.flatten(props?.style) as ViewStyle | undefined;
    if (stil?.backgroundColor) farben.push(stil.backgroundColor as string);
    (children ?? []).forEach(gehe);
  };
  gehe(screen.toJSON());
  return farben;
}

const imKinosaal = () => flaechenFarben().some((farbe) => farbe !== undefined && KINO_FLAECHEN.includes(farbe));
const aufHellemGrund = () => flaechenFarben().includes(palette['bg-0']);

test('«Keine laufende Reise» steht auf hellem Grund, nicht im Kinosaal', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([]));
  await render(<AufnehmenScreen />);
  await screen.findByText('Keine laufende Reise');

  expect(aufHellemGrund()).toBe(true);
  expect(imKinosaal()).toBe(false);
});

// Je ein eigener Test statt eines Durchlaufs durch alle drei: der Ladefehler
// erscheint nur, solange es NICHTS Vorgehaltenes gibt, und ein Vorgänger im
// selben Test hätte den Bestand längst gefüllt (siehe Flugmodus-Test oben).
// Getrennt startet jeder Fall mit dem frischen Speicher aus beforeEach.
test('auch der Zugriffs-Hinweis liegt hell', async () => {
  mockCameraPermission = { status: 'denied', granted: false, canAskAgain: false, expires: 'never' };
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByText('Kamera-Zugriff fehlt');

  expect(aufHellemGrund()).toBe(true);
  expect(imKinosaal()).toBe(false);
});

test('auch der Ladefehler liegt hell', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: 'Offline, ohne Netz keine aktuellen Daten.', zaehlerFehler: 'Offline' });
  await render(<AufnehmenScreen />);
  await screen.findByText('Das hat nicht geklappt');

  expect(aufHellemGrund()).toBe(true);
  expect(imKinosaal()).toBe(false);
});

test('auch die Reise-Auswahl liegt hell', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(
    geladen([reise({ id: 'a', name: 'Norwegen' }), reise({ id: 'b', name: 'Lissabon' })])
  );
  await render(<AufnehmenScreen />);
  await screen.findByText('Für welche Reise?');

  expect(aufHellemGrund()).toBe(true);
  expect(imKinosaal()).toBe(false);
});

// Gegenprobe zu den beiden Tests darüber: ohne sie belegten die nur, dass der
// Kino-Ton nirgends mehr vorkommt — auch dort nicht, wo er hingehört.
test('der Sucher selbst bleibt der dunkle Kinosaal', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  expect(flaechenFarben()).toContain(cinema['bg-0']);
});

// Der Stil hängt jetzt am Zustand, nicht mehr am Tab. Ohne das stünden helle
// Uhrzeit und Batterie auf weissem Grund, also unsichtbar.
test('die Status-Bar folgt dem Grund, auf dem sie liegt', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([]));
  const leer = await render(<AufnehmenScreen />);
  await screen.findByText('Keine laufende Reise');
  expect(mockSetStatusBarStyle).toHaveBeenCalledWith('dark');
  expect(mockSetStatusBarStyle).not.toHaveBeenCalledWith('light');
  await leer.unmount();

  mockSetStatusBarStyle.mockClear();
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');
  expect(mockSetStatusBarStyle).toHaveBeenCalledWith('light');
});

// Dritter Leerzustand mit Bild, nach Camper (Reise-Tab) und Filmrolle
// (Recap-Tab). Bis hierher war «Keine laufende Reise» der einzige leere Screen
// ohne eines.
test('«Keine laufende Reise» zeigt das Flugticket', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([]));
  await render(<AufnehmenScreen />);
  await screen.findByText('Keine laufende Reise');

  expect(screen.getByTestId('leerzustand-flugticket')).toBeTruthy();
});

// Gegenprobe: ohne sie belegte der Test darüber nur, dass das Bild existiert,
// nicht, dass es am leeren Zustand hängt. Über dem Sucher wäre das Ticket
// blosse Deko (DESIGN-LANGUAGE §7).
test('über dem Sucher steht kein Flugticket', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  expect(screen.queryByTestId('leerzustand-flugticket')).toBeNull();
});

// Das Bild trägt keine Bedeutung, die der Text nicht schon sagt. Läge es im
// Accessibility-Baum, sagte VoiceOver vor «Keine laufende Reise» ein nutzloses
// «Bild» an.
test('das Flugticket ist für VoiceOver unsichtbar', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([]));
  await render(<AufnehmenScreen />);
  const bild = await screen.findByTestId('leerzustand-flugticket');

  expect(bild.props.accessible).toBe(false);
});

test('das Flugticket schwebt', async () => {
  const loopSpy = jest.spyOn(Animated, 'loop');
  const timingSpy = jest.spyOn(Animated, 'timing');
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([]));
  await render(<AufnehmenScreen />);
  await screen.findByTestId('leerzustand-flugticket');

  expect(loopSpy).toHaveBeenCalled();
  // Der Hub läuft über `transform`, nicht über Layout-Eigenschaften (§5), und
  // in einer Dauer, die kein Zappeln ist.
  expect(timingSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ duration: 2400, useNativeDriver: true })
  );
  loopSpy.mockRestore();
  timingSpy.mockRestore();
});

// `linear` ist verboten (DESIGN-LANGUAGE §7). Ohne diesen Test bliebe ein
// weggelassenes `easing` unbemerkt, der Framework-Default entschiede dann
// stillschweigend über die Bewegung.
test('das Schweben läuft nicht linear', async () => {
  const timingSpy = jest.spyOn(Animated, 'timing');
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([]));
  await render(<AufnehmenScreen />);
  await screen.findByTestId('leerzustand-flugticket');

  const konfig = timingSpy.mock.calls.map(([, c]) => c);
  expect(konfig.length).toBeGreaterThan(0);
  konfig.forEach((c) => {
    expect(c.easing).toBeDefined();
    expect(c.easing).not.toBe(Easing.linear);
  });
  timingSpy.mockRestore();
});

// §5: bei reduzierter Bewegung steht alles still. Eine Dauerschleife ist genau
// das, was diese Einstellung abstellen soll, ein 200-ms-Fade als Ersatz gäbe es
// hier nicht, es gibt nichts zu überblenden.
test('bei reduzierter Bewegung schwebt das Flugticket nicht', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  const loopSpy = jest.spyOn(Animated, 'loop');
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([]));
  await render(<AufnehmenScreen />);
  await screen.findByTestId('leerzustand-flugticket');

  expect(loopSpy).not.toHaveBeenCalled();
  // Das Bild steht dabei sichtbar da, statt mit der Animation zu verschwinden.
  expect(screen.getByTestId('leerzustand-flugticket')).toBeTruthy();
  loopSpy.mockRestore();
});

// ——— Oberkante des Suchers ———
//
// Das Kamerabild ist randlos (§3: «Fotos randlos in Medien-Screens»), was
// darauf LIEGT, ist es nicht. Bis hierher stand die Kopfzeile auf festen 32,
// auf einem Gerät mit Dynamic Island klebte die Reise-Pille damit an der Uhr.
// Der Kommentar im Screen begründete das sogar ausdrücklich, mit genau dieser
// Verwechslung von Bild und Bedienung.
test('die Kopfzeile weicht der Dynamic Island aus', async () => {
  mockInsets = { top: 59, left: 0, right: 0, bottom: 34 };
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  const stil = StyleSheet.flatten(screen.getByTestId('sucher-kopfzeile').props.style) as ViewStyle;
  expect(stil.top).toBe(59 + spacing.base);
});

// Gegenprobe: ohne sie belegte der Test darüber nur, dass irgendein Abstand
// entsteht, nicht dass der gestaltete erhalten bleibt, wo das Gerät nichts
// wegnimmt.
test('ohne Inset behält die Kopfzeile ihren gestalteten Abstand', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  const stil = StyleSheet.flatten(screen.getByTestId('sucher-kopfzeile').props.style) as ViewStyle;
  expect(stil.top).toBe(spacing.xl);
});

// ——— Trip-Umschalter ———
//
// Konzept (docs/reelive-app-konzept.md): «Oben dezent: aktiver Trip-Name (bei
// mehreren aktiven Reisen wechselbar)» und «Mehrere aktive Reisen gleichzeitig:
// Trip-Umschalter in der Kamera». Die Kopf-Pille war reine Anzeige, der
// Auswahl-Screen damit ein Einbahn-Zustand: einmal gewählt, führte kein Weg
// zurück, für den Rest der Sitzung.
test('der Reisename in der Kopf-Pille führt zurück in die Auswahl', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(
    geladen([reise({ id: 'a', name: 'Norwegen' }), reise({ id: 'b', name: 'Lissabon' })])
  );
  await render(<AufnehmenScreen />);
  await screen.findByText('Für welche Reise?');
  await fireEvent.press(screen.getByText('Lissabon'));
  await screen.findByLabelText('Auslöser');

  await fireEvent.press(screen.getByLabelText('Reise wechseln, Lissabon'));
  expect(await screen.findByText('Für welche Reise?')).toBeTruthy();

  await fireEvent.press(screen.getByText('Norwegen'));
  expect(await screen.findByLabelText('Reise wechseln, Norwegen')).toBeTruthy();
});

// Auch mit einer einzigen laufenden Reise: der Name ist der Weg zur Auswahl,
// eine Geste, ein Ziel. Vorher wurde die einzige Reise fest verdrahtet, der
// Auswahl-Screen war unerreichbar.
test('auch bei nur einer laufenden Reise öffnet der Name die Auswahl', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent.press(screen.getByLabelText('Reise wechseln, Norwegen mit dem Camper'));
  expect(await screen.findByText('Für welche Reise?')).toBeTruthy();

  // Und wieder zurück, ohne Sackgasse.
  await fireEvent.press(screen.getByText('Norwegen mit dem Camper'));
  expect(await screen.findByLabelText('Auslöser')).toBeTruthy();
});

// ——— Kopfzeile während der Aufnahme ———
//
// Spec 2026-08-12: Sobald ein Video läuft, blenden Reise-Pille, «Kamera
// wechseln» und «Blitz» aus. Der Grund ist nicht Ästhetik: Im gesperrten
// Zustand ist die Hand frei, die Knöpfe wären erreichbar, und ein
// Kamera-Wechsel mitten in recordAsync kann die laufende Aufnahme abbrechen.
test('während einer laufenden Aufnahme verschwinden die Bedienelemente im Kopf', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');
  expect(screen.getByLabelText('Reise wechseln, Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByLabelText('Kamera wechseln')).toBeTruthy();

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  expect(screen.queryByLabelText('Reise wechseln, Norwegen mit dem Camper')).toBeNull();
  expect(screen.queryByLabelText('Kamera wechseln')).toBeNull();
  expect(screen.queryByLabelText('Blitz einschalten')).toBeNull();
  // Der Auslöser bleibt: er ist das Einzige, was jetzt noch zu bedienen ist.
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
});

// Gegenprobe: ohne sie belegte der Test darüber nur, dass etwas verschwindet,
// nicht dass es zurückkommt.
test('nach der Aufnahme steht die Kopfzeile wieder', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  let recordAufloesen: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        recordAufloesen = resolve;
      })
  );
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  await act(async () => {
    recordAufloesen({ uri: 'file://video.mp4' });
  });

  expect(await screen.findByLabelText('Reise wechseln, Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByLabelText('Kamera wechseln')).toBeTruthy();
});

// ——— Gescheiterte Aufnahme ———
//
// Am Simulator lehnt recordAsync mit «SimulatorNotSupported» ab (belegt im
// Geräte-Log, ExpoCamera/CameraViewModule.swift:290), am Gerät kann ein
// Anruf dazwischenkommen oder der Speicher voll sein. Die Startschleife in
// `handleVideoStart` fängt jeden einzelnen Fehlschlag selbst ab (siehe
// VIDEO_START_VERSUCHE), aber `handleVideoStop` muss danach trotzdem
// unbedingt `setNimmtAuf(false)` erreichen — sonst bliebe die Kopfzeile
// (Reise-Pille, Kamera-Wechsel, Blitz) nach einem gescheiterten Video
// weiterhin ausgeblendet, obwohl gar keine Aufnahme mehr läuft.
test('scheitert die Aufnahme, kommt die Kopfzeile zurück statt zu verschwinden', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockRecordAsync.mockRejectedValue(new Error('SimulatorNotSupported'));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  // Am Simulator scheitert jeder Startversuch, die Schleife gibt erst nach
  // ihrer letzten Runde auf.
  await startversucheDurchlaufen();
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  expect(await screen.findByLabelText('Reise wechseln, Norwegen mit dem Camper')).toBeTruthy();
});

// Die eigentliche Regression: nach einem Fehlschlag muss der nächste Versuch
// wieder eine Aufnahme starten. Ohne das war der Tab nach dem ersten
// gescheiterten Video dauerhaft tot, und genau so fiel es auf.
test('nach einer gescheiterten Aufnahme startet der nächste Versuch wieder eine', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockRecordAsync.mockRejectedValue(new Error('SimulatorNotSupported'));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  await startversucheDurchlaufen();
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  await screen.findByLabelText('Reise wechseln, Norwegen mit dem Camper');
  // Nicht auf eine feste Zahl festgenagelt, seit der Start wiederholt wird
  // (siehe den Wettlauf weiter unten). Die Frage dieses Tests ist nicht, WIE
  // OFT versucht wurde, sondern ob danach überhaupt noch versucht wird.
  const nachDemFehlschlag = mockRecordAsync.mock.calls.length;
  expect(nachDemFehlschlag).toBeGreaterThan(0);

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  expect(mockRecordAsync.mock.calls.length).toBeGreaterThan(nachDemFehlschlag);
});

// ——— Rückmeldung bei gescheiterter Aufnahme ———
//
// Bis hierher schluckte der Screen den Fehlschlag stumm: Man tippte auf
// Stopp und stand vor einem Bildschirm, der nichts sagte. DESIGN-LANGUAGE §6
// verlangt das Gegenteil, Fehler erklären Ursache und Lösung.
const FEHLERTEXT = 'Das Video hat nicht geklappt. Versuch es nochmal.';

// Lässt die Startschleife des Videos zu Ende laufen (der Screen versucht den
// Start mehrfach, siehe VIDEO_START_VERSUCHE und den Wettlauf weiter unten).
// Ein einzelnes advanceTimersByTime reicht dafür nicht:
// zwischen zwei Runden liegt eine Promise-Auflösung, und die nächste
// Wartezeit entsteht erst danach. Grosszügig über die Zahl der Runden hinaus,
// damit der Test nicht auf sie festgenagelt ist.
async function startversucheDurchlaufen() {
  for (let runde = 0; runde < 15; runde++) {
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
  }
}
// Grosszügig über der Standzeit im Screen, damit der Test nicht auf die Zahl
// dort festgenagelt ist: geprüft wird, DASS die Meldung von selbst geht.
const FEHLER_MS_TEST = 10_000;

test('scheitert die Aufnahme, sagt der Screen es statt stumm zu bleiben', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockRecordAsync.mockRejectedValue(new Error('SimulatorNotSupported'));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  await startversucheDurchlaufen();
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  expect(await screen.findByText(FEHLERTEXT)).toBeTruthy();
});

// Gegenprobe: ohne sie stünde die Meldung womöglich nach jeder Aufnahme da,
// auch nach einer geglückten.
test('nach einer geglückten Aufnahme steht keine Fehlermeldung', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  let recordAufloesen: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        recordAufloesen = resolve;
      })
  );
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  await act(async () => {
    recordAufloesen({ uri: 'file://video.mp4' });
  });

  expect(screen.queryByText(FEHLERTEXT)).toBeNull();
});

// Eine Meldung, die stehen bleibt, wird zur Tapete und verdeckt den Sucher.
test('die Fehlermeldung verschwindet von selbst', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockRecordAsync.mockRejectedValue(new Error('SimulatorNotSupported'));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  // Die Uhr bleibt über den ganzen Ablauf dieselbe: Wird erst nach dem
  // Fehlschlag auf Fake Timers gewechselt, läuft der Ausblend-Timer bereits
  // als echter, und advanceTimersByTime erreicht ihn nicht mehr.
  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  // Lässt die Promise-Kette in handleVideoStop durchlaufen. Die Startschleife
  // gibt nach dem Loslassen in ihrer nächsten Runde auf, dafür muss deren
  // Wartezeit erst ablaufen.
  await startversucheDurchlaufen();
  expect(screen.getByText(FEHLERTEXT)).toBeTruthy();

  await act(async () => {
    jest.advanceTimersByTime(FEHLER_MS_TEST);
  });

  expect(screen.queryByText(FEHLERTEXT)).toBeNull();
  jest.useRealTimers();
});

// ——— Der Wettlauf um eine beschäftigte Session ———
//
// Seit die Kamera dauerhaft im Video-Modus läuft (Spec 2026-08-13 §3), baut
// der Start eines Videos die native Session nicht mehr um — der Umbau, an
// dem dieser Test früher hing (`mode="video"` erreicht die View sofort, der
// Wechsel der Capture-Session lief aber asynchron auf der sessionQueue),
// entfällt. Die Wiederholung bleibt trotzdem als Sicherheitsnetz: Die Session
// kann aus anderem Grund beschäftigt sein, genau in dem Moment, in dem der
// Startversuch sie trifft (Tab-Wechsel, ein Anruf), und lehnt dann mit
// «Camera is not ready yet» ab (CameraView.swift:303). Ein Ereignis für
// «wieder frei» gibt es nicht, `onCameraReady` feuert nur beim Start der
// Session. Also wird wiederholt.
test('wird die Session beim Start beschäftigt getroffen, wird der Start wiederholt statt aufzugeben', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  let recordAufloesen: (v: { uri: string }) => void = () => {};
  mockRecordAsync
    .mockRejectedValueOnce(new Error('Camera is not ready yet. Wait for onCameraReady callback'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          recordAufloesen = resolve;
        })
    );

  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  expect(mockRecordAsync).toHaveBeenCalledTimes(1);

  // Die Wartezeit zwischen zwei Startversuchen.
  await act(async () => {
    jest.advanceTimersByTime(200);
  });
  jest.useRealTimers();
  expect(mockRecordAsync).toHaveBeenCalledTimes(2);

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  await act(async () => {
    recordAufloesen({ uri: 'file://video.mp4' });
  });

  expect(screen.queryByText(FEHLERTEXT)).toBeNull();
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/vorschau',
    params: { uri: 'file://video.mp4', typ: 'video', dauer: expect.any(String), tripId: 't1' },
  });
});

// Die Gegenprobe zur Wiederholung: Sie darf nicht hinter dem Loslassen noch
// eine Aufnahme beginnen. Die liefe sonst bis `maxDuration` weiter, denn das
// `stopRecording()` beim Loslassen ist dann längst verpufft.
test('nach dem Loslassen wird kein weiterer Startversuch mehr unternommen', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockRecordAsync.mockRejectedValue(new Error('Camera is not ready yet'));

  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  await act(async () => {});
  const nachDemLoslassen = mockRecordAsync.mock.calls.length;

  // Grosszügig über allem, was die Startschleife zusammen abwarten könnte.
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  jest.useRealTimers();

  expect(mockRecordAsync).toHaveBeenCalledTimes(nachDemLoslassen);
});

// ——— Zoom-Stufen (Spec 2026-08-12-kamera-zoom-design.md) ———

// Die Stufen sind echte Linsen, kein vergrösserter Ausschnitt. Erreichbar
// sind sie nur über das virtuelle Gerät, in dem iOS selbst zwischen den
// Linsen umschaltet — die einzelne Weitwinkel-Kamera käme nie unter 1×.
test('die Kamera bekommt die Mehrfach-Linse gesagt', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  expect(letzteKameraProps().selectedLens).toBe('Rückseitige Dreifach-Kamera');
});

test('die Reihe zeigt die Stufen, die das Gerät hergibt', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  expect(screen.getByText('0,5×')).toBeTruthy();
  expect(screen.getByText('1×')).toBeTruthy();
  expect(screen.getByText('4×')).toBeTruthy();
});

test('der Sucher beginnt bei 1×, nicht bei der weitesten Linse', async () => {
  // Der Fallstrick dieser Funktion: auf dem virtuellen Gerät IST der native
  // Faktor 1,0 die Ultraweitwinkel-Linse, und genau diese 1,0 setzt
  // expo-camera bei jedem Gerätewechsel (addDevice → updateZoom, zoom-Prop 0).
  // Ohne aktives Nachsetzen stünde der Sucher beim Start auf 0,5×.
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  expect(mockSetzeZoom).toHaveBeenCalledWith('Rückseitige Dreifach-Kamera', 2, false);
});

test('ein Tipp auf 4× stellt das Gerät auf den Faktor 8', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent.press(screen.getByText('4×'));

  // Sanft: der Tipp fährt hinein wie in der Kamera-App, er springt nicht.
  expect(mockSetzeZoom).toHaveBeenLastCalledWith('Rückseitige Dreifach-Kamera', 8, true);
});

test('nach einem Gerätewechsel setzt der Sucher den Zoom nach', async () => {
  // expo-camera meldet den Wechsel über onAvailableLensesChanged, und zwar
  // NACH seinem eigenen updateZoom (addDevice, defer-Block). Erst dieses
  // Signal ist der Beleg, dass der Zoom soeben zurückgesetzt wurde.
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');
  await fireEvent.press(screen.getByText('4×'));
  mockSetzeZoom.mockClear();

  await act(async () => {
    (letzteKameraProps().onAvailableLensesChanged as (e: { lenses: string[] }) => void)({ lenses: [] });
  });

  expect(mockSetzeZoom).toHaveBeenCalledWith('Rückseitige Dreifach-Kamera', 8, false);
});

// Die Handler werden direkt über die Props aufgerufen statt über fireEvent.
// Der Grund steckt in der Sache selbst: die Fläche lehnt einzelne Berührungen
// ausdrücklich ab (`onStartShouldSetResponder: false`, sie gehören dem
// Auslöser), und fireEvent hält ein Element, das das tut, für nicht bedienbar
// und reicht das Ereignis an die Eltern weiter. Diese Props SIND die
// Schnittstelle zu React Natives Responder-System, sie zu rufen prüft genau
// den Weg, den das Gerät nimmt.
async function pinch(abstandVorher: number, abstandNachher: number) {
  const flaeche = screen.getByTestId('sucher-zoomflaeche') as unknown as {
    props: {
      onResponderGrant: (e: object) => void;
      onResponderMove: (e: object) => void;
    };
  };
  const finger = (abstand: number) => ({
    nativeEvent: {
      touches: [
        { pageX: 0, pageY: 0 },
        { pageX: 0, pageY: abstand },
      ],
    },
  });
  await act(async () => {
    flaeche.props.onResponderGrant(finger(abstandVorher));
  });
  await act(async () => {
    flaeche.props.onResponderMove(finger(abstandNachher));
  });
}

test('zwei Finger zoomen stufenlos', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await pinch(100, 150);

  // Die Finger stehen anderthalb mal so weit auseinander: aus 1× wird 1,5×,
  // für das Gerät also der Faktor 3. Hart gesetzt, damit es dem Finger folgt.
  expect(mockSetzeZoom).toHaveBeenLastCalledWith('Rückseitige Dreifach-Kamera', 3, false);
  expect(screen.getByText('1,5×')).toBeTruthy();
});

// Gerätefund vom 2026-08-14: der Pinch griff bei gesperrter Aufnahme nur
// «teilweise». Am Gerät setzen zwei Finger fast nie im selben Ereignis auf —
// der erste ergreift die Fläche allein, und der Anker (pinchStart) wurde nur
// beim Ergreifen gesetzt. Kam der zweite Finger nach, rechnete niemand mehr.
// Der Anker wird darum nachgezogen, sobald der zweite Finger dazukommt.
test('der Pinch greift auch, wenn die Finger nacheinander aufsetzen (gesperrte Aufnahme)', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  // Aufnahme starten und sperren: die Hand ist frei, der Pinch erlaubt.
  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100, identifier: 1 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', { nativeEvent: { pageX: 160, identifier: 1 } });
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut', { nativeEvent: { identifier: 1 } });

  const flaeche = sucherFlaeche();
  // Erster Finger allein: ergreift die Fläche, noch kein Pinch.
  await act(async () => {
    flaeche.props.onResponderGrant({ nativeEvent: { touches: [{ pageX: 0, pageY: 0 }], pageX: 0, pageY: 0 } });
  });
  // Zweiter Finger kommt dazu: DIESES Ereignis ist der Anker.
  await act(async () => {
    (flaeche.props as unknown as { onResponderMove: (e: object) => void }).onResponderMove({
      nativeEvent: { touches: [{ pageX: 0, pageY: 0 }, { pageX: 0, pageY: 100 }] },
    });
  });
  // Auseinanderziehen ab dem Anker: aus 1× wird 1,5×, Gerätefaktor 3.
  await act(async () => {
    (flaeche.props as unknown as { onResponderMove: (e: object) => void }).onResponderMove({
      nativeEvent: { touches: [{ pageX: 0, pageY: 0 }, { pageX: 0, pageY: 150 }] },
    });
  });

  expect(mockSetzeZoom).toHaveBeenLastCalledWith('Rückseitige Dreifach-Kamera', 3, false);
});

test('der Pinch endet an der Grenze des Geräts', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await pinch(100, 1);

  // Weiter als die weiteste Linse geht es nicht: 0,5× ist Schluss.
  expect(mockSetzeZoom).toHaveBeenLastCalledWith('Rückseitige Dreifach-Kamera', 1, false);
});

test('ohne Mehrfach-Kamera steht keine Reihe im Bild', async () => {
  // iPhone SE, und jede Frontkamera: eine Linse, nichts zu wählen.
  mockNativeLinsen.mockImplementation(() => [EINZELN]);
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  expect(screen.queryByTestId('zoom-wahl')).toBeNull();
  mockNativeLinsen.mockImplementation((position: string) =>
    position === 'back' ? [DREIFACH] : [EINZELN]
  );
});

test('die Frontkamera hat keine Reihe', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');
  expect(screen.getByTestId('zoom-wahl')).toBeTruthy();

  await fireEvent.press(screen.getByLabelText('Kamera wechseln'));

  expect(screen.queryByTestId('zoom-wahl')).toBeNull();
});

test('während einer gehaltenen Aufnahme verschwindet die Reihe', async () => {
  // React Native kennt genau einen Responder: ein zweiter Finger auf der
  // Reihe entzöge dem haltenden Druck die Berührung, das Loslassen käme an
  // und die Aufnahme endete mitten im Zoomen.
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  expect(screen.queryByTestId('zoom-wahl')).toBeNull();
});

test('ist die Aufnahme gesperrt, ist die Hand frei und die Reihe wieder da', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  // Über die Sperrschwelle wischen und loslassen: die Aufnahme läuft weiter.
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', { nativeEvent: { pageX: 160 } });
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  jest.useRealTimers();

  expect(screen.getByTestId('zoom-wahl')).toBeTruthy();
});

// ——— Kino-Leiste über dem Sucher (Gerätefund 2026-08-18) ———
//
// Die Tab-Bar liegt als durchscheinendes Overlay ÜBER dem Kamerabild, damit
// Sucher und Vorschau dieselbe Fläche zeigen (vorher zeigte die Vorschau
// ~10 % weniger Bildbreite, «mehr gecropt als bevor ich auslöse»). Der
// Screen meldet den Zustand über kinoBuehne an den Tab-Navigator …
test('zeigt der Sucher, meldet der Screen die Kino-Bühne an und beim Verlassen wieder ab', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  const ansicht = await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');
  expect(kinoBuehne.lesen()).toBe(true);
  await act(async () => {
    ansicht.unmount();
  });
  expect(kinoBuehne.lesen()).toBe(false);
});

// … und weil die Leiste dem Screen keinen Platz mehr wegnimmt, heben sich
// die unten verankerten Bedienelemente um ihre Höhe (geteilte Formel
// kinoBuehne.leisteHoehe), sonst lägen sie dahinter.
test('die Bedienelemente heben sich um die Höhe der übergelegten Leiste', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockInsets = { top: 59, left: 0, right: 0, bottom: 34 };
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');
  const stil = StyleSheet.flatten(
    screen.getByTestId('ausloeser-buehne').props.style
  ) as { bottom: number };
  // Der Bodenabstand des Auslösers (spacing.base) plus die volle Leistenhöhe
  // dieses Geräts (Inhalt + Luft + Home-Indicator-Inset).
  expect(stil.bottom).toBe(spacing.base + kinoBuehne.leisteHoehe(34));
});

// ——— Wechsel-Blende (Nutzer-Befund 2026-08-18) ———
//
// Der Kamerawechsel ist ein Hardware-Umbau (~350–650 ms am Gerät): der
// Sucher friert dabei zwangsläufig auf dem letzten Bild ein. Statt das
// Standbild nackt stehen zu lassen («lagt kurz»), liegt während des Umbaus
// eine Blur-Blende darüber (FaceTime-Muster) — sie erscheint mit dem
// Wechsel und verschwindet, sobald die neue Kamera liefert
// (onAvailableLensesChanged).
test('der Doppeltipp-Wechsel legt eine Blur-Blende über den Sucher, bis die neue Kamera liefert', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');
  expect(screen.queryByTestId('wechsel-blende')).toBeNull();

  await tippen();
  await tippen();
  expect(screen.getByTestId('wechsel-blende')).toBeTruthy();

  await act(async () => {
    (letzteKameraProps().onAvailableLensesChanged as (e: { lenses: string[] }) => void)({
      lenses: [],
    });
  });
  expect(screen.queryByTestId('wechsel-blende')).toBeNull();
});

// Zwei Animations-Anläufe (3D-Drehung, Scale-Dip) flogen am Gerät wieder
// raus («sieht einfach nur noch komischer aus», Befunde 2026-08-18): das
// Kamerabild bleibt beim Wechsel UNBEWEGT, es gibt nur die Blur-Blende.
// Dieser Test hält den Rückbau fest — wer wieder eine Bühne um das
// Kamerabild legt, muss hier vorbei.
test('das Kamerabild steht beim Wechsel auf keiner Animations-Bühne', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');
  expect(screen.queryByTestId('sucher-wechselbuehne')).toBeNull();
  expect(screen.queryByTestId('sucher-drehbuehne')).toBeNull();
});

test('die Wechsel-Blende räumt sich notfalls selbst weg, wenn kein Geräte-Ereignis kommt', async () => {
  // Am Simulator (keine zweite Kamera) bliebe die Blende sonst für immer
  // stehen — nach einer Frist verschwindet sie von selbst.
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  // Fake-Timer VOR dem Doppeltipp: die Frist wird beim Wechsel geplant und
  // muss auf der gefälschten Uhr liegen, sonst läuft sie hier nie ab.
  jest.useFakeTimers();
  await tippen();
  await tippen();
  expect(screen.getByTestId('wechsel-blende')).toBeTruthy();

  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  jest.useRealTimers();
  expect(screen.queryByTestId('wechsel-blende')).toBeNull();
});

// ——— Instant-Rückweg aus der Vorschau (Nutzer-Befund 2026-08-18) ———
//
// «Beim Verwerfen gibt es ein kurzes Standbild»: Der Blur beim Öffnen der
// Vorschau hängte das Mikrofon ab (mute), der Rückweg hängte es wieder an —
// und dieser Session-Umbau fror den Sucher genau im Moment der Rückkehr
// ein. Liegt die VORSCHAU über dem Tab, bleibt das Mikrofon deshalb dran
// (der Aufnahme-Fluss ist nicht vorbei); nur ein echter Tab-Wechsel hängt
// es weiter ab — der orange Punkt soll nicht app-weit leuchten.

test('liegt die Vorschau über dem Tab, bleibt das Mikrofon angehängt', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockNativeAufnahme.aufnahmeStarten.mockResolvedValue(true);
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  await act(async () => {
    await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  });
  expect(mockPush).toHaveBeenCalled();

  await fokusVerlieren();

  expect(letzteKameraProps().mute).toBe(false);
});

test('auf einem anderen Tab ist das Mikrofon aus', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  // Kein Weg in die Vorschau — der Fokus geht an einen anderen Tab.
  await fokusVerlieren();

  expect(letzteKameraProps().mute).toBe(true);
});

// Der Foto-Weg friert den Sucher beim Auslösen ein (pausePreview als
// gefühlter Shutter). Wieder anlaufen soll er UNTER der Vorschau, nicht erst
// nach der Rückkehr — sonst steht beim Instant-Rückweg erst ein Standbild.
test('beim Überdecken durch die Vorschau läuft der eingefrorene Sucher schon wieder an', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(mockPausePreview).toHaveBeenCalledTimes(1);
  mockResumePreview.mockClear();

  await fokusVerlieren();

  expect(mockResumePreview).toHaveBeenCalled();
});

// ——— Doppeltipp wechselt die Kamera (Snapchat-Muster) ———

// Gleicher Weg wie beim Pinch: die Props SIND die Schnittstelle zum
// Responder-System (siehe die Begründung bei pinch() weiter oben).
function sucherFlaeche() {
  return screen.getByTestId('sucher-zoomflaeche') as unknown as {
    props: {
      onStartShouldSetResponder: () => boolean;
      onResponderGrant: (e: object) => void;
      onResponderRelease: (e: object) => void;
      onTouchStart: (e: object) => void;
      onTouchEnd: (e: object) => void;
    };
  };
}

async function tippen(x = 100, y = 300, bis = { x: 100, y: 300 }) {
  const flaeche = sucherFlaeche();
  await act(async () => {
    flaeche.props.onResponderGrant({ nativeEvent: { touches: [{ pageX: x, pageY: y }], pageX: x, pageY: y } });
  });
  await act(async () => {
    flaeche.props.onResponderRelease({ nativeEvent: { touches: [], pageX: bis.x, pageY: bis.y } });
  });
}

test('ein Doppeltipp auf den Sucher wechselt die Kamera', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');
  expect(letzteKameraProps().facing).toBe('back');

  await tippen();
  await tippen();

  expect(letzteKameraProps().facing).toBe('front');
});

test('ein einzelner Tipp wechselt nichts', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await tippen();

  expect(letzteKameraProps().facing).toBe('back');
});

test('zwei Tipper mit Pause dazwischen sind kein Doppeltipp', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await tippen();
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  await tippen();
  jest.useRealTimers();

  expect(letzteKameraProps().facing).toBe('back');
});

test('zwei Tipper an verschiedenen Ecken sind kein Doppeltipp', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await tippen(40, 120, { x: 40, y: 120 });
  await tippen(300, 600, { x: 300, y: 600 });

  expect(letzteKameraProps().facing).toBe('back');
});

test('ein Wischen über den Sucher ist kein Tipp', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  // Aufgesetzt und weitergezogen: wer wischt, meint keinen Kamerawechsel.
  await tippen(100, 300, { x: 100, y: 500 });
  await tippen(100, 300, { x: 100, y: 500 });

  expect(letzteKameraProps().facing).toBe('back');
});

test('der Doppeltipp beginnt auf der neuen Kamera wieder bei 1×', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');
  await fireEvent.press(screen.getByText('4×'));

  await tippen();
  await tippen();
  await fireEvent.press(screen.getByLabelText('Kamera wechseln'));

  // Zurück auf der Rückkamera: die Reihe steht wieder auf 1×, nicht auf 4×.
  expect(screen.getByLabelText('Zoom 1×').props.accessibilityState.selected).toBe(true);
});

// Beim Betreten des Screens springt ein REINGEZOOMTER Stand (> 1×) auf 1×
// zurück: ein stehen gebliebener Pinch- oder Zug-Zoom soll nicht unbemerkt
// in die nächste Aufnahme hineinragen (Wunsch 2026-08-17). Der Weitwinkel
// (≤ 1×) bleibt dagegen stehen (Präzisierung 2026-08-18): wer bewusst auf
// 0,5× gestellt hat, will nach dem Verwerfen einer Aufnahme genau dort
// weitermachen.
test('beim Betreten des Screens springt ein reingezoomter Stand auf 1× zurück', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');
  await fireEvent.press(screen.getByText('4×'));
  expect(screen.getByLabelText('Zoom 4×').props.accessibilityState.selected).toBe(true);

  await erneutFokussieren();

  expect(screen.getByLabelText('Zoom 1×').props.accessibilityState.selected).toBe(true);
});

test('der Weitwinkel (0,5×) bleibt beim Betreten des Screens stehen', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');
  await fireEvent.press(screen.getByText('0,5×'));
  expect(screen.getByLabelText('Zoom 0,5×').props.accessibilityState.selected).toBe(true);

  await erneutFokussieren();

  expect(screen.getByLabelText('Zoom 0,5×').props.accessibilityState.selected).toBe(true);
});

test('während einer laufenden Fallback-Aufnahme wechselt der Doppeltipp die Kamera nicht', async () => {
  // Läuft recordAsync (Fallback, nativer Start abgelehnt — Mock-Default),
  // bräche der Session-Umbau des Facing-Wechsels die Aufnahme ab: der
  // Doppeltipp bleibt dort gesperrt.
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  expect(sucherFlaeche().props.onStartShouldSetResponder()).toBe(false);
  await tippen();
  await tippen();

  expect(letzteKameraProps().facing).toBe('back');
});

// ——— Tap-to-Focus (Wunsch vom 2026-08-13) ———
//
// expo-camera kennt nur den globalen autoFocus-Modus, keinen Fokus-Punkt —
// fokussiere() lebt darum im eigenen Native-Modul (kamera-zoom). Hier wird
// nur geprüft, dass der Tipp dort ankommt; die Geräte-Koordinaten rechnet
// die Preview-Layer nativ um.
test('ein Tipp auf den Sucher fokussiert an genau diesem Punkt', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await tippen(140, 420, { x: 140, y: 420 });

  expect(mockFokussiere).toHaveBeenCalledWith(140, 420);
});

test('ein Wischen über den Sucher fokussiert nicht', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await tippen(100, 300, { x: 100, y: 520 });

  expect(mockFokussiere).not.toHaveBeenCalled();
});

// Während einer GESPERRTEN Aufnahme ist die Hand frei — der Tipp fokussiert,
// wie in der Kamera-App. (Während der GEHALTENEN nimmt die Fläche weiterhin
// nichts an, der Responder gehört dem Auslöser; Test weiter oben.)
test('auch während einer gesperrten Aufnahme fokussiert der Tipp', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  // Wisch übers Schloss und loslassen: die Aufnahme läuft gesperrt weiter.
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', { nativeEvent: { pageX: 160 } });
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  expect(sucherFlaeche().props.onStartShouldSetResponder()).toBe(true);
  await tippen(200, 350, { x: 200, y: 350 });

  expect(mockFokussiere).toHaveBeenCalledWith(200, 350);
});

// Während der GEHALTENEN Aufnahme gehört der Responder dem Auslöser, die
// Fläche bekommt keine Responder-Ereignisse. Die ROHEN Touch-Ereignisse
// kommen aber an (sie folgen dem Berührungs-Ziel, nicht dem Responder) —
// darüber fokussiert der Tipp des zweiten Fingers auch mitten im Filmen
// (Gerätefund 2026-08-14). Tab-Bar und Auslöser treffen die Fläche nie,
// deren Tipps zielen auf die eigenen Views.
test('während der gehaltenen Aufnahme fokussiert der Tipp eines zweiten Fingers', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100, identifier: 1 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  const flaeche = sucherFlaeche();
  await act(async () => {
    flaeche.props.onTouchStart({ nativeEvent: { identifier: 7, pageX: 210, pageY: 380 } });
  });
  await act(async () => {
    flaeche.props.onTouchEnd({ nativeEvent: { identifier: 7, pageX: 212, pageY: 382 } });
  });

  expect(mockFokussiere).toHaveBeenCalledWith(212, 382);
});

test('ein Wisch des zweiten Fingers während der Aufnahme fokussiert nicht', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100, identifier: 1 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  const flaeche = sucherFlaeche();
  await act(async () => {
    flaeche.props.onTouchStart({ nativeEvent: { identifier: 7, pageX: 210, pageY: 380 } });
  });
  await act(async () => {
    flaeche.props.onTouchEnd({ nativeEvent: { identifier: 7, pageX: 210, pageY: 500 } });
  });

  expect(mockFokussiere).not.toHaveBeenCalled();
});

// Der Kamerawechsel bliebe auch hier ein Session-Umbau und bräche die
// laufende recordAsync ab — der Doppeltipp bleibt also gesperrt, obwohl die
// Fläche fürs Fokussieren wieder Tipps annimmt.
test('während einer gesperrten Fallback-Aufnahme wechselt der Doppeltipp die Kamera weiterhin nicht', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', { nativeEvent: { pageX: 160 } });
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  await tippen();
  await tippen();

  expect(letzteKameraProps().facing).toBe('back');
});

// ——— Doppeltipp-Wechsel WÄHREND der nativen Aufnahme (Wunsch 2026-08-17) ———
//
// Mit der eigenen Pipeline überlebt die Aufnahme den Facing-Wechsel:
// expo-camera tauscht dabei nur den Geräte-Input derselben laufenden Session
// (CameraSessionManager.addDevice), die eigenen Data-Outputs bleiben hängen
// und liefern nach dem Umbau weiter — wie bei Snapchat wechselt der
// Doppeltipp also mitten im Filmen die Kamera.

test('während der gehaltenen nativen Aufnahme wechselt der Doppeltipp des zweiten Fingers die Kamera', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockNativeAufnahme.aufnahmeStarten.mockResolvedValue(true);
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100, identifier: 1 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  // Der Responder gehört dem Auslöser — der zweite Finger kommt über die
  // rohen Touch-Ereignisse an (gleicher Weg wie der Fokus-Tipp oben).
  const flaeche = sucherFlaeche();
  for (const id of [7, 8]) {
    await act(async () => {
      flaeche.props.onTouchStart({ nativeEvent: { identifier: id, pageX: 210, pageY: 380 } });
    });
    await act(async () => {
      flaeche.props.onTouchEnd({ nativeEvent: { identifier: id, pageX: 211, pageY: 381 } });
    });
  }

  expect(letzteKameraProps().facing).toBe('front');
  // Die Aufnahme läuft weiter — gestoppt wird erst beim Loslassen.
  expect(mockNativeAufnahme.aufnahmeStoppen).not.toHaveBeenCalled();
});

test('während einer gesperrten nativen Aufnahme wechselt der Doppeltipp die Kamera', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockNativeAufnahme.aufnahmeStarten.mockResolvedValue(true);
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', { nativeEvent: { pageX: 160 } });
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  await tippen();
  await tippen();

  expect(letzteKameraProps().facing).toBe('front');
  expect(mockNativeAufnahme.aufnahmeStoppen).not.toHaveBeenCalled();
});

// Ohne sichtbare Antwort fühlt sich der Tipp tot an: ein kleiner Ring steht
// kurz am Punkt (transform/opacity, §5) und räumt sich selbst wieder weg.
test('der Fokus-Ring steht am Tipp-Punkt und räumt sich selbst weg', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await tippen(140, 420, { x: 140, y: 420 });

  const ring = screen.getByTestId('fokus-ring');
  const stil = StyleSheet.flatten(ring.props.style) as { left: number; top: number };
  // Zentriert über dem Punkt, nicht mit der Ecke daran.
  expect(stil.left).toBeLessThan(140);
  expect(stil.top).toBeLessThan(420);

  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  jest.useRealTimers();
  expect(screen.queryByTestId('fokus-ring')).toBeNull();
});

// ——— Dauerhafter Video-Modus (Spec 2026-08-13-aufnahme-tempo-design.md §3) ———
//
// Der Moduswechsel Foto↔Video baute die native Session um und kostete den
// Video-Start bis zu ~1 s. Jetzt läuft die Kamera fest im Video-Modus; das
// Mikrofon hängt dauerhaft an der Session (oranger Punkt im Sucher, bewusst
// entschieden), bei Tab-Blur wird es über `mute` ausgehängt — sonst
// leuchtete der Punkt app-weit, Tab-Screens bleiben ja gemountet.
test('die Kamera läuft dauerhaft im Video-Modus, das Mikrofon ist im Fokus an', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  expect(letzteKameraProps().mode).toBe('video');
  expect(letzteKameraProps().mute).toBe(false);
});

// ——— Zug-Zoom (Spec 2026-08-13-aufnahme-tempo-design.md §7) ———
//
// Der Auslöser meldet den Hub (Task «Ausloeser»), der Screen rechnet ihn
// über zugFaktor in einen Faktor um und setzt HART (sanft=false), damit der
// Zoom dem Finger folgt. Deterministisch geprüft werden die beiden Enden:
// weit über den vollen Weg hinaus steht das Gerätemaximum, zurück am
// Aufsetzpunkt der Startfaktor — beides unabhängig von der Fensterhöhe des
// Testgeräts.
test('Hochziehen während der Aufnahme zoomt bis zum Maximum, Zurückziehen stellt den Start wieder her', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', {
    nativeEvent: { pageX: 100, pageY: 600 },
  });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  mockSetzeZoom.mockClear();
  // Hub 1600 pt: jenseits jedes 40-%-Wegs, also geklemmt aufs Maximum des
  // Geräts (zoomGrenzen-Mock: max 120 nativ).
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', {
    nativeEvent: { pageX: 100, pageY: -1000 },
  });
  expect(mockSetzeZoom).toHaveBeenLastCalledWith('Rückseitige Dreifach-Kamera', 120, false);

  // Zurück am Aufsetzpunkt: Startfaktor 1× — auf dem Ultraweitwinkel-Gerät
  // ist das nativ 2,0 (Basis 0,5).
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', {
    nativeEvent: { pageX: 100, pageY: 600 },
  });
  expect(mockSetzeZoom).toHaveBeenLastCalledWith('Rückseitige Dreifach-Kamera', 2, false);
});

// === MultiCam-Pfad (Spec 2026-08-18-multikamera-instant-wechsel §8/§9) ===
//
// Trägt die eigene MultiCam-Session den Sucher, entfällt die CameraView: der
// Kamerawechsel tauscht nur die Eingänge derselben laufenden Session (keine
// Blende, kein Warten), Zoom und Fokus gehen ans eigene Modul, und die
// Sitzung überlebt den Wechsel per Konstruktion. Alles darüber (Zoomfläche,
// Fokus-Ring, Auslöser, Overlays) bleibt für beide Zweige dasselbe, die
// Tests oben laufen darum unverändert weiter auf dem expo-camera-Zweig.
async function multiCamSucher() {
  mockMultiKamera.verfuegbar.mockReturnValue(true);
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');
}

// Hält den Auslöser über die Haltezeit hinaus: ab hier läuft ein Video.
async function aufnahmeHalten() {
  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
}

test('der Sucher ist die MultiKamera-View, keine CameraView', async () => {
  await multiCamSucher();

  expect(screen.getByTestId('multikamera-sucher')).toBeTruthy();
  expect(screen.queryByTestId('kameraview-attrappe')).toBeNull();
  // Die CameraView wird nicht bloss versteckt, sie entsteht gar nicht: zwei
  // Kamera-Sessions auf denselben Geräten schlössen einander ohnehin aus.
  expect(mockCameraProps).not.toHaveBeenCalled();
});

test('der Fokus startet die Session; ein Fehlschlag fällt auf expo-camera zurück', async () => {
  mockMultiKamera.verfuegbar.mockReturnValue(true);
  // Kein Modul, alter Build, oder zweimal gescheiterter Aufbau: der Screen
  // fällt für den REST der Sitzung auf expo-camera zurück (Spec §9).
  mockMultiKamera.starten.mockResolvedValue(false);
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  expect(mockMultiKamera.starten).toHaveBeenCalled();
  expect(await screen.findByTestId('kameraview-attrappe')).toBeTruthy();
  expect(screen.queryByTestId('multikamera-sucher')).toBeNull();
});

test('der Doppeltipp ruft wechsleKamera und zeigt keine Wechsel-Blende', async () => {
  await multiCamSucher();
  expect(screen.getByTestId('zoom-wahl')).toBeTruthy();

  await tippen();
  await tippen();

  expect(mockMultiKamera.wechsleKamera).toHaveBeenCalledTimes(1);
  // Die Blende deckte den Hardware-Umbau der CameraView ab (~350–650 ms).
  // Hier gibt es keinen: eine Blende wäre nur noch ein Schleier über einem
  // Sucher, der längst weiterläuft.
  expect(screen.queryByTestId('wechsel-blende')).toBeNull();
  // Die Front hat nur eine Linse: dass die Reihe verschwindet, belegt die
  // sofort umgestellte Blickrichtung (ein CameraView-Prop gibt es hier nicht).
  expect(screen.queryByTestId('zoom-wahl')).toBeNull();
});

test('der Doppeltipp wechselt auch während der gehaltenen Aufnahme', async () => {
  // Der nativLaeuft-Gate (Mock-Default: die native Pipeline lehnt ab) sperrte
  // den Wechsel im expo-camera-Zweig, weil der Session-Umbau eine laufende
  // recordAsync abbräche. Die MultiCam-Session übersteht ihn per Konstruktion.
  await multiCamSucher();

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', {
    nativeEvent: { pageX: 100, identifier: 1 },
  });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  // Der Responder gehört dem Auslöser, der zweite Finger kommt über die
  // rohen Touch-Ereignisse an (gleicher Weg wie der Fokus-Tipp).
  const flaeche = sucherFlaeche();
  for (const id of [7, 8]) {
    await act(async () => {
      flaeche.props.onTouchStart({ nativeEvent: { identifier: id, pageX: 210, pageY: 380 } });
    });
    await act(async () => {
      flaeche.props.onTouchEnd({ nativeEvent: { identifier: id, pageX: 211, pageY: 381 } });
    });
  }

  expect(mockMultiKamera.wechsleKamera).toHaveBeenCalledTimes(1);
});

// Der Wechsel hat zwei Aufgaben, nicht eine: die Kamera tauschen UND den
// nativen Zoom auf die neue Richtung nachziehen. Die Anzeige geht beim Wechsel
// auf 1×, das Modul merkt sich zu jeder Richtung aber ihre zuletzt gewählte
// Kamera samt stehendem Zoomfaktor. Ohne das Nachziehen stünde nach einem
// Rundlauf (Back auf 0,5×, hinüber zur Front, zurück) in der Reihe 1× und im
// Bild der Ultraweitwinkel, und der nächste Pinch spränge, weil er ab dem
// angezeigten 1× rechnet. Im expo-camera-Zweig erledigt das zoomNachsetzen
// über onAvailableLensesChanged.
test('nach dem Wechsel zieht der Screen den nativen Zoom auf die neue Richtung nach', async () => {
  await multiCamSucher();
  await fireEvent.press(screen.getByText('0,5×'));
  mockMultiKamera.zoomSetzen.mockClear();

  // Hinüber zur Frontkamera.
  mockMultiKamera.wechsleKamera.mockResolvedValue('front');
  await tippen();
  await tippen();
  expect(mockMultiKamera.zoomSetzen).toHaveBeenLastCalledWith({ kamera: 'front', faktor: 1 }, false);

  // Und zurück: nativ stünde die Rückseite sonst weiter auf dem
  // Ultraweitwinkel, den der Rundlauf oben gewählt hatte.
  mockMultiKamera.wechsleKamera.mockResolvedValue('back');
  mockMultiKamera.zoomSetzen.mockClear();
  await tippen();
  await tippen();
  expect(mockMultiKamera.zoomSetzen).toHaveBeenLastCalledWith({ kamera: 'weit', faktor: 1 }, false);

  // Lehnt das Modul den Wechsel ab (oder gibt es keines), behält es seine
  // bisherige Ansicht: dann gibt es auch nichts nachzuziehen.
  mockMultiKamera.wechsleKamera.mockResolvedValue(null);
  mockMultiKamera.zoomSetzen.mockClear();
  await tippen();
  await tippen();
  expect(mockMultiKamera.zoomSetzen).not.toHaveBeenCalled();
});

test('zoomSetzen geht als MultiCamZiel ans Modul', async () => {
  await multiCamSucher();

  await fireEvent.press(screen.getByText('0,5×'));

  // 0,5× ist keine Regler-Stellung, sondern eine eigene Linse: die Session
  // wechselt aufs Ultraweitwinkel und steht dort auf dessen 1,0.
  expect(mockMultiKamera.zoomSetzen).toHaveBeenLastCalledWith(
    { kamera: 'ultraweit', faktor: 1 },
    true
  );
  // Das virtuelle Gerät wird weiter ENUMERIERT (daher Stufen und Grenzen),
  // läuft aber nicht in der Session: über nativeZoom geht nichts mehr.
  expect(mockSetzeZoom).not.toHaveBeenCalled();
});

test('Druck ernst bei 0,5× stellt den Zoom auf 1', async () => {
  await multiCamSucher();
  await fireEvent.press(screen.getByText('0,5×'));
  mockMultiKamera.zoomSetzen.mockClear();

  const melden = mockMultiKamera.aufDruck.mock.calls.at(-1)![0];
  // 'nominal' ist kein Grund einzugreifen: der Nutzer zoomt selbst zurück.
  await act(async () => {
    melden('nominal');
  });
  expect(mockMultiKamera.zoomSetzen).not.toHaveBeenCalled();

  // 'ernst' heisst: zwei Kameras zugleich sind dem Gerät zu viel. Die
  // Ultraweitwinkel-Linse ist der teure Teil, 1× läuft auf einer allein.
  await act(async () => {
    melden('ernst');
  });
  expect(mockMultiKamera.zoomSetzen).toHaveBeenCalledWith({ kamera: 'weit', faktor: 1 }, false);
  expect(screen.getByLabelText('Zoom 1×').props.accessibilityState.selected).toBe(true);
});

test('ein Tipp fokussiert über das MultiKamera-Modul', async () => {
  await multiCamSucher();

  await tippen(140, 420, { x: 140, y: 420 });

  expect(mockMultiKamera.fokussiere).toHaveBeenCalledWith(140, 420);
  expect(mockFokussiere).not.toHaveBeenCalled();
  // Der Ring ist die sichtbare Antwort, in beiden Zweigen derselbe.
  expect(screen.getByTestId('fokus-ring')).toBeTruthy();
});

test('ein Blur ohne Vorschau stoppt die Session', async () => {
  await multiCamSucher();
  expect(mockMultiKamera.stoppen).not.toHaveBeenCalled();

  // Ein anderer Tab: der Aufnahme-Fluss ist vorbei, niemand braucht die
  // Session mehr (dieselbe Bedingung wie das mute-Prop im anderen Zweig).
  await fokusVerlieren();

  expect(mockMultiKamera.stoppen).toHaveBeenCalledTimes(1);
});

// Die zweite Hälfte derselben Bedingung: ein Tab-Wechsel mitten in der
// Aufnahme (die Tab-Sperre lässt ihn nicht zu, ein Deep Link schon) darf die
// Session nicht unter der laufenden Aufnahme wegziehen.
test('ein Blur während laufender Aufnahme stoppt die Session nicht', async () => {
  await multiCamSucher();

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  // Kein Loslassen: die Aufnahme läuft noch, während der Fokus geht.
  await fokusVerlieren();

  expect(mockMultiKamera.stoppen).not.toHaveBeenCalled();
});

test('liegt die Vorschau über dem Tab, läuft die Session weiter', async () => {
  await multiCamSucher();

  await aufnahmeHalten();
  await act(async () => {
    await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  });
  expect(mockPush).toHaveBeenCalled();

  // Der Blur kommt hier von der Vorschau, die den Tab überdeckt: ein Stopp
  // wäre ein Session-Neuaufbau ausgerechnet auf dem Instant-Rückweg.
  await fokusVerlieren();

  expect(mockMultiKamera.stoppen).not.toHaveBeenCalled();
});

// === Video-Aufnahme im MultiCam-Pfad (Task 5) ===
//
// Die Aufnahme entsteht nativ in der EIGENEN Session: derselbe Writer wie in
// der KameraAufnahme-Pipeline, nur gefüllt vom Verteiler der MultiCam-Session.
// Deshalb wechselt hier allein der Start- und Stopp-Aufruf; alles Nachgelagerte
// (dateiFertig, Verwerfen, Sofort-Vorschau, Übergabe) hängt weiterhin an
// nativeAufnahme, denn es greift nativ auf dieselbe laufende Aufnahme zu.
test('der Video-Start geht im MultiCam-Zweig ans MultiKamera-Modul', async () => {
  await multiCamSucher();

  await aufnahmeHalten();

  expect(mockMultiKamera.aufnahmeStarten).toHaveBeenCalledWith(90);
  // Die andere Pipeline sucht sich den expo-camera-Sucher, den es hier nicht
  // gibt; und recordAsync gehört einer CameraView, die gar nicht entstanden ist.
  expect(mockNativeAufnahme.aufnahmeStarten).not.toHaveBeenCalled();
  expect(mockRecordAsync).not.toHaveBeenCalled();
});

test('der Stopp holt Datei und Dauer vom MultiKamera-Modul', async () => {
  await multiCamSucher();

  await aufnahmeHalten();
  await act(async () => {
    await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  });

  expect(mockMultiKamera.aufnahmeStoppen).toHaveBeenCalledTimes(1);
  expect(mockNativeAufnahme.aufnahmeStoppen).not.toHaveBeenCalled();
  // Kein Vorwärm-Player: die Datei ist schon da, die Sofort-Vorschau spielt
  // sie nativ (derselbe Weg wie bei der KameraAufnahme-Pipeline).
  expect(mockCreateVideoPlayer).not.toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/vorschau',
    params: { uri: 'file://multicam.mov', typ: 'video', dauer: '6', tripId: 't1' },
  });
  // Die Übergabe bleibt wörtlich dieselbe: das Warten auf die fertige Datei
  // läuft über nativeAufnahme, weil dort dieselbe Aufnahme hängt.
  expect(uebergabe.videoAbholen()?.art).toBe('nativ');
  expect(mockNativeAufnahme.dateiFertig).toHaveBeenCalled();
});

test('scheitert der Start im MultiCam-Zweig, erscheint die Fehlerpille statt recordAsync', async () => {
  await multiCamSucher();
  // «laeuft_schon» oder «keine_session»: es gibt hier keinen Rückweg über
  // recordAsync (die CameraView existiert nicht, cameraRef ist null).
  mockMultiKamera.aufnahmeStarten.mockResolvedValue(false);

  await aufnahmeHalten();
  await act(async () => {
    await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  });

  expect(mockMultiKamera.aufnahmeStarten).toHaveBeenCalledWith(90);
  expect(await screen.findByText(FEHLERTEXT)).toBeTruthy();
  expect(mockRecordAsync).not.toHaveBeenCalled();
  expect(mockMultiKamera.aufnahmeStoppen).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
  // Und die Tab-Bar ist wieder frei: der Versuch ist vorbei.
  expect(aufnahmeSperre.istGesperrt()).toBe(false);
});

// Das Dauerlicht: im expo-camera-Zweig ein Prop (enableTorch), hier ein
// Aufruf ans Modul, weil die eigene Session keine Props kennt.
test('der Blitz leuchtet im MultiCam-Zweig während der Aufnahme und geht beim Loslassen aus', async () => {
  await multiCamSucher();

  await fireEvent.press(screen.getByLabelText('Blitz einschalten'));
  // Eingeschaltet, aber noch keine Aufnahme: das Dauerlicht bleibt aus.
  expect(mockMultiKamera.blitz).toHaveBeenLastCalledWith(false);

  await aufnahmeHalten();
  expect(mockMultiKamera.blitz).toHaveBeenLastCalledWith(true);

  await act(async () => {
    await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  });
  expect(mockMultiKamera.blitz).toHaveBeenLastCalledWith(false);
});

// Nagelt das Abhängigkeits-Array des Blitz-Effekts fest: die Lampe hängt an
// einem Gerät, ein Wechsel mitten in der Aufnahme muss sie also neu setzen.
// (Nativ führt das Modul den gewünschten Zustand beim Wechsel selbst nach, weil
// dieser Aufruf hier das Rennen gegen die Main-Queue verlieren kann; der Effekt
// bleibt die Doppelung, die den Wunsch überhaupt erst dorthin bringt.)
test('ein Kamerawechsel während der Aufnahme setzt den Blitz neu', async () => {
  await multiCamSucher();
  await fireEvent.press(screen.getByLabelText('Blitz einschalten'));
  await aufnahmeHalten();
  expect(mockMultiKamera.blitz).toHaveBeenLastCalledWith(true);
  mockMultiKamera.blitz.mockClear();

  // Der Doppeltipp des zweiten Fingers wechselt auch während der gehaltenen
  // Aufnahme (der Responder gehört dem Auslöser, siehe oben).
  const flaeche = sucherFlaeche();
  for (const id of [7, 8]) {
    await act(async () => {
      flaeche.props.onTouchStart({ nativeEvent: { identifier: id, pageX: 210, pageY: 380 } });
    });
    await act(async () => {
      flaeche.props.onTouchEnd({ nativeEvent: { identifier: id, pageX: 211, pageY: 381 } });
    });
  }

  expect(mockMultiKamera.wechsleKamera).toHaveBeenCalledTimes(1);
  expect(mockMultiKamera.blitz).toHaveBeenCalled();
  expect(mockMultiKamera.blitz).toHaveBeenLastCalledWith(true);
});

// === Foto im MultiCam-Pfad (Task 6) ===
//
// Kein zweiter Foto-Ausgang und kein takePictureAsync: das Bild ist der
// nächste Frame des laufenden Stroms, den das Modul als JPEG ins tmp legt
// (Spec §6). Es reist auf demselben Weg zur Vorschau wie das Bild des
// expo-camera-Zweigs, über den Übergabe-Holder, damit «Einsenden» dort
// unverändert auf `datei` wartet.
test('der Auslöser holt das Foto vom MultiKamera-Modul und geht zur Vorschau', async () => {
  await multiCamSucher();

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  expect(mockMultiKamera.fotoAufnehmen).toHaveBeenCalledTimes(1);
  expect(mockTakePictureAsync).not.toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/vorschau',
    params: { typ: 'photo', dauer: '0', tripId: 't1' },
  });
  // Die Übergabe trägt die fertige Datei: die Vorschau zeigt sie und sendet
  // genau sie ein (im anderen Zweig steckt hier das Hintergrund-Speichern).
  const abgeholt = uebergabe.abholen();
  expect(abgeholt).not.toBeNull();
  await expect(abgeholt!.datei).resolves.toEqual({ uri: 'file:///tmp/reelive-foto-1.jpg' });
  // Auch die GESTALT der Anzeige-Quelle steht fest: hier liegt kein
  // PictureRef, sondern die tmp-Datei in der Form `{ uri }` (expo-image nimmt
  // beides). Der Screen deutet sie dafür einmal um; ohne diese Zusicherung
  // liefe ein späteres Weiten des Übergabe-Typs an dieser Stelle vorbei.
  expect(abgeholt!.ref).toEqual({ uri: 'file:///tmp/reelive-foto-1.jpg' });
});

// Der Sucher läuft unter der Vorschau weiter (Spec §6): es gibt hier nichts
// einzufrieren, die MultiCam-Session hat keine Vorschau-Pause, und der Weg
// zurück soll auf ein laufendes Bild treffen.
test('der Sucher wird im MultiCam-Pfad nicht pausiert', async () => {
  await multiCamSucher();

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  // Der Griff ist gelaufen (sonst prüfte der Rest die Abwesenheit von
  // nichts), und trotzdem hat niemand eingefroren oder aufgetaut.
  expect(mockMultiKamera.fotoAufnehmen).toHaveBeenCalledTimes(1);
  expect(mockPausePreview).not.toHaveBeenCalled();
  expect(mockResumePreview).not.toHaveBeenCalled();
});

// Der Blitz ist im MultiCam-Pfad kein Prop und keine Foto-Einstellung der
// CameraView, sondern ein Argument des Griffs: das Modul zündet die Lampe,
// wartet die Belichtung ab und greift dann.
test('die Blitz-Einstellung wandert in fotoAufnehmen', async () => {
  await multiCamSucher();

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(mockMultiKamera.fotoAufnehmen).toHaveBeenLastCalledWith(false);

  await fireEvent.press(screen.getByLabelText('Blitz einschalten'));
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(mockMultiKamera.fotoAufnehmen).toHaveBeenLastCalledWith(true);
});

// «kein_frame» (die Session liefert nichts mehr) oder «keine_session»: es
// gibt hier keinen Rückweg über takePictureAsync (die CameraView existiert
// nicht). Die Pille sagt es, und die Tab-Bar ist danach wieder frei.
test('scheitert das Foto im MultiCam-Zweig, sagt es die Pille und die Tab-Bar ist frei', async () => {
  await multiCamSucher();
  mockMultiKamera.fotoAufnehmen.mockResolvedValue(null);

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  // Die Ablehnung kommt vom Modul, nicht von einer fehlenden CameraView.
  expect(mockMultiKamera.fotoAufnehmen).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('Das Foto hat nicht geklappt. Versuch es nochmal.')).toBeTruthy();
  expect(mockPush).not.toHaveBeenCalled();
  expect(aufnahmeSperre.istGesperrt()).toBe(false);
});

// Derselbe Re-Entry-Schutz wie im expo-camera-Zweig: zwischen `pressOut` und
// dem Navigations-Commit bleibt der Auslöser bedienbar, ein zweiter Tipp
// stiesse ohne Sperre einen zweiten Griff an und überschriebe den Holder.
test('ein zweiter, schneller Tipp löst im MultiCam-Zweig kein zweites Foto aus', async () => {
  await multiCamSucher();
  let aufloesen: (v: { uri: string; breite: number; hoehe: number }) => void = () => {};
  mockMultiKamera.fotoAufnehmen.mockImplementation(
    () =>
      new Promise((resolve) => {
        aufloesen = resolve;
      })
  );

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(aufnahmeSperre.istGesperrt()).toBe(true);
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  await act(async () => {
    aufloesen({ uri: 'file:///tmp/reelive-foto-1.jpg', breite: 1080, hoehe: 1920 });
  });

  expect(mockMultiKamera.fotoAufnehmen).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(aufnahmeSperre.istGesperrt()).toBe(false);
});
