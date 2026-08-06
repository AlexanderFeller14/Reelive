// Jest-Hoisting: Variablen in jest.mock-Factories MÜSSEN mit "mock" beginnen
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

test('Roundtrip: setItem → getItem liefert den Wert', async () => {
  await secureSessionStorage.setItem('sb-session', '{"access_token":"abc"}');
  await expect(secureSessionStorage.getItem('sb-session')).resolves.toBe('{"access_token":"abc"}');
});

test('Payload liegt NICHT im Klartext in AsyncStorage', async () => {
  await secureSessionStorage.setItem('sb-session', 'geheimer-inhalt');
  expect([...mockAsyncStore.values()].join()).not.toContain('geheimer-inhalt');
});

test('Neustart-Simulation: Wert übersteht Modul-Reset', async () => {
  await secureSessionStorage.setItem('sb-session', 'bleibt');
  jest.resetModules();
  const fresh = require('../secureSessionStorage').secureSessionStorage;
  await expect(fresh.getItem('sb-session')).resolves.toBe('bleibt');
});

test('removeItem und fehlender Key → null', async () => {
  await secureSessionStorage.setItem('sb-session', 'x');
  await secureSessionStorage.removeItem('sb-session');
  await expect(secureSessionStorage.getItem('sb-session')).resolves.toBeNull();
});

test('Beschädigter Ciphertext (Key vorhanden) → getItem liefert null statt zu werfen', async () => {
  await secureSessionStorage.setItem('sb-session', 'ok');
  // Ciphertext manuell durch ungültigen Hex-Müll ersetzen — der SecureStore-Key
  // bleibt bestehen, aber die Bytes lassen sich nicht mehr sinnvoll als UTF-8 dekodieren.
  mockAsyncStore.set('sb-session', 'zzz-kein-gueltiger-hex-string-zzz');
  await expect(secureSessionStorage.getItem('sb-session')).resolves.toBeNull();
});

test('Ciphertext ohne passenden SecureStore-Key → getItem liefert null', async () => {
  await secureSessionStorage.setItem('sb-session', 'ok');
  mockSecureStore.clear();
  await expect(secureSessionStorage.getItem('sb-session')).resolves.toBeNull();
});
