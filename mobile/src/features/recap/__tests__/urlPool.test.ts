// Jest hoisting: jest.mock moves above the imports, so the factory runs
// BEFORE the const assignments, access to the mocks is therefore only
// possible at call time (same pattern as in recapApi.test.ts/
// momentsApi.test.ts). mockInvoke records the call arguments so a test can
// check not just the result, but also WHICH action and trip_id were
// actually sent (requirement: mocks must record and expose their
// arguments).
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

import { getPool, isSoonExpiring, retryHelps, SOON_EXPIRING_THRESHOLD_MS, type Pool } from '../urlPool';

beforeEach(() => jest.clearAllMocks());

const httpError = (status: number, body: unknown) => ({
  data: null,
  error: Object.assign(new Error('http'), {
    name: 'FunctionsHttpError',
    context: new Response(JSON.stringify(body), { status }),
  }),
});

describe('retryHelps', () => {
  test('a null reason means retrying helps', () => {
    expect(retryHelps(null)).toBe(true);
  });

  test('"versiegelt" means retrying does not help', () => {
    expect(retryHelps('versiegelt')).toBe(false);
  });

  test('"kein_zugriff" means retrying does not help', () => {
    expect(retryHelps('kein_zugriff')).toBe(false);
  });
});

describe('isSoonExpiring', () => {
  const pool = (gueltigBis: number): Pool => ({ urls: new Map(), gueltigBis, ausgelassen: 0 });

  // Literal-pinned the same way as PHOTO_DURATION_MS/VIDEO_DURATION_MIN_MS in
  // playerLogic.test.ts (review finding, Phase-5 final review, point 8):
  // without this test, "exactly five minutes" below derived its comparison
  // value from SOON_EXPIRING_THRESHOLD_MS itself instead of checking it
  // against a literal, so any value between 4:59 (test above) and 10:00
  // (test below) passed all four tests in this suite and the five-minute
  // threshold from Spec §7 was pinned down nowhere.
  test('SOON_EXPIRING_THRESHOLD_MS is five minutes (Spec §7: expiry lead time for read URLs)', () => {
    expect(SOON_EXPIRING_THRESHOLD_MS).toBe(5 * 60 * 1000);
  });

  test('true when less than five minutes remain', () => {
    const now = 1_000_000;
    const fourMin59 = now + 4 * 60 * 1000 + 59 * 1000;
    expect(isSoonExpiring(pool(fourMin59), now)).toBe(true);
  });

  // Boundary case at exactly five minutes: the threshold applies at LESS
  // than five minutes, exactly five minutes doesn't yet count as "soon
  // expiring", a mutant that turns < into <= fails here. Literal
  // `5 * 60 * 1000` instead of `SOON_EXPIRING_THRESHOLD_MS` (see above): the
  // test thereby checks the actual five-minute boundary, not just "whatever
  // the constant currently is".
  test('exactly five minutes remaining does not yet count as soon expiring', () => {
    const now = 1_000_000;
    const fiveMinutes = now + 5 * 60 * 1000;
    expect(isSoonExpiring(pool(fiveMinutes), now)).toBe(false);
  });

  // Just past the threshold (5:01), a tighter counter-check to the
  // ten-minute test below that catches a mutant shifting the threshold
  // generously upward (e.g. to ten minutes): 5:01 would then wrongly still
  // fall inside the (mutated) threshold.
  test('five minutes and one second remaining no longer counts as soon expiring', () => {
    const now = 1_000_000;
    const fiveMinutes01 = now + 5 * 60 * 1000 + 1000;
    expect(isSoonExpiring(pool(fiveMinutes01), now)).toBe(false);
  });

  test('false when more than five minutes remain', () => {
    const now = 1_000_000;
    const tenMinutes = now + 10 * 60 * 1000;
    expect(isSoonExpiring(pool(tenMinutes), now)).toBe(false);
  });

  test('true when the pool has already expired (negative time left)', () => {
    const now = 1_000_000;
    const expired = now - 60 * 1000;
    expect(isSoonExpiring(pool(expired), now)).toBe(true);
  });

  // A separate safety net around isSoonExpiring itself, independent of how
  // a pool came to exist: `NaN - now < THRESHOLD` would be `false` ("never
  // expires", the opposite of V10); the negated `>=` form must return
  // `true` here ("renew").
  test('a NaN gueltigBis counts as soon expiring, not as "never expires"', () => {
    expect(isSoonExpiring(pool(NaN), 1_000_000)).toBe(true);
  });
});

describe('getPool', () => {
  test('success: builds a post_id → URLs mapping, calls the function with aktion "lesen" and trip_id', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: {
        medien: [
          { post_id: 'p1', medium_url: 'https://s3/p1', thumb_url: 'https://s3/p1-thumb' },
          { post_id: 'p2', medium_url: 'https://s3/p2' }, // no thumbnail: field absent entirely
        ],
        gueltig_bis: '2026-08-08T13:00:00.000Z',
        ausgelassen: 1,
      },
      error: null,
    });

    const { vorrat, error, grund } = await getPool('t1');

    expect(error).toBeNull();
    expect(grund).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith('media-urls', { body: { aktion: 'lesen', trip_id: 't1' } });
    expect(vorrat?.gueltigBis).toBe(Date.parse('2026-08-08T13:00:00.000Z'));
    expect(vorrat?.ausgelassen).toBe(1);
    expect(vorrat?.urls.size).toBe(2);
    expect(vorrat?.urls.get('p1')).toEqual({
      post_id: 'p1',
      medium_url: 'https://s3/p1',
      thumb_url: 'https://s3/p1-thumb',
    });
    // A missing thumb_url in the function's entry becomes null, not
    // undefined, MediaUrl.thumb_url is string | null, not an optional field
    // (a mutant writing ?? undefined instead of ?? null fails here: toEqual
    // distinguishes the missing from the null property).
    expect(vorrat?.urls.get('p2')).toEqual({ post_id: 'p2', medium_url: 'https://s3/p2', thumb_url: null });
    expect(Object.prototype.hasOwnProperty.call(vorrat!.urls.get('p2'), 'thumb_url')).toBe(true);
  });

  test('an empty roll of film returns a pool with an empty mapping, no error', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { medien: [], gueltig_bis: '2026-08-08T13:00:00.000Z', ausgelassen: 0 },
      error: null,
    });
    const { vorrat, error } = await getPool('t1');
    expect(error).toBeNull();
    expect(vorrat?.urls.size).toBe(0);
    expect(vorrat?.ausgelassen).toBe(0);
  });

  // isSoonExpiring has its own, independent NaN safety net (see above), this
  // test covers the earlier layer: getPool must not let an UNPARSABLE
  // gueltig_bis quietly become a pool whose expiry can never again be
  // detected as "soon".
  test('an unparsable gueltig_bis is treated as a failure, not as a pool with a broken expiry', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { medien: [], gueltig_bis: 'nicht-iso', ausgelassen: 0 },
      error: null,
    });
    const { vorrat, error } = await getPool('t1');
    expect(vorrat).toBeNull();
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });

  // The Array.isArray check on `medien` must not become removable without a
  // test noticing, without it the `for…of` would throw a TypeError in
  // production instead of returning an error message.
  test('a response with a valid gueltig_bis but no medien array is treated as a failure, not a crash', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { gueltig_bis: '2026-08-08T13:00:00.000Z', ausgelassen: 0 },
      error: null,
    });
    await expect(getPool('t1')).resolves.toEqual({
      vorrat: null,
      error: 'Die Momente konnten nicht geladen werden. Probier es gleich nochmal.',
      grund: null,
    });
  });

  // The app (EAS) and the edge function (`supabase functions deploy`) are
  // rolled out separately; a rollback or a swapped order in which the
  // function doesn't (yet) send the field must not turn "a hint text is
  // missing" into "the whole recap fails to load".
  test('a response without ausgelassen is treated as 0, not as a load error', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { medien: [], gueltig_bis: '2026-08-08T13:00:00.000Z' },
      error: null,
    });
    const { vorrat, error } = await getPool('t1');
    expect(error).toBeNull();
    expect(vorrat?.ausgelassen).toBe(0);
  });

  // Counter-check to the test above: an ACTUALLY transmitted value (even 0)
  // still passes through unchanged, `?? 0` must not overwrite a real value;
  // a mutant shortening `antwort.ausgelassen ?? 0` to `antwort.ausgelassen
  // || 0` would fail HERE, because 0 is already falsy and both forms behave
  // identically for 0, the actual difference only shows up with a present,
  // non-zero value like this one.
  test('an actually transmitted ausgelassen value passes through unchanged', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { medien: [], gueltig_bis: '2026-08-08T13:00:00.000Z', ausgelassen: 4 },
      error: null,
    });
    const { vorrat, error } = await getPool('t1');
    expect(error).toBeNull();
    expect(vorrat?.ausgelassen).toBe(4);
  });

  // The two 403 cases mean different things (trip still sealed vs.
  // membership revoked mid-recap) and must stay distinguishable BY MACHINE
  // (review finding, Important 2), not just via the displayed text.
  test('403 "Diese Reise ist noch versiegelt." passes through and is recognised as grund "versiegelt"', async () => {
    mockInvoke.mockResolvedValueOnce(httpError(403, { fehler: 'Diese Reise ist noch versiegelt.' }));
    const { vorrat, error, grund } = await getPool('t1');
    expect(vorrat).toBeNull();
    expect(error).toBe('Diese Reise ist noch versiegelt.');
    expect(grund).toBe('versiegelt');
  });

  test('403 "Kein Zugriff auf diese Reise." passes through and is recognised as grund "kein_zugriff", distinct from "versiegelt"', async () => {
    mockInvoke.mockResolvedValueOnce(httpError(403, { fehler: 'Kein Zugriff auf diese Reise.' }));
    const { vorrat, error, grund } = await getPool('t1');
    expect(vorrat).toBeNull();
    expect(error).toBe('Kein Zugriff auf diese Reise.');
    expect(grund).toBe('kein_zugriff');
    expect(grund).not.toBe('versiegelt');
  });

  // reasonFrom checks status AND text, not just the text (review finding,
  // Important 2: the same wording could in theory also arrive under a
  // different status code). A test that only plays back the function's two
  // genuine 403 responses would NOT notice a removed status check, this one
  // does: the same text at status 500 must not produce a grund.
  test('the same text at a status other than 403 produces no grund', async () => {
    mockInvoke.mockResolvedValueOnce(httpError(500, { fehler: 'Diese Reise ist noch versiegelt.' }));
    const { vorrat, error, grund } = await getPool('t1');
    expect(vorrat).toBeNull();
    expect(grund).toBeNull();
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });

  // The name check for 'FunctionsHttpError' must not pass a response body
  // through as a structured 403 case just because it looks the same; an
  // error object with a DIFFERENT name but the same response body must fall
  // back to the generic message.
  test('a response context with a different error name is NOT treated as a structured 403', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('http'), {
        name: 'IrgendeinAndererFehler',
        context: new Response(JSON.stringify({ fehler: 'Diese Reise ist noch versiegelt.' }), { status: 403 }),
      }),
    });
    const { vorrat, error, grund } = await getPool('t1');
    expect(vorrat).toBeNull();
    expect(grund).toBeNull();
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });

  // Only the two domain-specific 403s pass through, every other status/text
  // gets the generic, solution-oriented message (DESIGN-LANGUAGE §6), not
  // the function's raw text.
  test('an HTTP error without a usable body gets a generic German message', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('http'), {
        name: 'FunctionsHttpError',
        context: new Response('kein json', { status: 500 }),
      }),
    });
    const { vorrat, error, grund } = await getPool('t1');
    expect(vorrat).toBeNull();
    expect(grund).toBeNull();
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });

  test('a 401/400/500/502 plain text from the function is NOT passed through, replaced by the generic message', async () => {
    mockInvoke.mockResolvedValueOnce(httpError(401, { fehler: 'Nicht angemeldet.' }));
    const { error, grund } = await getPool('t1');
    expect(grund).toBeNull();
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });

  test('a network error (nested in context) names offline as the cause instead of the generic message', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: {
        name: 'FunctionsFetchError',
        message: 'Failed to send a request to the Edge Function',
        context: { message: 'Network request failed' },
      },
    });
    const { vorrat, error } = await getPool('t1');
    expect(vorrat).toBeNull();
    expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  // The second offline branch in functionMessage (detection directly via
  // error.message, without a nested context) wasn't covered by any test on
  // its own, the test above would also have stayed green with only the
  // context branch implemented.
  test('a network error without a nested context is also recognised as offline', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: { message: 'Network request failed' },
    });
    const { vorrat, error } = await getPool('t1');
    expect(vorrat).toBeNull();
    expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('an empty/broken response without an error is treated as a failure, not as an empty pool', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: null });
    const { vorrat, error, grund } = await getPool('t1');
    expect(vorrat).toBeNull();
    expect(grund).toBeNull();
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });

  test('a response without gueltig_bis is treated as a failure', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { medien: [], ausgelassen: 0 }, error: null });
    const { vorrat, error } = await getPool('t1');
    expect(vorrat).toBeNull();
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });
});
