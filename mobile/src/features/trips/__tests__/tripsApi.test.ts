// Jest hoisting: jest.mock moves above the imports, the factory therefore
// runs BEFORE the const assignments. The mocks must therefore not be direct
// values in the object literal (they would be undefined forever there),
// access has to happen only at call time. Same principle as in
// mobile/src/lib/__tests__/secureSessionStorage.test.ts.
const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import {
  fetchTrips, fetchTrip, fetchMembers, fetchInviteCode,
  createTrip, updateTrip, deleteTrip, removeMember,
  redeemInvite, peekInvite, fetchOwnPostCounts,
} from '../tripsApi';
import { OFFLINE_HINT } from '@/lib/networkError';

beforeEach(() => jest.clearAllMocks());

// Write chains have ended on .select(...) ever since the row-proof: PostgREST
// does not report a write rejected by a policy as an error, only as an empty
// result.
type Result = { data: unknown; error: unknown };

// trips: .update(...)/.delete().eq('id', …).select('id')
const tripChain = (verb: 'update' | 'delete', result: Result) => {
  const select = jest.fn(async () => result);
  const eq = jest.fn(() => ({ select }));
  mockFrom.mockReturnValue({ [verb]: () => ({ eq }) });
  return { eq, select };
};

// trip_members: .delete().eq('trip_id', …).eq('user_id', …).select('user_id')
const memberChain = (result: Result) => {
  const select = jest.fn(async () => result);
  const eqUser = jest.fn(() => ({ select }));
  const eqTrip = jest.fn(() => ({ eq: eqUser }));
  mockFrom.mockReturnValue({ delete: () => ({ eq: eqTrip }) });
  return { eqTrip, eqUser, select };
};

test('fetchTrips merges members and the own counter', async () => {
  mockFrom.mockReturnValue({
    select: () => ({
      order: async () => ({
        data: [
          {
            id: 't1', name: 'Norwegen', start_date: '2026-08-01', end_date: '2026-08-14',
            status: 'active', owner_id: 'u1',
            // avatar_key is explicitly null here rather than missing: the
            // field is a real column, PostgREST always includes it (as null
            // even without an image), never as a missing key. A missing key
            // in the mock would turn `p.avatar_key` into `undefined` instead
            // of `null`, and the `toEqual` below tells `undefined` and
            // `null` apart.
            trip_members: [
              { profiles: { display_name: 'Lea', avatar_key: null } },
              { profiles: { display_name: 'Jonas', avatar_key: null } },
            ],
          },
        ],
        error: null,
      }),
    }),
  });
  mockRpc.mockResolvedValueOnce({ data: [{ trip_id: 't1', count: 7 }], error: null });

  const { data, error } = await fetchTrips();
  expect(error).toBeNull();
  expect(data).toEqual([
    {
      id: 't1', name: 'Norwegen', start_date: '2026-08-01', end_date: '2026-08-14',
      status: 'active', owner_id: 'u1',
      members: [
        { name: 'Lea', avatarKey: null },
        { name: 'Jonas', avatarKey: null },
      ],
      member_count: 2, my_post_count: 7,
    },
  ]);
});

// Name and key belong together. Two separate lists (names here, keys there)
// would drift apart at the first person without a profile, and then a face
// would carry someone else's image. Lea carries a key here, Ben does not:
// both cases sit in the same assertion.
test('the trip card gets faces along with their avatar key', async () => {
  mockFrom.mockReturnValue({
    select: () => ({
      order: async () => ({
        data: [
          {
            id: 't1', name: 'Norwegen', start_date: '2026-08-01', end_date: '2026-08-14',
            status: 'active', owner_id: 'u1',
            trip_members: [
              { profiles: { display_name: 'Lea', avatar_key: 'profiles/u1/a.jpg' } },
              { profiles: { display_name: 'Ben', avatar_key: null } },
            ],
          },
        ],
        error: null,
      }),
    }),
  });
  mockRpc.mockResolvedValueOnce({ data: [], error: null });

  const { data } = await fetchTrips();
  expect(data[0].members).toEqual([
    { name: 'Lea', avatarKey: 'profiles/u1/a.jpg' },
    { name: 'Ben', avatarKey: null },
  ]);
});

test('fetchTrips sets the counter to 0 when the trip is not in my_post_counts', async () => {
  mockFrom.mockReturnValue({
    select: () => ({
      order: async () => ({
        data: [{
          id: 't2', name: 'Neu', start_date: '2026-09-01', end_date: '2026-09-05',
          status: 'active', owner_id: 'u1', trip_members: [{ profiles: { display_name: 'Lea' } }],
        }],
        error: null,
      }),
    }),
  });
  mockRpc.mockResolvedValueOnce({ data: [], error: null });

  const { data } = await fetchTrips();
  expect(data[0].my_post_count).toBe(0);
});

test('fetchTrips tells a load error apart from an empty list', async () => {
  mockFrom.mockReturnValue({
    select: () => ({ order: async () => ({ data: null, error: { message: 'kaputt' } }) }),
  });
  const { data, error } = await fetchTrips();
  expect(data).toEqual([]);
  // Without this message, the list claims "no trip yet", a false statement
  // about the user's data.
  expect(error).toBe('Deine Reisen konnten nicht geladen werden. Probier es gleich nochmal.');
});

test('fetchTrips names the offline case instead of just "try again"', async () => {
  mockFrom.mockReturnValue({
    select: () => ({
      order: async () => ({ data: null, error: { message: 'TypeError: Network request failed' } }),
    }),
  });
  const { error } = await fetchTrips();
  expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
});

// Re-review, Minor 2: the two queries in fetchTrips can fail independently.
// If the trips succeed and only the counts rpc fails, every trip carries
// `my_post_count: 0`, the caller must be able to tell whether this 0 was
// measured or merely failed to load.
test('fetchTrips reports a failed counter separately from the trip error', async () => {
  mockFrom.mockReturnValue({
    select: () => ({
      order: async () => ({
        data: [
          {
            id: 't1', name: 'Norwegen', start_date: '2026-08-01', end_date: '2026-08-14',
            status: 'active', owner_id: 'u1', trip_members: [],
          },
        ],
        error: null,
      }),
    }),
  });
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } });

  const { data, error, countsError } = await fetchTrips();
  expect(error).toBeNull();
  expect(data[0].my_post_count).toBe(0);
  expect(countsError).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
});

test('fetchTrips reports no counter error when the rpc succeeds', async () => {
  mockFrom.mockReturnValue({
    select: () => ({ order: async () => ({ data: [], error: null }) }),
  });
  mockRpc.mockResolvedValueOnce({ data: [], error: null });
  await expect(fetchTrips()).resolves.toEqual({ data: [], error: null, countsError: null });
});

// Fix round 1 (Task 9): fetchOwnPostCounts() had no test of its own so far,
// only tsc checked the Object.fromEntries(...) conversion. The moments
// counter (counter.ts) needs bracket access (counts[tripId]), hence the
// mapping trip id -> number as a plain object rather than a Map.
test('fetchOwnPostCounts returns the rpc mapping as a plain object (bracket-readable)', async () => {
  mockRpc.mockResolvedValueOnce({
    data: [
      { trip_id: 't1', count: 7 },
      { trip_id: 't2', count: 0 },
    ],
    error: null,
  });
  await expect(fetchOwnPostCounts()).resolves.toEqual({ data: { t1: 7, t2: 0 }, error: null });
  expect(mockRpc).toHaveBeenCalledWith('my_post_counts');
});

// Final review, Important 6: the error MUST come along. Previously
// fetchOwnPostCounts returned an empty object on failure, indistinguishable
// from "you really have no moments yet", the moments counter then calculated
// offline with 0 instead of the last known state (see counter.ts).
test('fetchOwnPostCounts reports an rpc failure instead of emitting it as an empty state', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'kaputt' } });
  const { data, error } = await fetchOwnPostCounts();
  expect(data).toEqual({});
  expect(error).toBe('Dein Momente-Zähler konnte nicht geladen werden. Probier es gleich nochmal.');
});

test('fetchOwnPostCounts names offline as the cause', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } });
  const { error } = await fetchOwnPostCounts();
  expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
});

test('fetchTrip tells "does not exist" apart from "could not be loaded"', async () => {
  mockFrom.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
  });
  await expect(fetchTrip('t1')).resolves.toEqual({ data: null, error: null });

  mockFrom.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'kaputt' } }) }) }),
  });
  const { error } = await fetchTrip('t1');
  expect(error).toBe('Diese Reise konnte nicht geladen werden. Probier es gleich nochmal.');
});

test('fetchMembers reports a read error instead of an empty list', async () => {
  mockFrom.mockReturnValue({
    select: () => ({ eq: () => ({ order: async () => ({ data: null, error: { message: 'kaputt' } }) }) }),
  });
  const { data, error } = await fetchMembers('t1');
  expect(data).toEqual([]);
  expect(error).toBe('Die Mitglieder konnten nicht geladen werden. Probier es gleich nochmal.');
});

test('fetchMembers includes the avatar key', async () => {
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        order: async () => ({
          data: [
            {
              user_id: 'u1', role: 'owner',
              profiles: { username: 'lea', display_name: 'Lea', avatar_key: 'profiles/u1/a.jpg' },
            },
          ],
          error: null,
        }),
      }),
    }),
  });
  const { data } = await fetchMembers('t1');
  expect(data[0].avatar_key).toBe('profiles/u1/a.jpg');
});

test('fetchInviteCode reports a read error and otherwise returns the code', async () => {
  mockFrom.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { invite_code: 'abc' }, error: null }) }) }),
  });
  await expect(fetchInviteCode('t1')).resolves.toEqual({ data: 'abc', error: null });

  mockFrom.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'kaputt' } }) }) }),
  });
  const { error } = await fetchInviteCode('t1');
  expect(error).toBe('Der Einladungslink konnte nicht geladen werden. Probier es gleich nochmal.');
});

test('createTrip returns the new id', async () => {
  mockFrom.mockReturnValue({
    insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'neu-1' }, error: null }) }) }),
  });
  const { id, error } = await createTrip({
    name: 'Sardinien', startDate: '2026-09-06', endDate: '2026-09-20', ownerId: 'u1',
  });
  expect(id).toBe('neu-1');
  expect(error).toBeNull();
});

test('createTrip reports an error in German', async () => {
  mockFrom.mockReturnValue({
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'x' } }) }) }),
  });
  const { id, error } = await createTrip({
    name: 'X', startDate: '2026-09-06', endDate: '2026-09-20', ownerId: 'u1',
  });
  expect(id).toBeNull();
  expect(error).toBe('Die Reise konnte nicht angelegt werden. Probier es gleich nochmal.');
});

test('peekInvite returns the preview', async () => {
  mockRpc.mockResolvedValueOnce({
    data: [{
      trip_id: 't1', name: 'Norwegen', start_date: '2026-08-01', end_date: '2026-08-14',
      status: 'active', member_count: 4, owner_display_name: 'Lea',
    }],
    error: null,
  });
  const { data, error } = await peekInvite('abc');
  expect(data?.owner_display_name).toBe('Lea');
  expect(error).toBeNull();
  expect(mockRpc).toHaveBeenCalledWith('peek_invite', { p_code: 'abc' });
});

test('peekInvite: an unknown code is not an error, just no data', async () => {
  mockRpc.mockResolvedValueOnce({ data: [], error: null });
  await expect(peekInvite('weg')).resolves.toEqual({ data: null, error: null });
});

// The distinction this is about: "does not exist" and "could not check"
// must never trigger the same sentence in the join screen.
test('peekInvite reports a read error as an error, not as a missing trip', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
  const { data, error } = await peekInvite('abc');
  expect(data).toBeNull();
  expect(error).toBe('Die Einladung konnte nicht geladen werden. Probier es gleich nochmal.');
});

test('peekInvite names the cause in a dead zone', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } });
  const { error } = await peekInvite('abc');
  expect(error).toBe(OFFLINE_HINT);
});

test('redeemInvite passes the status through', async () => {
  mockRpc.mockResolvedValueOnce({ data: [{ status: 'joined', trip_id: 't1' }], error: null });
  await expect(redeemInvite('abc')).resolves.toEqual({ status: 'joined', trip_id: 't1' });
});

test('redeemInvite treats a network error as not_found', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
  await expect(redeemInvite('abc')).resolves.toEqual({ status: 'not_found', trip_id: null });
});

// === Contract "0 affected rows = failure" ===
// If an RLS policy rejects the write, Postgres returns no error, just
// UPDATE 0 / DELETE 0. Without this contract, the functions reported success
// and the detail screen navigated away as if the trip had been deleted.

test('updateTrip reports success when one row was affected', async () => {
  const { eq, select } = tripChain('update', { data: [{ id: 't1' }], error: null });
  await expect(
    updateTrip('t1', { name: 'Norwegen', startDate: '2026-08-01', endDate: '2026-08-14' })
  ).resolves.toEqual({ error: null });
  expect(eq).toHaveBeenCalledWith('id', 't1');
  expect(select).toHaveBeenCalledWith('id');
});

test('updateTrip treats zero affected rows as a failure', async () => {
  tripChain('update', { data: [], error: null });
  const { error } = await updateTrip('t1', {
    name: 'Norwegen', startDate: '2026-08-01', endDate: '2026-08-14',
  });
  expect(error).toBe('Die Änderung wurde nicht gespeichert. Die Reise gibt es nicht mehr, oder sie gehört dir nicht.');
});

test('updateTrip names the offline case', async () => {
  tripChain('update', { data: null, error: { message: 'TypeError: Network request failed' } });
  const { error } = await updateTrip('t1', {
    name: 'Norwegen', startDate: '2026-08-01', endDate: '2026-08-14',
  });
  expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
});

test('deleteTrip reports success when one row was affected', async () => {
  const { eq, select } = tripChain('delete', { data: [{ id: 't1' }], error: null });
  await expect(deleteTrip('t1')).resolves.toEqual({ error: null });
  expect(eq).toHaveBeenCalledWith('id', 't1');
  expect(select).toHaveBeenCalledWith('id');
});

test('deleteTrip treats zero affected rows as a failure', async () => {
  tripChain('delete', { data: [], error: null });
  const { error } = await deleteTrip('t1');
  expect(error).toBe('Die Reise wurde nicht gelöscht. Es gibt sie nicht mehr, oder sie gehört dir nicht.');
});

test('removeMember deletes exactly one membership', async () => {
  const { eqTrip, eqUser, select } = memberChain({ data: [{ user_id: 'u2' }], error: null });

  const { error } = await removeMember('t1', 'u2');
  expect(error).toBeNull();
  expect(eqTrip).toHaveBeenCalledWith('trip_id', 't1');
  expect(eqUser).toHaveBeenCalledWith('user_id', 'u2');
  expect(select).toHaveBeenCalledWith('user_id');
});

test('removeMember treats zero affected rows as a failure', async () => {
  memberChain({ data: [], error: null });
  const { error } = await removeMember('t1', 'u2');
  expect(error).toBe('Das hat nicht geklappt. Die Mitgliedschaft gibt es nicht mehr, oder du darfst sie nicht beenden.');
});
