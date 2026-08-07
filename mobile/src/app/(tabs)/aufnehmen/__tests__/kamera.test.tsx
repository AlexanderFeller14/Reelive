import { render, screen, fireEvent, act } from '@testing-library/react-native';
import * as React from 'react';
import type { Trip } from '@/features/trips/types';

const mockPush = jest.fn();

// useFocusEffect als echter Effekt statt als Aufruf beim Rendern.
//
// Die Vorfassung rief den Callback bei JEDEM Rendern auf (wie in
// reise/__tests__/liste.test.tsx). Das ging nur so lange gut, wie `laden()`
// bei gleichbleibendem Ergebnis dieselbe Array-Referenz zurücksetzte und
// React deshalb aus dem Rendern ausstieg — sobald der Ladeweg eine neue Liste
// erzeugt (etwa den aus dem Speicher geparsten Bestand, Critical 1), dreht
// sich das endlos. Ein Effekt mit Abhängigkeiten bildet das echte Verhalten
// ohnehin näher ab: einmal beim Fokussieren, nicht bei jedem Rendern.
//
// `mockFokusStand`/`mockFokusHoerer` machen ein erneutes Fokussieren
// auslösbar (siehe erneutFokussieren) — Voraussetzung dafür, dass sich der
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
      ReactActual.useEffect(cb, [cb, stand]);
    },
  };
});

// Simuliert die Rückkehr auf den Screen (z.B. aus der Vorschau).
async function erneutFokussieren() {
  mockFokusStand += 1;
  await act(async () => {
    mockFokusHoerer.forEach((setzen) => setzen(mockFokusStand));
  });
}

jest.mock('@/features/trips/tripsApi', () => ({ fetchTrips: jest.fn() }));

// Der lokale Reise-Bestand (Final-Review, Critical 1) wird hier NICHT gemockt,
// sondern echt benutzt — nur AsyncStorage darunter ist ein Doppelgänger. So
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
// mehr aus reise.my_post_count — sonst bewegt er sich nach einer Offline-
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

const mockTakePictureAsync = jest.fn();
const mockRecordAsync = jest.fn();
const mockStopRecording = jest.fn();

type PermissionMock = { status: string; granted: boolean; canAskAgain: boolean; expires: 'never' };
const GEWAEHRT: PermissionMock = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
let mockCameraPermission: PermissionMock = GEWAEHRT;
let mockMicPermission: PermissionMock = GEWAEHRT;
const mockRequestCameraPermission = jest.fn();
const mockRequestMicPermission = jest.fn();

// Merkt sich die zuletzt gerenderten Props, damit sich prüfen lässt, was die
// Kamera tatsächlich bekommt (Richtung, Blitz) — Important 7.
const mockCameraProps = jest.fn();
jest.mock('expo-camera', () => {
  const ReactActual = require('react');
  return {
    CameraView: ReactActual.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      mockCameraProps(props);
      ReactActual.useImperativeHandle(ref, () => ({
        takePictureAsync: mockTakePictureAsync,
        recordAsync: mockRecordAsync,
        stopRecording: mockStopRecording,
      }));
      return null;
    }),
    useCameraPermissions: () => [mockCameraPermission, mockRequestCameraPermission, jest.fn()],
    useMicrophonePermissions: () => [mockMicPermission, mockRequestMicPermission, jest.fn()],
  };
});

import AufnehmenScreen from '../index';
import { fetchTrips } from '@/features/trips/tripsApi';

const reise = (over: Partial<Trip> = {}): Trip => ({
  id: 't1',
  name: 'Norwegen mit dem Camper',
  start_date: '2026-08-01',
  end_date: '2026-08-14',
  status: 'active',
  owner_id: 'u1',
  member_names: ['Lea'],
  member_count: 1,
  my_post_count: 4,
  ...over,
});

const geladen = (data: Trip[]) => ({ data, error: null });

beforeEach(() => {
  jest.clearAllMocks();
  mockSpeicher.clear();
  mockAuth.userId = 'u1';
  // jest.clearAllMocks() setzt nur die Aufruf-Historie zurück, NICHT eine per
  // mockResolvedValue gesetzte Implementierung — sonst sickerte sie in jeden
  // folgenden Test durch (gleiche Falle wie in uploadWorker.test.ts).
  mockEigenerZaehler.mockImplementation(async () => 0);
  mockCameraPermission = GEWAEHRT;
  mockMicPermission = GEWAEHRT;
  mockTakePictureAsync.mockResolvedValue({ uri: 'file://foto.jpg', width: 100, height: 100, format: 'jpg' });
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
// Fehlerseite ersetzt — und damit, dass «Aufnehmen funktioniert vollständig
// offline» (Spec §1) an seinem allerersten Screen bricht. Die Fehlerseite
// gehört nur noch dorthin, wo es auch nichts Vorgehaltenes gibt.
test('ohne je geladenen Bestand zeigt ein Ladefehler die Ursache mit einer Wiederholen-Möglichkeit', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: 'Offline — ohne Netz keine aktuellen Daten.' });
  await render(<AufnehmenScreen />);
  expect(await screen.findByText('Offline — ohne Netz keine aktuellen Daten.')).toBeTruthy();

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
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: 'Offline — ohne Netz keine aktuellen Daten.' });
  await render(<AufnehmenScreen />);

  expect(await screen.findByLabelText('Auslöser')).toBeTruthy();
  expect(screen.getByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.queryByText('Das hat nicht geklappt')).toBeNull();
  expect(screen.queryByText('Offline — ohne Netz keine aktuellen Daten.')).toBeNull();
});

// Der Bestand gehört zur Person, nicht zum Gerät: sonst sähe B im Flugmodus
// A's Reisen.
test('der vorgehaltene Bestand einer anderen Person wird nicht angezeigt', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  const ersteSitzung = await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');
  await ersteSitzung.unmount();

  mockAuth.userId = 'person-b';
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: 'Offline — ohne Netz keine aktuellen Daten.' });
  await render(<AufnehmenScreen />);

  expect(await screen.findByText('Offline — ohne Netz keine aktuellen Daten.')).toBeTruthy();
  expect(screen.queryByText('Norwegen mit dem Camper')).toBeNull();
});

// Ein vorgehaltener LEERER Bestand ist eine Aussage («du hattest zuletzt keine
// Reise»), kein fehlender Bestand — er führt auf den Einladungs-Weg, nicht auf
// die Fehlerseite.
test('ein vorgehaltener leerer Bestand führt offline auf «Keine laufende Reise»', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([]));
  const ersteSitzung = await render(<AufnehmenScreen />);
  await screen.findByText('Keine laufende Reise');
  await ersteSitzung.unmount();

  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: 'Offline — ohne Netz keine aktuellen Daten.' });
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

// Task 10: der Zähler ist Task 9s eigenerZaehler — er zählt wartende Momente
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
// Kamera-Screen erzeugte — der Effekt lief also zwangsläufig neu. Sobald die
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
// Ohne .catch() an dieser Stelle bliebe eine unbehandelte Ablehnung stehen —
// der Screen soll stattdessen einfach beim my_post_count-Fallback bleiben.
test('eigenerZaehler schlägt fehl: die Pille zeigt trotzdem den Serverstand, kein Absturz', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise({ my_post_count: 4 })]));
  mockEigenerZaehler.mockRejectedValueOnce(new Error('kaputt'));
  await render(<AufnehmenScreen />);
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('4 Momente')).toBeTruthy();
});

test('ein Tipp auf den Auslöser nimmt ein Foto auf und navigiert zur Vorschau', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await render(<AufnehmenScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  expect(mockTakePictureAsync).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/aufnehmen/preview',
    params: { uri: 'file://foto.jpg', typ: 'photo', dauer: '0', tripId: 't1' },
  });
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

  expect(mockRecordAsync).toHaveBeenCalledWith({ maxDuration: 30 });

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(mockStopRecording).toHaveBeenCalledTimes(1);
  // Die Navigation wartet auf das Ergebnis von recordAsync — vor der
  // Auflösung darf noch nichts geschehen.
  expect(mockPush).not.toHaveBeenCalled();

  await act(async () => {
    resolveRecord({ uri: 'file://video.mp4' });
  });

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/aufnehmen/preview',
    params: { uri: 'file://video.mp4', typ: 'video', dauer: expect.any(String), tripId: 't1' },
  });
});

// Fix-Runde 1: die Vorfassung behandelte 'undetermined' (weder gefragt noch
// beantwortet — die Systemabfrage kann gerade laufen) fälschlich wie eine
// Ablehnung, weil `granted: false` bei beiden Zuständen gleich aussieht.
test('vor der ersten Antwort behauptet der Screen keine fehlende Berechtigung', async () => {
  mockCameraPermission = { status: 'undetermined', granted: false, canAskAgain: true, expires: 'never' };
  mockMicPermission = { status: 'undetermined', granted: false, canAskAgain: true, expires: 'never' };
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  const { rerender } = await render(<AufnehmenScreen />);
  // Erneutes Rendern (statt eines blossen `findByText`, das hier ins Leere
  // liefe — der Screen bleibt in diesem Zustand bewusst blank) treibt über
  // dasselbe `act()` alle bis dahin ausstehenden Mikrotasks durch, u.a. das
  // aufgelöste `fetchTrips()`. Damit ist sichergestellt, dass die Reise
  // wirklich geladen ist und wir den Berechtigungs-Zweig prüfen, nicht bloss
  // noch im (visuell identischen) Trips-Ladezustand stecken.
  await rerender(<AufnehmenScreen />);

  expect(screen.queryByText('Kamera-Zugriff fehlt')).toBeNull();
  expect(screen.queryByLabelText('Auslöser')).toBeNull();
  expect(mockRequestCameraPermission).toHaveBeenCalled();
  expect(mockRequestMicPermission).toHaveBeenCalled();

  // Gegenprobe: sobald die Antwort da ist (granted), erscheint der Sucher —
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

// Beim Video greift `flash` nicht — dort braucht es das Dauerlicht. Derselbe
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
