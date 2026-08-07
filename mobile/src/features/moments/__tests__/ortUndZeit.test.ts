jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 47.05, longitude: 8.31 } })),
  reverseGeocodeAsync: jest.fn(async () => [{ city: 'Luzern' }]),
}));

import { jetzt, ortBestimmen } from '../ortUndZeit';
import * as Location from 'expo-location';

afterEach(() => {
  jest.useRealTimers();
});

test('jetzt liefert ISO-Zeit und die Zone des Geräts', () => {
  const { captured_at, captured_tz } = jetzt();
  expect(captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(captured_tz.length).toBeGreaterThan(0);
});

test('ortBestimmen liefert Koordinaten und Ortsnamen', async () => {
  await expect(ortBestimmen()).resolves.toEqual({ lat: 47.05, lng: 8.31, place_name: 'Luzern' });
});

test('ohne Berechtigung kommen drei null zurück, ohne zu werfen', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'denied' });
  await expect(ortBestimmen()).resolves.toEqual({ lat: null, lng: null, place_name: null });
});

test('ein Fehler beim Geocoding kostet höchstens den Ortsnamen', async () => {
  (Location.reverseGeocodeAsync as jest.Mock).mockRejectedValueOnce(new Error('kaputt'));
  await expect(ortBestimmen()).resolves.toEqual({ lat: 47.05, lng: 8.31, place_name: null });
});

// Nicht im Brief vorgegeben, aber von der Aufgabenstellung explizit verlangt
// (Task-8-Kontext: "Verweigerte Berechtigung, Zeitüberschreitung, fehlgeschlagenes
// Geocoding — in jedem Fall wird der Moment eingesendet, nur eben ohne Ort.").
// Ohne diesen Test bliebe eine hängende Positionsbestimmung (kein GPS-Fix)
// unbemerkt ewig unaufgelöst statt nach einer Frist auf "kein Ort" zu fallen.
test('eine hängende Positionsbestimmung liefert nach der Frist drei null statt ewig zu hängen', async () => {
  jest.useFakeTimers();
  (Location.getCurrentPositionAsync as jest.Mock).mockImplementation(() => new Promise(() => {}));

  const ergebnis = ortBestimmen();
  await jest.advanceTimersByTimeAsync(30_000);

  await expect(ergebnis).resolves.toEqual({ lat: null, lng: null, place_name: null });
});

test('ein Fehler bei der Positionsbestimmung selbst liefert drei null, ohne zu werfen', async () => {
  (Location.getCurrentPositionAsync as jest.Mock).mockRejectedValueOnce(new Error('GPS kaputt'));
  await expect(ortBestimmen()).resolves.toEqual({ lat: null, lng: null, place_name: null });
});
