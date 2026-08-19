// Jest hoisting: variables in jest.mock factories MUST start with "mock".
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

test('createInviteUrl builds the link via expo-linking', () => {
  expect(createInviteUrl('abc123')).toBe('reelive://join/abc123');
});

test.each([
  ['reelive://join/abc123', 'abc123'],
  ['exp://192.168.1.5:8081/--/join/abc123', 'abc123'],
  ['exp://192.168.1.5:8081/--/join/abc123?x=1', 'abc123'],
  ['reelive://join/abc123#fragment', 'abc123'],
  ['reelive://join/', null],
  ['reelive://trip/abc123', null],
  ['', null],
])('extractInviteCode(%s) → %s', (url, expected) => {
  expect(extractInviteCode(url)).toBe(expected);
});

test('rememberInvite stores the code', async () => {
  await rememberInvite('abc123');
  expect(mockSetItem).toHaveBeenCalledWith('reelive.pendingInvite', 'abc123');
});

test('peekRememberedInvite returns the code without deleting it', async () => {
  mockGetItem.mockResolvedValueOnce('abc123');
  await expect(peekRememberedInvite()).resolves.toBe('abc123');
  expect(mockRemoveItem).not.toHaveBeenCalled();
});

test('peekRememberedInvite without a remembered code returns null', async () => {
  mockGetItem.mockResolvedValueOnce(null);
  await expect(peekRememberedInvite()).resolves.toBeNull();
});

test('peekRememberedInvite swallows storage errors', async () => {
  mockGetItem.mockRejectedValueOnce(new Error('kaputt'));
  await expect(peekRememberedInvite()).resolves.toBeNull();
});

test('discardRememberedInvite deletes the code', async () => {
  await discardRememberedInvite();
  expect(mockRemoveItem).toHaveBeenCalledWith('reelive.pendingInvite');
});

test('discardRememberedInvite swallows storage errors', async () => {
  mockRemoveItem.mockRejectedValueOnce(new Error('kaputt'));
  await expect(discardRememberedInvite()).resolves.toBeUndefined();
});
