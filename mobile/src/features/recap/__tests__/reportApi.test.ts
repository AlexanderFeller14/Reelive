// Jest hoisting: jest.mock moves above the imports (same pattern as
// socialApi.test.ts/tripsApi.test.ts).
const mockGetSession = jest.fn();
const mockFrom = jest.fn();
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => mockGetSession() },
    from: (...args: unknown[]) => mockFrom(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

import { reportMoment, fetchReports, dismissReport, removeMoment } from '../reportApi';

const SESSION_OK = { data: { session: { user: { id: 'u1' } } }, error: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue(SESSION_OK);
});

// reports: .insert(values)
function insertChain(result: { error: unknown }) {
  const insert = jest.fn(async () => result);
  mockFrom.mockReturnValue({ insert });
  return { insert };
}

// reports: .select(…).eq('posts.trip_id', …).is('erledigt_am', null).order(…)
function reportsChain(result: { data: unknown; error: unknown }) {
  const order = jest.fn(async () => result);
  const is = jest.fn(() => ({ order }));
  const eq = jest.fn(() => ({ is }));
  const select = jest.fn(() => ({ eq }));
  mockFrom.mockReturnValue({ select });
  return { select, eq, is, order };
}

// reports: .update(values).eq('id', …)
function updateChain(result: { error: unknown }) {
  const eq = jest.fn(async () => result);
  const update = jest.fn((_payload: Record<string, unknown>) => ({ eq }));
  mockFrom.mockReturnValue({ update });
  return { update, eq };
}

describe('reportMoment', () => {
  test('success: sends the trimmed reason with the caller\'s own reporter_id', async () => {
    const chain = insertChain({ error: null });
    const result = await reportMoment('p1', '  Unpassend  ');
    expect(result).toEqual({ error: null });
    expect(mockFrom).toHaveBeenCalledWith('reports');
    expect(chain.insert).toHaveBeenCalledWith({ post_id: 'p1', reporter_id: 'u1', reason: 'Unpassend' });
  });

  test('an empty reason is rejected BEFORE any call, no session needed, no insert', async () => {
    const result = await reportMoment('p1', '');
    expect(result.error).toBe('Beschreib kurz, worum es geht, bevor du meldest.');
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('whitespace only counts as empty', async () => {
    const result = await reportMoment('p1', '   ');
    expect(result.error).toBe('Beschreib kurz, worum es geht, bevor du meldest.');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  // The database check allows exactly 1–500 characters (same as the app's
  // own check), 500 must go through, 501 must be rejected BEFORE the
  // network call.
  test('exactly 500 characters is allowed', async () => {
    const chain = insertChain({ error: null });
    const text = 'a'.repeat(500);
    const result = await reportMoment('p1', text);
    expect(result).toEqual({ error: null });
    expect(chain.insert).toHaveBeenCalledWith({ post_id: 'p1', reporter_id: 'u1', reason: text });
  });

  test('501 characters is rejected BEFORE sending, no call to Supabase', async () => {
    const result = await reportMoment('p1', 'a'.repeat(501));
    expect(result.error).toBe('Deine Begründung darf höchstens 500 Zeichen haben.');
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('without a session: no insert, a clear German message', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    const result = await reportMoment('p1', 'Unpassend');
    expect(result.error).toBe('Du bist nicht angemeldet. Melde dich an und probier es nochmal.');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('network error on insert → offline hint', async () => {
    insertChain({ error: { message: 'Network request failed' } });
    const result = await reportMoment('p1', 'Unpassend');
    expect(result.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('another error on insert → generic German message', async () => {
    insertChain({ error: { message: 'kaputt' } });
    const result = await reportMoment('p1', 'Unpassend');
    expect(result.error).toBe('Deine Meldung konnte nicht gesendet werden. Probier es gleich nochmal.');
  });
});

describe('fetchReports', () => {
  test('success: reads open reports of ONE trip, in chronological order', async () => {
    const chain = reportsChain({
      data: [
        { id: 'r1', post_id: 'p1', reason: 'Unpassend', created_at: '2026-08-10T09:00:00.000Z' },
      ],
      error: null,
    });
    const result = await fetchReports('t1');
    expect(result.error).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith('reports');
    expect(chain.eq).toHaveBeenCalledWith('posts.trip_id', 't1');
    expect(chain.is).toHaveBeenCalledWith('erledigt_am', null);
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(result.data).toEqual([
      { id: 'r1', post_id: 'p1', reason: 'Unpassend', created_at: '2026-08-10T09:00:00.000Z' },
    ]);
  });

  // Unfiltered, the eq('posts.trip_id', …) filter could be silently
  // removed, no other test in this file watches the select call closely
  // (same principle as Phase-5 final review, point 8, in socialApi.test.ts).
  test('also queries the embedded join via posts!inner (a prerequisite for the trip_id filter)', async () => {
    const chain = reportsChain({ data: [], error: null });
    await fetchReports('t1');
    expect(chain.select).toHaveBeenCalledWith(expect.stringContaining('posts!inner(trip_id)'));
  });

  test('network error → offline hint, an empty list instead of throwing', async () => {
    reportsChain({ data: null, error: { message: 'Network request failed' } });
    const result = await fetchReports('t1');
    expect(result.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
    expect(result.data).toEqual([]);
  });

  test('another error → generic German message', async () => {
    reportsChain({ data: null, error: { message: 'kaputt' } });
    const result = await fetchReports('t1');
    expect(result.error).toBe('Die Meldungen konnten nicht geladen werden. Probier es gleich nochmal.');
  });
});

describe('dismissReport', () => {
  test('success: sets ONLY erledigt_am, for exactly this report', async () => {
    const chain = updateChain({ error: null });
    const result = await dismissReport('r1');
    expect(result).toEqual({ error: null });
    expect(mockFrom).toHaveBeenCalledWith('reports');
    // The column grant (grant update (erledigt_am) …) makes an update with
    // a second field fail completely (16_reports_test.sql, case 7), this
    // call must therefore never carry a second field in the same object.
    const [payload] = chain.update.mock.calls[0];
    expect(Object.keys(payload)).toEqual(['erledigt_am']);
    expect(typeof payload.erledigt_am).toBe('string');
    expect(chain.eq).toHaveBeenCalledWith('id', 'r1');
  });

  test('network error → offline hint', async () => {
    updateChain({ error: { message: 'Network request failed' } });
    const result = await dismissReport('r1');
    expect(result.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('another error → generic German message', async () => {
    updateChain({ error: { message: 'kaputt' } });
    const result = await dismissReport('r1');
    expect(result.error).toBe('Die Meldung konnte nicht verworfen werden. Probier es gleich nochmal.');
  });
});

// A FunctionsHttpError the way functions-js builds it: the response sits as
// a real `Response` in `context`, the plain text in the JSON body.
function httpError(status: number, body: unknown) {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
  return { name: 'FunctionsHttpError', message: `Edge Function returned ${status}`, context: response };
}

describe('removeMoment', () => {
  // The actual reason for this function: the old direct
  // `from('posts').delete()` deleted ONLY the row, the medium and its
  // thumbnail stayed in storage forever. A test that only checks "no
  // error" would not have noticed that switch, so this states explicitly
  // that the client no longer touches the table itself.
  test('success: goes through the function, not through the table anymore', async () => {
    mockInvoke.mockResolvedValue({ data: { removed: true }, error: null });
    const result = await removeMoment('p1');
    expect(result).toEqual({ error: null });
    expect(mockInvoke).toHaveBeenCalledWith('remove-moment', { body: { post_id: 'p1' } });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  // The function already names cause and remedy in second person, the
  // client doesn't invent anything on top.
  test('passes the function\'s plain text through unchanged', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(403, { error: 'Dieser Moment lässt sich nicht entfernen.' }),
    });
    const result = await removeMoment('p1');
    expect(result.error).toBe('Dieser Moment lässt sich nicht entfernen.');
  });

  // And its boundary: without JSON in the body there is no plain text, the
  // app's own text steps in instead of showing an empty message.
  test('a response without JSON falls back to the app\'s own message', async () => {
    const response = new Response('<html>502</html>', { status: 502 });
    mockInvoke.mockResolvedValue({
      data: null,
      error: { name: 'FunctionsHttpError', message: 'Edge Function returned 502', context: response },
    });
    const result = await removeMoment('p1');
    expect(result.error).toBe('Der Moment konnte nicht entfernt werden. Probier es gleich nochmal.');
  });

  // functions-js replaces a genuine network error with a fixed English
  // sentence and puts the original fetch message in `context`, both places
  // must be checked (same pattern as urlPool.ts).
  test('network error → offline hint, also from within context', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function', context: { message: 'Network request failed' } },
    });
    const result = await removeMoment('p1');
    expect(result.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('network error directly in message → offline hint', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    const result = await removeMoment('p1');
    expect(result.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('another error → generic German message', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'kaputt' } });
    const result = await removeMoment('p1');
    expect(result.error).toBe('Der Moment konnte nicht entfernt werden. Probier es gleich nochmal.');
  });
});
