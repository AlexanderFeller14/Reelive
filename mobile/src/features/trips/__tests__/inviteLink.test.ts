// Jest-Hoisting: Variablen in jest.mock-Factories MÜSSEN mit "mock" beginnen
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
const mockRemoveItem = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
  removeItem: (key: string) => mockRemoveItem(key),
}));
jest.mock('expo-linking', () => ({
  createURL: (path: string) => `reelive://${path.replace(/^\//, '')}`,
}));

import { createInviteUrl, extractInviteCode, rememberInvite, takeRememberedInvite } from '../inviteLink';

beforeEach(() => jest.clearAllMocks());

test('createInviteUrl baut den Link über expo-linking', () => {
  expect(createInviteUrl('abc123')).toBe('reelive://join/abc123');
});

test.each([
  ['reelive://join/abc123', 'abc123'],
  ['exp://192.168.1.5:8081/--/join/abc123', 'abc123'],
  ['exp://192.168.1.5:8081/--/join/abc123?x=1', 'abc123'],
  ['reelive://join/', null],
  ['reelive://reise/abc123', null],
  ['', null],
])('extractInviteCode(%s) → %s', (url, expected) => {
  expect(extractInviteCode(url)).toBe(expected);
});

test('rememberInvite legt den Code ab', async () => {
  await rememberInvite('abc123');
  expect(mockSetItem).toHaveBeenCalledWith('reelive.pendingInvite', 'abc123');
});

test('takeRememberedInvite liefert den Code und löscht ihn', async () => {
  mockGetItem.mockResolvedValueOnce('abc123');
  await expect(takeRememberedInvite()).resolves.toBe('abc123');
  expect(mockRemoveItem).toHaveBeenCalledWith('reelive.pendingInvite');
});

test('takeRememberedInvite ohne gemerkten Code liefert null und löscht nichts', async () => {
  mockGetItem.mockResolvedValueOnce(null);
  await expect(takeRememberedInvite()).resolves.toBeNull();
  expect(mockRemoveItem).not.toHaveBeenCalled();
});

test('takeRememberedInvite verschluckt Storage-Fehler', async () => {
  mockGetItem.mockRejectedValueOnce(new Error('kaputt'));
  await expect(takeRememberedInvite()).resolves.toBeNull();
});
