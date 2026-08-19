// Jest hoisting: jest.mock moves above the imports (pattern like
// recapApi.test.ts/shareApi.test.ts), access to the mocks only happens at
// call time therefore.
const mockFrom = jest.fn();
const mockInvoke = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

const ENV_BASE_URL = 'http://127.0.0.1:8081';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_TEILEN_BASIS_URL = ENV_BASE_URL;
});

// aktive_share_links: .select(…).eq('trip_id', …).order(…).limit(1).maybeSingle()
//
// Each stage its own jest.fn(), so the CALL ARGUMENTS themselves are
// checkable, not just the final result (review-finding pattern from
// recapApi.test.ts: a mock that swallows arguments would let a wrong
// column or a wrong filter through unnoticed).
//
// The chain no longer has `.eq('revoked', false)` and the caller no longer
// computes anything against the clock: what "carries" means has lived in
// the view since migration 20260810120000. The assertions about it haven't
// disappeared, they moved and now live in
// supabase/tests/18_recap_ist_geteilt_test.sql, where they run against real
// Postgres instead of against a mock that dictates the answer anyway.
function activeLinksChain(result: { data: unknown; error: unknown }) {
  const maybeSingle = jest.fn(async () => result);
  const limit = jest.fn(() => ({ maybeSingle }));
  const order = jest.fn(() => ({ limit }));
  const eqTrip = jest.fn(() => ({ order }));
  const select = jest.fn(() => ({ eq: eqTrip }));
  mockFrom.mockReturnValue({ select });
  return { select, eqTrip, order, limit, maybeSingle };
}

const httpError = (status: number, body: unknown) => ({
  data: null,
  error: Object.assign(new Error('http'), {
    name: 'FunctionsHttpError',
    context: new Response(JSON.stringify(body), { status }),
  }),
});

import { fetchActiveLink, createLink, isRecapShared, revokeLink } from '../linkManagementApi';

describe('fetchActiveLink', () => {
  test('no hit: data is null, no error', async () => {
    activeLinksChain({ data: null, error: null });
    const { data, error } = await fetchActiveLink('t1');
    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  // The chain reads the VIEW, not the table, and no longer filters on
  // `revoked` itself. That's the merge: the same rule used to live here
  // AND in `recap_ist_geteilt`, without being bound to each other.
  test('reads the view and no longer filters on revoked itself', async () => {
    const { select, eqTrip, order, limit } = activeLinksChain({ data: null, error: null });
    await fetchActiveLink('t1');
    expect(mockFrom).toHaveBeenCalledWith('aktive_share_links');
    expect(mockFrom).not.toHaveBeenCalledWith('share_links');
    expect(select).toHaveBeenCalledWith('token, expires_at');
    expect(eqTrip).toHaveBeenCalledWith('trip_id', 't1');
    // The most recent first, and exactly one: several valid links at once
    // are possible, but the sheet shows one.
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(1);
  });

  test('a hit without an expiry (expires_at null) returns an ActiveLink with a built URL', async () => {
    activeLinksChain({ data: { token: 'tok123', expires_at: null }, error: null });
    const { data, error } = await fetchActiveLink('t1');
    expect(error).toBeNull();
    expect(data).toEqual({ token: 'tok123', url: `${ENV_BASE_URL}/teilen/tok123`, expiresAt: null });
  });

  test('a hit with an expiry passes the date through for display', async () => {
    const future = new Date(Date.now() + 999_999).toISOString();
    activeLinksChain({ data: { token: 'tok1', expires_at: future }, error: null });
    const { data } = await fetchActiveLink('t1');
    expect(data).toEqual({ token: 'tok1', url: `${ENV_BASE_URL}/teilen/tok1`, expiresAt: future });
  });

  // The actual behavior change, and it's an improvement: the old version
  // compared `expires_at` against `Date.now()`, i.e. against the DEVICE
  // CLOCK. If the device was fast, it considered a carrying link expired
  // and offered to create a second one. Now the clock in Postgres decides,
  // the same one `share-link/aufloesen` measures against too.
  //
  // The mock deliberately returns a row here whose expiry, by device
  // clock, is long past: the old version would have discarded it, the new
  // one passes it through because the server issued it.
  test('the device clock no longer has a say, the server has decided', async () => {
    const longPast = new Date(Date.now() - 86_400_000).toISOString();
    activeLinksChain({ data: { token: 'vom-server', expires_at: longPast }, error: null });
    const { data } = await fetchActiveLink('t1');
    expect(data?.token).toBe('vom-server');
  });

  test('a DB error turns into a German message, no crash', async () => {
    activeLinksChain({ data: null, error: { message: 'irgendein Postgres-Fehler' } });
    const { data, error } = await fetchActiveLink('t1');
    expect(data).toBeNull();
    expect(error).toBe('Der Teilen-Link konnte nicht geladen werden. Probier es gleich nochmal.');
  });

  test('a network error is detected as offline', async () => {
    activeLinksChain({ data: null, error: { message: 'Network request failed' } });
    const { error } = await fetchActiveLink('t1');
    expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  // Missing EXPO_PUBLIC_TEILEN_BASIS_URL: a found token could otherwise
  // only be assembled into a broken/wrong URL (empty prefix), that would
  // be worse than an honest configuration error.
  test('a hit WITHOUT EXPO_PUBLIC_TEILEN_BASIS_URL set returns a configuration error instead of a broken URL', async () => {
    delete process.env.EXPO_PUBLIC_TEILEN_BASIS_URL;
    activeLinksChain({ data: { token: 'tok1', expires_at: null }, error: null });
    const { data, error } = await fetchActiveLink('t1');
    expect(data).toBeNull();
    expect(error).toBe('Die Teilen-Funktion ist nicht eingerichtet. Wende dich an die Entwicklung.');
  });
});

describe('createLink', () => {
  test('calls the function with aktion "erstellen", trip_id, and gueltig_tage', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { token: 'tok1', url: `${ENV_BASE_URL}/teilen/tok1` }, error: null });
    const { data, error } = await createLink('t1', 7);
    expect(error).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith('share-link', {
      body: { aktion: 'erstellen', trip_id: 't1', gueltig_tage: 7 },
    });
    expect(data?.token).toBe('tok1');
    expect(data?.url).toBe(`${ENV_BASE_URL}/teilen/tok1`);
    // expiresAt is computed client-side from validDays, ~7 days ahead.
    expect(data?.expiresAt).not.toBeNull();
    const inDays = (Date.parse(data!.expiresAt!) - Date.now()) / 86_400_000;
    expect(inDays).toBeGreaterThan(6.9);
    expect(inDays).toBeLessThan(7.1);
  });

  test('validDays=null (unlimited) returns expiresAt=null, without passing that to the function', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { token: 'tok1', url: 'https://x/teilen/tok1' }, error: null });
    const { data } = await createLink('t1', null);
    expect(mockInvoke).toHaveBeenCalledWith('share-link', {
      body: { aktion: 'erstellen', trip_id: 't1', gueltig_tage: null },
    });
    expect(data?.expiresAt).toBeNull();
  });

  test('a functional function error (e.g. 409 "still sealed") is passed through 1:1', async () => {
    mockInvoke.mockResolvedValueOnce(httpError(409, { fehler: 'Diese Reise ist noch versiegelt.' }));
    const { data, error } = await createLink('t1', 7);
    expect(data).toBeNull();
    expect(error).toBe('Diese Reise ist noch versiegelt.');
  });

  test('a broken 200 response (missing token/url) counts as an error, no crash', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { token: 'tok1' }, error: null });
    const { data, error } = await createLink('t1', 7);
    expect(data).toBeNull();
    expect(error).toBe('Der Link konnte nicht erstellt werden. Probier es gleich nochmal.');
  });

  test('a network error is detected as offline', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } });
    const { error } = await createLink('t1', 7);
    expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });
});

describe('revokeLink', () => {
  test('calls the function with aktion "widerrufen" and token', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const { error } = await revokeLink('tok1');
    expect(error).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith('share-link', { body: { aktion: 'widerrufen', token: 'tok1' } });
  });

  test('a functional function error (e.g. 404 "does not exist") is passed through 1:1', async () => {
    mockInvoke.mockResolvedValueOnce(httpError(404, { fehler: 'Diesen Link gibt es nicht.' }));
    const { error } = await revokeLink('tok1');
    expect(error).toBe('Diesen Link gibt es nicht.');
  });

  test('a 200 response without ok:true counts as an error', async () => {
    mockInvoke.mockResolvedValueOnce({ data: {}, error: null });
    const { error } = await revokeLink('tok1');
    expect(error).toBe('Der Link konnte nicht deaktiviert werden. Probier es gleich nochmal.');
  });
});

// ===========================================================================
// isRecapShared: the one piece of information fellow travelers get too
// ===========================================================================
//
// `fetchActiveLink` above answers the same question, but only for the
// owner: the SELECT policy on share_links is owner-only, and it stays
// that way, because whoever reads the row reads the token. This function
// therefore goes through `public.recap_ist_geteilt`, which only says yes
// or no.
describe('isRecapShared', () => {
  test('asks the database function with the trip id, not the table', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const result = await isRecapShared('t1');

    expect(result).toEqual({ data: true, error: null });
    expect(mockRpc).toHaveBeenCalledWith('recap_ist_geteilt', { p_trip_id: 't1' });
    // The whole point of the exercise: the token is never read.
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('"not shared" comes through as false', async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    expect(await isRecapShared('t1')).toEqual({ data: false, error: null });
  });

  // The one direction this answer must never be wrong in: an error is NOT
  // "not shared". If `false` came out here, the app would give an
  // all-clear on every network hiccup that it never actually checked.
  test('an error returns null, never false', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'kaputt' } });
    const result = await isRecapShared('t1');
    expect(result.data).toBeNull();
    expect(result.error).toBe('Ob der Recap geteilt ist, liess sich gerade nicht prüfen. Probier es gleich nochmal.');
  });

  test('a network error names the offline hint', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    const result = await isRecapShared('t1');
    expect(result.data).toBeNull();
    expect(result.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  // The function is `returns boolean`; anything else means something is
  // fundamentally different than assumed, and even then: better no answer
  // than a false all-clear.
  test('anything other than a boolean also counts as unknown', async () => {
    for (const value of [null, undefined, 'ja', 1, {}]) {
      mockRpc.mockResolvedValue({ data: value, error: null });
      expect((await isRecapShared('t1')).data).toBeNull();
    }
  });

  test('even a completely missing response does not flip to false', async () => {
    mockRpc.mockResolvedValue(undefined);
    expect((await isRecapShared('t1')).data).toBeNull();
  });
});
