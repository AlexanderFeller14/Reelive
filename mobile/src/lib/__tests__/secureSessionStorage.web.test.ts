// Der wichtigste Test aus dem Task-4-Brief: die Web-Fassung des
// Sitzungsspeichers behält NICHTS (Spec-Versprechen W5).
//
// Ein Roundtrip-Test allein (setItem → getItem === null) würde durchgehen,
// selbst wenn die Datei heimlich über einen ZWEITEN Pfad doch etwas
// ablegt, z.B. still auf expo-secure-store oder AsyncStorage zurückfiele.
// Deshalb werden beide hier als Spione gemockt: kein Aufruf davon darf je
// passieren, sonst wäre "speichert nichts" nur behauptet, nicht bewiesen.
const mockSecureStoreSetItemAsync = jest.fn();
const mockSecureStoreGetItemAsync = jest.fn();
const mockAsyncStorageSetItem = jest.fn();
const mockAsyncStorageGetItem = jest.fn();

jest.mock('expo-secure-store', () => ({
  setItemAsync: (...a: unknown[]) => mockSecureStoreSetItemAsync(...a),
  getItemAsync: (...a: unknown[]) => mockSecureStoreGetItemAsync(...a),
  deleteItemAsync: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: (...a: unknown[]) => mockAsyncStorageSetItem(...a),
  getItem: (...a: unknown[]) => mockAsyncStorageGetItem(...a),
  removeItem: jest.fn(),
}));

import { secureSessionStorage } from '../secureSessionStorage.web';

beforeEach(() => jest.clearAllMocks());

test('setItem gefolgt von getItem liefert null, es bleibt nichts hängen', async () => {
  await secureSessionStorage.setItem('sb-session', '{"access_token":"abc"}');
  await expect(secureSessionStorage.getItem('sb-session')).resolves.toBeNull();
});

test('getItem liefert null auch ohne vorheriges setItem', async () => {
  await expect(secureSessionStorage.getItem('sb-session')).resolves.toBeNull();
});

test('removeItem wirft nie', async () => {
  await expect(secureSessionStorage.removeItem('sb-session')).resolves.toBeUndefined();
});

test('kein zweiter Speicherpfad: weder expo-secure-store noch AsyncStorage werden je berührt', async () => {
  await secureSessionStorage.setItem('sb-session', 'wert');
  await secureSessionStorage.getItem('sb-session');
  await secureSessionStorage.removeItem('sb-session');

  expect(mockSecureStoreSetItemAsync).not.toHaveBeenCalled();
  expect(mockSecureStoreGetItemAsync).not.toHaveBeenCalled();
  expect(mockAsyncStorageSetItem).not.toHaveBeenCalled();
  expect(mockAsyncStorageGetItem).not.toHaveBeenCalled();
});
