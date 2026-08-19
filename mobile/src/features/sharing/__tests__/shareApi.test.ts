// Jest hoisting: jest.mock moves above the imports, the factory runs
// BEFORE the const assignments, access to the mocks only happens at call
// time therefore (pattern like recapApi.test.ts/urlPool.test.ts).
//
// W4, the core of this file: NOT only `functions.invoke` is mocked, the
// WHOLE client is, `from`, `rpc`, `auth` are their own spies. A test that
// only watches `functions.invoke` couldn't notice a secretly added
// `.from(...)` call at all (exactly the phase-5 warning: a mock that
// replaces the mechanism under test itself, tests nothing). Here the REAL
// resolveToken implementation stays untouched, only the IO boundary (the
// client) is a double.
const mockInvoke = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockAuthSignInWithOtp = jest.fn();
const mockAuthSignOut = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: {
      signInWithOtp: (...args: unknown[]) => mockAuthSignInWithOtp(...args),
      signOut: (...args: unknown[]) => mockAuthSignOut(...args),
    },
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

import { resolveToken, DEAD_LINK_TEXT } from '../shareApi';

beforeEach(() => jest.clearAllMocks());

const httpError = (status: number, body: unknown) => ({
  data: null,
  error: Object.assign(new Error('http'), {
    name: 'FunctionsHttpError',
    context: new Response(JSON.stringify(body), { status }),
  }),
});

// Wire-shaped fixture (MediaEntry/ResolveResponse, Task-13 contract):
// field names match the edge function's actual response byte for byte,
// including `autor_name`/`autor_avatar_key`/`gueltig_bis`.
const validResponse = {
  reise: { name: 'Lissabon Städtetrip', start_date: '2026-08-10', end_date: '2026-08-14' },
  medien: [
    {
      post_id: 'p1', autor_name: 'Lea', autor_avatar_key: 'profiles/u1/a.jpg', type: 'photo',
      captured_at: '2026-08-10T09:00:00.000Z',
      captured_tz: 'Europe/Zurich', place_name: 'Lissabon', caption: 'Schön hier',
      duration_s: null, lat: 38.7139, lng: -9.1301,
      medium_url: 'https://s3/p1', thumb_url: 'https://s3/p1-thumb',
    },
    {
      post_id: 'p2', autor_name: 'Jonas', autor_avatar_key: null, type: 'video',
      captured_at: '2026-08-10T10:00:00.000Z',
      captured_tz: 'Europe/Zurich', place_name: null, caption: null,
      duration_s: 8, lat: null, lng: null,
      medium_url: 'https://s3/p2', // no thumbnail: field missing entirely
    },
  ],
  gueltig_bis: '2026-08-08T13:00:00.000Z',
  ausgelassen: 2,
};

describe('resolveToken: success', () => {
  test('calls the function with aktion "aufloesen" and the token, builds a SharedRecap', async () => {
    mockInvoke.mockResolvedValueOnce({ data: validResponse, error: null });

    const { data, error } = await resolveToken('tok123');

    expect(error).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith('share-link', { body: { aktion: 'aufloesen', token: 'tok123' } });
    expect(data?.reise).toEqual({ name: 'Lissabon Städtetrip', start_date: '2026-08-10', end_date: '2026-08-14' });
    expect(data?.validUntil).toBe(Date.parse('2026-08-08T13:00:00.000Z'));
    expect(data?.medien).toHaveLength(2);
    expect(data?.medien[0]).toEqual({
      post_id: 'p1', authorName: 'Lea', authorAvatarKey: 'profiles/u1/a.jpg', type: 'photo',
      captured_at: '2026-08-10T09:00:00.000Z',
      captured_tz: 'Europe/Zurich', place_name: 'Lissabon', caption: 'Schön hier',
      duration_s: null, lat: 38.7139, lng: -9.1301,
      medium_url: 'https://s3/p1', thumb_url: 'https://s3/p1-thumb',
    });
  });

  // Task 10: the image KEY passes through unchanged, share-link never
  // hands out a finished URL (see aufloesung.ts). avatarUrl() stays the
  // only place in the system that knows the URL format, even for the
  // shared recap.
  test('authorAvatarKey passes through unchanged, including as null', async () => {
    mockInvoke.mockResolvedValueOnce({ data: validResponse, error: null });
    const { data } = await resolveToken('tok123');
    expect(data?.medien[0].authorAvatarKey).toBe('profiles/u1/a.jpg');
    expect(data?.medien[1].authorAvatarKey).toBeNull();
  });

  // Counter-check to the shape check, same pattern as with lat/lng: an
  // older function without the field (app and function are rolled out
  // separately) must not pass a broken value through. Avatar() reads
  // avatarKey only as a string or null (features/auth/avatar.ts), anything
  // else would build a URL onto a value that isn't a key at all.
  test.each([
    ['missing field', {}],
    ['a number instead of a string', { autor_avatar_key: 42 }],
  ])('an autor_avatar_key that is not a string (%s) becomes null', async (_name, broken) => {
    mockInvoke.mockResolvedValueOnce({
      data: {
        ...validResponse,
        medien: [{ ...validResponse.medien[0], autor_avatar_key: undefined, ...broken }],
      },
      error: null,
    });
    const { data } = await resolveToken('tok123');
    expect(data?.medien[0].authorAvatarKey).toBeNull();
  });

  // The coordinates have been part of the response since phase 7 (spec
  // R4/K13) and the basis of the map in the shared recap. `null` is the
  // normal case and not an error, a moment without granted location
  // services simply has no place.
  test('lat/lng pass through unchanged, including as null', async () => {
    mockInvoke.mockResolvedValueOnce({ data: validResponse, error: null });
    const { data } = await resolveToken('tok123');
    expect(data?.medien[0].lat).toBe(38.7139);
    expect(data?.medien[0].lng).toBe(-9.1301);
    expect(data?.medien[1].lat).toBeNull();
    expect(data?.medien[1].lng).toBeNull();
  });

  // And the counter-check to the shape check: an older function without
  // the two fields must not place a pin on a position that doesn't exist.
  // Downstream, `zuKartenPunkten` checks only for `=== null`, anything
  // else would count as a valid coordinate there.
  test.each([
    ['missing fields', {}],
    ['NaN', { lat: NaN, lng: NaN }],
    ['text instead of a number', { lat: '38.7', lng: '-9.1' }],
  ])('a coordinate that cannot be computed with (%s) becomes null', async (_name, broken) => {
    mockInvoke.mockResolvedValueOnce({
      data: {
        ...validResponse,
        medien: [{ ...validResponse.medien[0], lat: undefined, lng: undefined, ...broken }],
      },
      error: null,
    });
    const { data } = await resolveToken('tok123');
    expect(data?.medien[0].lat).toBeNull();
    expect(data?.medien[0].lng).toBeNull();
  });

  // Missing thumb_url becomes null, not undefined, on SharedMoment.
  // thumb_url is string | null, not an optional field (a mutant that
  // writes ?? undefined instead of ?? null falls through here: toEqual
  // distinguishes a missing property from a null one).
  test('a moment without thumb_url gets null, not undefined, and the field remains its own property', async () => {
    mockInvoke.mockResolvedValueOnce({ data: validResponse, error: null });
    const { data } = await resolveToken('tok123');
    expect(data?.medien[1].thumb_url).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(data!.medien[1], 'thumb_url')).toBe(true);
  });

  // `ausgelassen` are moments for which the function couldn't hand out a
  // URL, they're missing from `medien`. Without this count they'd be
  // missing WITHOUT A TRACE, and the shared page would claim to show the
  // whole trip (final review, finding 2).
  test('omitted moments are read along', async () => {
    mockInvoke.mockResolvedValueOnce({ data: validResponse, error: null });
    const { data } = await resolveToken('tok123');
    expect(data?.ausgelassen).toBe(2);
  });

  // Additive and therefore NOT part of the shape check: an older function
  // without the field must not produce a dead page. 0 means "nothing left
  // out", the same state it was everywhere before this field existed.
  test.each([
    ['missing field', {}],
    ['text instead of a number', { ausgelassen: 'zwei' }],
    ['NaN', { ausgelassen: NaN }],
  ])('a response with %s counts as "nothing left out", not as an error', async (_name, broken) => {
    const { ausgelassen: _drop, ...withoutField } = validResponse;
    mockInvoke.mockResolvedValueOnce({ data: { ...withoutField, ...broken }, error: null });
    const { data, error } = await resolveToken('tok123');
    expect(error).toBeNull();
    expect(data?.ausgelassen).toBe(0);
  });

  test('an empty reel returns a SharedRecap with an empty medien array, no error', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ...validResponse, medien: [] }, error: null });
    const { data, error } = await resolveToken('tok123');
    expect(error).toBeNull();
    expect(data?.medien).toEqual([]);
  });
});

describe('resolveToken: rejection is byte-identical (Task-2 contract)', () => {
  // The core of the contract: DIFFERENT underlying causes (unknown token,
  // revoked, expired, trip not revealed, here SIMULATED via different
  // statuses/texts, because share-link itself always sends the same text
  // per contract anyway) all funnel into EXACTLY the same client text.
  // That's the guarantee that keeps the page in token.tsx from revealing
  // WHICH case applied.
  test.each([
    [404, { fehler: 'Unbekannter Token.' }],
    [410, { fehler: 'Dieser Link ist abgelaufen.' }],
    [403, { fehler: 'Kein Zugriff.' }],
    [400, { fehler: 'Token fehlt.' }],
  ])('status %s with function text %j still becomes "%s"', async (status, body) => {
    mockInvoke.mockResolvedValueOnce(httpError(status as number, body));
    const { data, error } = await resolveToken('tok123');
    expect(data).toBeNull();
    expect(error).toBe(DEAD_LINK_TEXT);
  });

  test('an HTTP error without a usable JSON body also becomes DEAD_LINK_TEXT, not a crash', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('http'), {
        name: 'FunctionsHttpError',
        context: new Response('kein json', { status: 500 }),
      }),
    });
    const { data, error } = await resolveToken('tok123');
    expect(data).toBeNull();
    expect(error).toBe(DEAD_LINK_TEXT);
  });
});

describe('resolveToken: offline is a DIFFERENT cause than a dead link', () => {
  test('a network error (nested in context) names offline, not DEAD_LINK_TEXT', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: {
        name: 'FunctionsFetchError',
        message: 'Failed to send a request to the Edge Function',
        context: { message: 'Network request failed' },
      },
    });
    const { data, error } = await resolveToken('tok123');
    expect(data).toBeNull();
    expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
    expect(error).not.toBe(DEAD_LINK_TEXT);
  });

  test('a network error without a nested context is also detected as offline', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } });
    const { data, error } = await resolveToken('tok123');
    expect(data).toBeNull();
    expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });
});

describe('resolveToken: a broken 200 response counts as a load error, not a crash', () => {
  test('missing medien array', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ...validResponse, medien: undefined }, error: null });
    const { data, error } = await resolveToken('tok123');
    expect(data).toBeNull();
    expect(error).toBe('Der Recap konnte nicht geladen werden. Probier es gleich nochmal.');
  });

  test('unparsable gueltig_bis', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ...validResponse, gueltig_bis: 'nicht-iso' }, error: null });
    const { data, error } = await resolveToken('tok123');
    expect(data).toBeNull();
    expect(error).toBe('Der Recap konnte nicht geladen werden. Probier es gleich nochmal.');
  });

  test('missing reise object', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ...validResponse, reise: undefined }, error: null });
    const { data, error } = await resolveToken('tok123');
    expect(data).toBeNull();
    expect(error).toBe('Der Recap konnte nicht geladen werden. Probier es gleich nochmal.');
  });

  test('empty/broken response with no error at all', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: null });
    const { data, error } = await resolveToken('tok123');
    expect(data).toBeNull();
    expect(error).toBe('Der Recap konnte nicht geladen werden. Probier es gleich nochmal.');
  });
});

// W4, see comment on the mock above: the sharpest proof that resolveToken
// NEVER writes, neither on success nor on error.
describe('W4: resolveToken touches only functions.invoke, never .from()/.rpc()/.auth', () => {
  test('success case', async () => {
    mockInvoke.mockResolvedValueOnce({ data: validResponse, error: null });
    await resolveToken('tok123');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockAuthSignInWithOtp).not.toHaveBeenCalled();
    expect(mockAuthSignOut).not.toHaveBeenCalled();
  });

  test('rejection case', async () => {
    mockInvoke.mockResolvedValueOnce(httpError(404, { fehler: 'Unbekannter Token.' }));
    await resolveToken('tok123');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockAuthSignInWithOtp).not.toHaveBeenCalled();
    expect(mockAuthSignOut).not.toHaveBeenCalled();
  });
});
