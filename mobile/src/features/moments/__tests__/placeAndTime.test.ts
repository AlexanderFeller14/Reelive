jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 47.05, longitude: 8.31 } })),
  reverseGeocodeAsync: jest.fn(async () => [{ city: 'Luzern' }]),
}));

import { now, determinePlace, describePlace } from '../placeAndTime';
import * as Location from 'expo-location';

afterEach(() => {
  jest.useRealTimers();
});

test('now returns ISO time and the device’s zone', () => {
  const { captured_at, captured_tz } = now();
  expect(captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(captured_tz.length).toBeGreaterThan(0);
});

test('determinePlace returns coordinates and a place name', async () => {
  await expect(determinePlace()).resolves.toEqual({ lat: 47.05, lng: 8.31, place_name: 'Luzern' });
});

test('without permission, three nulls come back, without throwing', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'denied' });
  await expect(determinePlace()).resolves.toEqual({ lat: null, lng: null, place_name: null });
});

test('an error during geocoding costs at most the place name', async () => {
  (Location.reverseGeocodeAsync as jest.Mock).mockRejectedValueOnce(new Error('kaputt'));
  await expect(determinePlace()).resolves.toEqual({ lat: 47.05, lng: 8.31, place_name: null });
});

// Not specified in the brief, but explicitly required by the task
// (Task-8-Kontext: "Denied permission, timeout, failed geocoding, in every
// case the moment gets submitted, just without a place."). Without this
// test, a hanging position determination (no GPS fix) would stay
// unnoticed and unresolved forever instead of falling back to "no place"
// after a timeout.
test('a hanging position determination returns three nulls after the timeout instead of hanging forever', async () => {
  jest.useFakeTimers();
  (Location.getCurrentPositionAsync as jest.Mock).mockImplementation(() => new Promise(() => {}));

  const result = determinePlace();
  await jest.advanceTimersByTimeAsync(30_000);

  await expect(result).resolves.toEqual({ lat: null, lng: null, place_name: null });
});

test('an error in the position determination itself returns three nulls, without throwing', async () => {
  (Location.getCurrentPositionAsync as jest.Mock).mockRejectedValueOnce(new Error('GPS kaputt'));
  await expect(determinePlace()).resolves.toEqual({ lat: null, lng: null, place_name: null });
});

test('describePlace turns coordinates into a city name', async () => {
  await expect(describePlace(47.05, 8.31)).resolves.toBe('Luzern');
  expect(Location.reverseGeocodeAsync).toHaveBeenCalledWith({ latitude: 47.05, longitude: 8.31 });
});

test('describePlace answers null when geocoding fails, without throwing', async () => {
  (Location.reverseGeocodeAsync as jest.Mock).mockRejectedValueOnce(new Error('kaputt'));
  await expect(describePlace(47.05, 8.31)).resolves.toBeNull();
});

test('describePlace answers null when geocoding hangs past the timeout', async () => {
  jest.useFakeTimers();
  (Location.reverseGeocodeAsync as jest.Mock).mockImplementationOnce(() => new Promise(() => {}));
  const pending = describePlace(47.05, 8.31);
  await jest.advanceTimersByTimeAsync(8_000);
  await expect(pending).resolves.toBeNull();
});
