// Der offizielle In-Memory-Mock des Pakets: dieselbe API, kein Nativmodul.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { benachrichtigungenAktiv, setzeBenachrichtigungen } from '../einstellungen';

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

// Anders als «Nur über WLAN» (Default aus) ist der Default hier AN: die
// Registrierung lief seit Task 4 bei jedem signedIn automatisch, und der neue
// Schalter darf bestehende Installationen nicht stummschalten.
test('ohne Eintrag gilt: Benachrichtigungen an', async () => {
  await expect(benachrichtigungenAktiv()).resolves.toBe(true);
});

test('aus wird gespeichert und wieder gelesen', async () => {
  await setzeBenachrichtigungen(false);
  await expect(benachrichtigungenAktiv()).resolves.toBe(false);
});

test('wieder an wird gespeichert und wieder gelesen', async () => {
  await setzeBenachrichtigungen(false);
  await setzeBenachrichtigungen(true);
  await expect(benachrichtigungenAktiv()).resolves.toBe(true);
});

// Ein kaputter Speicher darf niemanden stummschalten: im Zweifel an.
test('ein Lesefehler fällt auf AN zurück', async () => {
  (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('kaputt'));
  await expect(benachrichtigungenAktiv()).resolves.toBe(true);
});

// Ein Schreibfehler darf den Einstellungen-Screen nicht abstürzen lassen
// (dasselbe Verhalten wie moments/einstellungen).
test('ein Schreibfehler wirft nicht', async () => {
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('kaputt'));
  await expect(setzeBenachrichtigungen(false)).resolves.toBeUndefined();
});
