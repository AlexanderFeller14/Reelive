// Same mock pattern as tripsCache.test.ts: Jest hoisting requires variables
// in jest.mock() factories to start with "mock".
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
}));

import { hasSeenReveal, markRevealSeen } from '../seen';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
});

test('a trip that was never marked counts as not yet seen', async () => {
  await expect(hasSeenReveal('t1')).resolves.toBe(false);
});

test('after marking, the same trip counts as seen', async () => {
  await markRevealSeen('t1');
  const [, written] = mockSetItem.mock.calls[0];
  mockGetItem.mockResolvedValueOnce(written);
  await expect(hasSeenReveal('t1')).resolves.toBe(true);
});

// Without this check, hasSeenReveal() could return `true` without ever
// asking storage, the test above wouldn't catch that
// (mockGetItem.mockResolvedValueOnce supplies a value regardless).
test('hasSeenReveal actually queries storage', async () => {
  await hasSeenReveal('t1');
  expect(mockGetItem).toHaveBeenCalledTimes(1);
});

test('the key carries the trip id and differs between two trips', async () => {
  await markRevealSeen('trip-a');
  const [keyA] = mockSetItem.mock.calls[0];
  await markRevealSeen('trip-b');
  const [keyB] = mockSetItem.mock.calls[1];

  expect(keyA).not.toBe(keyB);
  expect(keyA).toContain('trip-a');
  expect(keyB).toContain('trip-b');

  await hasSeenReveal('trip-a');
  expect(mockGetItem).toHaveBeenCalledWith(keyA);
});

// Marking a different trip must not affect hasSeenReveal for THIS trip, a
// test that only works with ONE trip could miss an implementation that
// e.g. writes only a single, global key.
test('only the marked trip counts as seen, no other', async () => {
  await markRevealSeen('trip-a');
  const [, writtenA] = mockSetItem.mock.calls[0];
  mockGetItem.mockImplementation(async (key: string) =>
    key.endsWith('trip-a') ? writtenA : null
  );

  await expect(hasSeenReveal('trip-a')).resolves.toBe(true);
  await expect(hasSeenReveal('trip-b')).resolves.toBe(false);
});

test('a write failure does not fail markRevealSeen', async () => {
  mockSetItem.mockRejectedValueOnce(new Error('Speicher voll'));
  await expect(markRevealSeen('t1')).resolves.toBeUndefined();
});

test('a read failure counts as "not yet seen", not as an exception', async () => {
  mockGetItem.mockRejectedValueOnce(new Error('Speicher kaputt'));
  await expect(hasSeenReveal('t1')).resolves.toBe(false);
});
