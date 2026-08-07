import { render, screen, fireEvent, act } from '@testing-library/react-native';
import * as React from 'react';
import type { Trip } from '@/features/trips/types';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  // Gleiches vereinfachtes Muster wie in reise/__tests__/liste.test.tsx: der
  // Fokus-Effekt läuft synchron beim Rendern statt erst nach dem Commit.
  useFocusEffect: (cb: () => void | (() => void)) => cb(),
}));

jest.mock('@/features/trips/tripsApi', () => ({ fetchTrips: jest.fn() }));

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

jest.mock('expo-camera', () => {
  const ReactActual = require('react');
  return {
    CameraView: ReactActual.forwardRef((_props: unknown, ref: unknown) => {
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

test('ein Ladefehler zeigt die Ursache mit einer Wiederholen-Möglichkeit', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: 'Offline — ohne Netz keine aktuellen Daten.' });
  await render(<AufnehmenScreen />);
  expect(await screen.findByText('Offline — ohne Netz keine aktuellen Daten.')).toBeTruthy();

  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await fireEvent.press(screen.getByText('Nochmal versuchen'));
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
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
