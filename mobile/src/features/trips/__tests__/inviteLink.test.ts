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

import { createInviteUrl, extractInviteCode, rememberInvite, peekRememberedInvite, discardRememberedInvite } from '../inviteLink';

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

test('peekRememberedInvite liefert den Code, ohne ihn zu löschen', async () => {
  mockGetItem.mockResolvedValueOnce('abc123');
  await expect(peekRememberedInvite()).resolves.toBe('abc123');
  expect(mockRemoveItem).not.toHaveBeenCalled();
});

test('peekRememberedInvite ohne gemerkten Code liefert null', async () => {
  mockGetItem.mockResolvedValueOnce(null);
  await expect(peekRememberedInvite()).resolves.toBeNull();
});

test('peekRememberedInvite verschluckt Storage-Fehler', async () => {
  mockGetItem.mockRejectedValueOnce(new Error('kaputt'));
  await expect(peekRememberedInvite()).resolves.toBeNull();
});

test('discardRememberedInvite löscht den Code', async () => {
  await discardRememberedInvite();
  expect(mockRemoveItem).toHaveBeenCalledWith('reelive.pendingInvite');
});

test('discardRememberedInvite verschluckt Storage-Fehler', async () => {
  mockRemoveItem.mockRejectedValueOnce(new Error('kaputt'));
  await expect(discardRememberedInvite()).resolves.toBeUndefined();
});
