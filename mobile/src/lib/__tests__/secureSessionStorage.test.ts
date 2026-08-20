// Jest hoisting: variables in jest.mock factories MUST start with "mock"
const mockSecureStore = new Map<string, string>();
const mockAsyncStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockSecureStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockSecureStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockSecureStore.delete(k)),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockAsyncStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => void mockAsyncStore.set(k, v)),
  removeItem: jest.fn(async (k: string) => void mockAsyncStore.delete(k)),
}));
jest.mock('expo-crypto', () => ({
  getRandomValues: (arr: Uint8Array) => { arr.forEach((_, i) => (arr[i] = (i * 7 + 13) % 256)); return arr; },
}));

import { secureSessionStorage } from '../secureSessionStorage';

beforeEach(() => { mockSecureStore.clear(); mockAsyncStore.clear(); });

test('roundtrip: setItem -> getItem returns the value', async () => {
  await secureSessionStorage.setItem('sb-session', '{"access_token":"abc"}');
  await expect(secureSessionStorage.getItem('sb-session')).resolves.toBe('{"access_token":"abc"}');
});

test('payload does NOT sit in plaintext in AsyncStorage', async () => {
  await secureSessionStorage.setItem('sb-session', 'geheimer-inhalt');
  expect([...mockAsyncStore.values()].join()).not.toContain('geheimer-inhalt');
});

test('restart simulation: value survives a module reset', async () => {
  await secureSessionStorage.setItem('sb-session', 'bleibt');
  jest.resetModules();
  const fresh = require('../secureSessionStorage').secureSessionStorage;
  await expect(fresh.getItem('sb-session')).resolves.toBe('bleibt');
});

test('removeItem and a missing key -> null', async () => {
  await secureSessionStorage.setItem('sb-session', 'x');
  await secureSessionStorage.removeItem('sb-session');
  await expect(secureSessionStorage.getItem('sb-session')).resolves.toBeNull();
});

test('corrupted ciphertext (key present) -> getItem returns null instead of throwing', async () => {
  await secureSessionStorage.setItem('sb-session', 'ok');
  // Manually replace the ciphertext with invalid hex garbage, the SecureStore
  // key stays intact, but the bytes can no longer be meaningfully decoded as UTF-8.
  mockAsyncStore.set('sb-session', 'zzz-kein-gueltiger-hex-string-zzz');
  await expect(secureSessionStorage.getItem('sb-session')).resolves.toBeNull();
});

test('ciphertext without a matching SecureStore key -> getItem returns null', async () => {
  await secureSessionStorage.setItem('sb-session', 'ok');
  mockSecureStore.clear();
  await expect(secureSessionStorage.getItem('sb-session')).resolves.toBeNull();
});
