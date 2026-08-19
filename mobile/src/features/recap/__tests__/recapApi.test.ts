// Jest hoisting: jest.mock moves above the imports, so the factory runs
// BEFORE the const assignments. Access to the mocks is therefore only
// possible at call time (same pattern as in tripsApi.test.ts/
// momentsApi.test.ts).
const mockFrom = jest.fn();
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

import { fetchRecapMoments, revealTrip } from '../recapApi';

beforeEach(() => jest.clearAllMocks());

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1', trip_id: 't1', author_id: 'u1', type: 'photo',
  duration_s: null, caption: null,
  captured_at: '2026-08-01T10:00:00.000Z', captured_tz: 'Europe/Zurich',
  place_name: null, upload_status: 'uploaded',
  profiles: { display_name: 'Lea' },
  ...overrides,
});

type QueryResult = { data: unknown; error: unknown };

// posts: .select(COLUMNS).eq('trip_id', tripId), select/eq as jest.fn() so
// the CALL ARGUMENTS themselves are checkable, not just the final result
// (review finding: a mock that ignores arguments would let "profiles(display_
// name) removed from COLUMNS" or "eq() on the wrong column" slip through
// unnoticed, same pattern as tripChain in tripsApi.test.ts).
const postsChain = (result: QueryResult) => {
  const eq = jest.fn(async () => result);
  // Parameter explicitly typed (even though unused): otherwise jest.fn()
  // infers a zero-argument function from the implementation, and
  // select.mock.calls[0][0] would be a tuple access out of bounds.
  const select = jest.fn((_columns: string) => ({ eq }));
  mockFrom.mockReturnValue({ select });
  return { select, eq };
};

describe('fetchRecapMoments', () => {
  test('reads moments including the author name in one call', async () => {
    const { select, eq } = postsChain({ data: [row()], error: null });
    const { data, error } = await fetchRecapMoments('t1');
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        id: 'p1', trip_id: 't1', author_id: 'u1', type: 'photo',
        duration_s: null, caption: null,
        captured_at: '2026-08-01T10:00:00.000Z', captured_tz: 'Europe/Zurich',
        place_name: null, upload_status: 'uploaded', authorName: 'Lea',
        authorAvatarKey: null,
      },
    ]);
    expect(mockFrom).toHaveBeenCalledWith('posts');
    // No N+1: the author name must be PART of the same select() column
    // list, not a second call against profiles.
    expect(select).toHaveBeenCalledTimes(1);
    // The foreign key name MUST be present: there are two paths between
    // posts and profiles (author_id directly, and many-to-many via
    // reactions). Without it, PostgREST answers with HTTP 300 and the
    // recap stays empty, which no mocked test notices, because the mock
    // never actually issues the query.
    expect(select.mock.calls[0][0]).toEqual(
      expect.stringContaining('profiles!posts_author_id_fkey(display_name, avatar_key)')
    );
    expect(eq).toHaveBeenCalledWith('trip_id', 't1');
  });

  test('also queries lat and lng', async () => {
    const { select } = postsChain({ data: [], error: null });
    await fetchRecapMoments('t1');
    const columns = select.mock.calls[0][0] as string;
    expect(columns).toContain('lat');
    expect(columns).toContain('lng');
    expect(columns).toContain('profiles!posts_author_id_fkey(display_name, avatar_key)');
  });

  test('a moment carries its author\'s avatar key', async () => {
    postsChain({
      data: [row({ profiles: { display_name: 'Lea', avatar_key: 'profiles/u1/a.jpg' } })],
      error: null,
    });
    const { data } = await fetchRecapMoments('t1');
    expect(data[0].authorAvatarKey).toBe('profiles/u1/a.jpg');
  });

  // display_name falls back to '' when the profile is missing; the avatar
  // key must take the same path and become null, not undefined.
  test('without a profile, the avatar key stays null', async () => {
    postsChain({ data: [row({ profiles: null })], error: null });
    const { data } = await fetchRecapMoments('t1');
    expect(data[0].authorAvatarKey).toBeNull();
  });

  test('passes lat/lng through', async () => {
    postsChain({
      data: [row({ place_name: 'Alfama', lat: 38.7139, lng: -9.1301 })],
      error: null,
    });
    const { data } = await fetchRecapMoments('t1');
    expect(data[0].lat).toBe(38.7139);
    expect(data[0].lng).toBe(-9.1301);
  });

  test('sorts the result via days.sortMoments, not just the DB order', async () => {
    postsChain({
      data: [
        row({ id: 'late', captured_at: '2026-08-01T15:00:00.000Z' }),
        row({ id: 'early', captured_at: '2026-08-01T09:00:00.000Z' }),
      ],
      error: null,
    });
    const { data } = await fetchRecapMoments('t1');
    expect(data.map((m) => m.id)).toEqual(['early', 'late']);
  });

  test('a moment without a profiles match gets an empty author name instead of throwing', async () => {
    postsChain({ data: [row({ profiles: null })], error: null });
    const { data } = await fetchRecapMoments('t1');
    expect(data[0].authorName).toBe('');
  });

  test('reports a load error instead of an unexplained empty list', async () => {
    postsChain({ data: null, error: { message: 'kaputt' } });
    const { data, error } = await fetchRecapMoments('t1');
    expect(data).toEqual([]);
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });

  test('names the offline case instead of just "try again"', async () => {
    postsChain({ data: null, error: { message: 'Network request failed' } });
    const { error } = await fetchRecapMoments('t1');
    expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  // Not an error case: posts_select_revealed_members lets nobody read
  // before the reveal, RLS filters but doesn't throw.
  test('a trip not (yet) revealed returns an empty list without an error', async () => {
    postsChain({ data: [], error: null });
    const { data, error } = await fetchRecapMoments('t1');
    expect(data).toEqual([]);
    expect(error).toBeNull();
  });
});

describe('revealTrip', () => {
  const httpError = (status: number, body: unknown) => ({
    data: null,
    error: Object.assign(new Error('http'), {
      name: 'FunctionsHttpError',
      context: new Response(JSON.stringify(body), { status }),
    }),
  });

  test('success: returns revealed_at, calls the function with trip_id', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: true, revealed_at: '2026-08-08T12:00:00Z' }, error: null });
    await expect(revealTrip('t1')).resolves.toEqual({ revealed_at: '2026-08-08T12:00:00Z', error: null });
    expect(mockInvoke).toHaveBeenCalledWith('reveal-trip', { body: { trip_id: 't1' } });
  });

  // A retry after a failure ACTUALLY calls the function a second time,
  // rather than being answered from a cache, unlike a mere second success
  // call (which any memoisation would have let pass unnoticed).
  test('a retry after a failure calls the function again, instead of locking', async () => {
    mockInvoke
      .mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } })
      .mockResolvedValueOnce({ data: { ok: true, revealed_at: '2026-08-08T12:00:00Z' }, error: null });

    const first = await revealTrip('t1');
    expect(first.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');

    const second = await revealTrip('t1');
    expect(second).toEqual({ revealed_at: '2026-08-08T12:00:00Z', error: null });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  test('an HTTP error from the function is reported with its German plain text', async () => {
    mockInvoke.mockResolvedValueOnce(httpError(403, { fehler: 'Nur wer die Reise angelegt hat, kann sie abschliessen.' }));
    const { revealed_at, error } = await revealTrip('t1');
    expect(revealed_at).toBeNull();
    expect(error).toBe('Nur wer die Reise angelegt hat, kann sie abschliessen.');
  });

  test('an HTTP error without a usable body gets a generic German message', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('http'), {
        name: 'FunctionsHttpError',
        context: new Response('kein json', { status: 500 }),
      }),
    });
    const { error } = await revealTrip('t1');
    expect(error).toBe('Die Reise konnte nicht abgeschlossen werden. Probier es gleich nochmal.');
  });

  test('a network error names offline as the cause', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: {
        name: 'FunctionsFetchError',
        message: 'Failed to send a request to the Edge Function',
        context: { message: 'Network request failed' },
      },
    });
    const { error } = await revealTrip('t1');
    expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('a response without ok:true is treated as a failure', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { revealed_at: null }, error: null });
    const { error } = await revealTrip('t1');
    expect(error).toBe('Die Reise konnte nicht abgeschlossen werden. Probier es gleich nochmal.');
  });
});
