// The most important test from the Task-4 brief: the web version of the
// session storage retains NOTHING (spec promise W5).
//
// A roundtrip test alone (setItem -> getItem === null) would pass even if
// the file secretly stored something via a SECOND path, e.g. silently
// falling back to expo-secure-store or AsyncStorage. That's why both are
// mocked as spies here: not a single call to either may ever happen,
// otherwise "stores nothing" would only be claimed, not proven.
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

test('setItem followed by getItem returns null, nothing is left hanging around', async () => {
  await secureSessionStorage.setItem('sb-session', '{"access_token":"abc"}');
  await expect(secureSessionStorage.getItem('sb-session')).resolves.toBeNull();
});

test('getItem returns null even without a prior setItem', async () => {
  await expect(secureSessionStorage.getItem('sb-session')).resolves.toBeNull();
});

test('removeItem never throws', async () => {
  await expect(secureSessionStorage.removeItem('sb-session')).resolves.toBeUndefined();
});

test('no second storage path: neither expo-secure-store nor AsyncStorage is ever touched', async () => {
  await secureSessionStorage.setItem('sb-session', 'wert');
  await secureSessionStorage.getItem('sb-session');
  await secureSessionStorage.removeItem('sb-session');

  expect(mockSecureStoreSetItemAsync).not.toHaveBeenCalled();
  expect(mockSecureStoreGetItemAsync).not.toHaveBeenCalled();
  expect(mockAsyncStorageSetItem).not.toHaveBeenCalled();
  expect(mockAsyncStorageGetItem).not.toHaveBeenCalled();
});
