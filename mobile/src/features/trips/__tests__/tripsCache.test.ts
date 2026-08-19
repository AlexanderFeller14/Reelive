// The local fallback behind the offline promise (final review, Critical 1
// and Important 6). Jest hoisting: variables in jest.mock factories MUST
// start with "mock" (same pattern as inviteLink.test.ts).
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
}));

import {
  rememberedTrips,
  rememberedCounts,
  rememberTrips,
  rememberCounts,
  type CachedTrip,
} from '../tripsCache';

const trip = (over: Partial<CachedTrip> = {}): CachedTrip => ({
  id: 't1',
  name: 'Norwegen mit dem Camper',
  start_date: '2026-08-01',
  end_date: '2026-08-14',
  status: 'active',
  my_post_count: 4,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
});

test('remembered trips come back unchanged', async () => {
  await rememberTrips('u1', [trip()]);
  const [, raw] = mockSetItem.mock.calls[0];
  mockGetItem.mockResolvedValueOnce(raw);
  await expect(rememberedTrips('u1')).resolves.toEqual([trip()]);
});

// On a shared device, B must never see A's trips offline, hence the key
// carries the user id.
test('the store is kept separate per person', async () => {
  await rememberTrips('person-a', [trip({ name: 'Nur für A' })]);
  const [keyA] = mockSetItem.mock.calls[0];

  await rememberTrips('person-b', [trip({ name: 'Nur für B' })]);
  const [keyB] = mockSetItem.mock.calls[1];

  expect(keyA).not.toBe(keyB);
});

test('without a user id, neither reading nor writing happens', async () => {
  await rememberTrips(null, [trip()]);
  expect(mockSetItem).not.toHaveBeenCalled();
  await expect(rememberedTrips(null)).resolves.toBeNull();
  expect(mockGetItem).not.toHaveBeenCalled();
});

// The decisive difference for the camera screen: only `null` ("never
// successfully loaded") justifies the error page. An empty store is a
// statement and leads to "no ongoing trip".
test('nothing held returns null, an empty store returns an empty array', async () => {
  mockGetItem.mockResolvedValueOnce(null);
  await expect(rememberedTrips('u1')).resolves.toBeNull();

  mockGetItem.mockResolvedValueOnce('[]');
  await expect(rememberedTrips('u1')).resolves.toEqual([]);
});

test('damaged entries are discarded instead of emitted as a half trip', async () => {
  mockGetItem.mockResolvedValueOnce(JSON.stringify([trip(), { id: 't2' }, null, 'kaputt']));
  await expect(rememberedTrips('u1')).resolves.toEqual([trip()]);

  mockGetItem.mockResolvedValueOnce('{kein json');
  await expect(rememberedTrips('u1')).resolves.toBeNull();
});

test('a storage error does not fail the caller', async () => {
  mockSetItem.mockRejectedValueOnce(new Error('voll'));
  await expect(rememberTrips('u1', [trip()])).resolves.toBeUndefined();

  mockGetItem.mockRejectedValueOnce(new Error('kaputt'));
  await expect(rememberedTrips('u1')).resolves.toBeNull();
});

test('counts come back as a mapping, unusable ones fly out', async () => {
  await rememberCounts('u1', { t1: 40, t2: 3 });
  const [, raw] = mockSetItem.mock.calls[0];
  mockGetItem.mockResolvedValueOnce(raw);
  await expect(rememberedCounts('u1')).resolves.toEqual({ t1: 40, t2: 3 });

  mockGetItem.mockResolvedValueOnce(JSON.stringify({ t1: 40, t2: 'viele', t3: null }));
  await expect(rememberedCounts('u1')).resolves.toEqual({ t1: 40 });
});

test('without remembered counts, an empty object comes back instead of an error', async () => {
  mockGetItem.mockResolvedValueOnce(null);
  await expect(rememberedCounts('u1')).resolves.toEqual({});

  mockGetItem.mockResolvedValueOnce('[1,2,3]');
  await expect(rememberedCounts('u1')).resolves.toEqual({});
});
