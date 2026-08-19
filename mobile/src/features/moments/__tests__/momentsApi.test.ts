// Jest hoisting: jest.mock moves above the imports, so the factory runs
// BEFORE the const assignments. Mocks are therefore only accessed at call
// time (same pattern as in tripsApi.test.ts).
const mockGetSession = jest.fn();
const mockInsert = jest.fn();
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => mockGetSession() },
    from: () => ({ insert: (...args: unknown[]) => mockInsert(...args) }),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

// media pulls in expo-file-system and expo-image-manipulator, only the
// extension derivation is needed from it here (Important 5: posts.media_ext).
jest.mock('../media', () => ({
  extensionFrom: (uri: string) => uri.slice(uri.lastIndexOf('.') + 1).toLowerCase(),
}));

import { createMoment, currentAuthorId, confirmUpload, signedUrls } from '../momentsApi';
import type { QueueJob } from '../types';

const job: QueueJob = {
  id: 'j1', post_id: 'p1', trip_id: 't1', author_id: 'u1', typ: 'photo',
  medium_uri: 'file:///m.jpg', thumb_uri: 'file:///t.jpg',
  storage_key: 'trips/t1/p1.jpg', thumb_key: 'trips/t1/p1_t.jpg',
  caption: null, captured_at: '2026-08-07T10:00:00.000Z', captured_tz: 'Europe/Zurich',
  lat: null, lng: null, place_name: null, duration_s: null,
  zustand: 'wartet', versuche: 0, naechster_versuch: 0,
  zeile_angelegt: false, medium_geladen: false, thumb_geladen: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null });
});

// Task-13-Fix-Runde-2: author_id now comes from the job (captured in
// preview.tsx when enqueuing), no longer from the session at the time of
// writing, otherwise a moment that merely sat in the queue could land under
// the name of the next signed-in person.
test('success: creates it, author_id comes from the job, typ gets renamed to type', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  const result = await createMoment(job);
  expect(result).toEqual({ error: null });
  expect(mockInsert).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'p1', author_id: 'u1', type: 'photo' })
  );
  expect(mockInsert.mock.calls[0][0]).not.toHaveProperty('typ');
  // No more session lookup for authorship.
  expect(mockGetSession).not.toHaveBeenCalled();
});

test('author_id of another user is passed through unchanged (the selection beforehand is the safeguard)', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  await createMoment({ ...job, author_id: 'jemand-anders' });
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ author_id: 'jemand-anders' }));
});

test('primary key already present (23505): a restart counts as success', async () => {
  mockInsert.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key value' } });
  const result = await createMoment(job);
  expect(result).toEqual({ error: null });
});

// Fix-Runde 1: SQLSTATE 42501 alone is ambiguous (insufficient_privilege
// covers both an RLS violation and a missing GRANT). Both directions must
// hold, when in doubt retry, don't discard.
test('genuine RLS rejection (reveal rule) → permanentlyRejected, job may be discarded', async () => {
  mockInsert.mockResolvedValueOnce({
    error: { code: '42501', message: 'new row violates row-level security policy for table "posts"' },
  });
  const result = await createMoment(job);
  expect(result.permanentlyRejected).toBe(true);
  expect(result.error).not.toBeNull();
});

test('42501 from a missing GRANT ("permission denied") → no permanentlyRejected, gets retried', async () => {
  mockInsert.mockResolvedValueOnce({
    error: { code: '42501', message: 'permission denied for table posts' },
  });
  const result = await createMoment(job);
  expect(result.permanentlyRejected).toBeUndefined();
  expect(result.error).not.toBeNull();
});

test('every other error gets retried, not discarded', async () => {
  mockInsert.mockResolvedValueOnce({ error: { code: '53300', message: 'too many connections' } });
  const result = await createMoment(job);
  expect(result.permanentlyRejected).toBeUndefined();
  expect(result.error).not.toBeNull();
});

// Final-Review, Important 5: the Edge Function derives the storage key from
// EXACTLY THIS column.
test('media_ext comes from the storage key (iOS delivers mov, Android mp4)', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  await createMoment({ ...job, typ: 'video', storage_key: 'trips/t1/p1.mov', duration_s: 8 });
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ media_ext: 'mov' }));

  mockInsert.mockResolvedValueOnce({ error: null });
  await createMoment(job);
  expect(mockInsert).toHaveBeenLastCalledWith(expect.objectContaining({ media_ext: 'jpg' }));
});

// === 2026-08-13: the silent error message ===
// `signierteUrls` only logged the error object, so the Metro log only
// showed "FunctionsHttpError: Edge Function returned a non-2xx status
// code" — the reason sat in the response body, which nobody read.
// Debugging on the device cost an hour over this, even though
// uploadBestaetigen right next to it has always evaluated the plain text.
describe('signedUrls logs the Function’s plain text', () => {
  let errorLog: jest.SpyInstance;
  beforeEach(() => {
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorLog.mockRestore();
  });

  test('the plain text from the body ends up in the log along with the status', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('http'), {
        name: 'FunctionsHttpError',
        context: new Response(JSON.stringify({ fehler: 'Reise ist bereits aufgedeckt.' }), {
          status: 403,
        }),
      }),
    });

    await expect(signedUrls('p1')).resolves.toMatchObject({ urls: null });

    const line = errorLog.mock.calls[0].join(' ');
    expect(line).toContain('403');
    expect(line).toContain('Reise ist bereits aufgedeckt.');
    // Without the post_id it's not recognizable which moment is meant when
    // several jobs are pending.
    expect(line).toContain('p1');
  });

  // 404: the posts row no longer exists server-side. That's final, the
  // worker has to be able to tell it apart from a network or server error.
  // The case jsdom hid: under Hermes the response in `context` is NOT the
  // global `Response`, `instanceof` silently failed and made the whole
  // evaluation unreachable — invisible in the Jest run, because both sides
  // use the same Response there. That's why there's deliberately an object
  // here that only has the shape.
  const responseWithoutClass = (status: number, body: unknown) => ({
    data: null,
    error: Object.assign(new Error('http'), {
      name: 'FunctionsHttpError',
      context: { status, json: async () => body, text: async () => JSON.stringify(body) },
    }),
  });

  test('a response that is not a real Response still gets evaluated', async () => {
    mockInvoke.mockResolvedValueOnce(responseWithoutClass(404, { fehler: 'Moment nicht gefunden.' }));

    const result = await signedUrls('p1');

    expect(result.permanentlyRejected).toBe(true);
    const line = errorLog.mock.calls[0].join(' ');
    expect(line).toContain('404');
    expect(line).toContain('Moment nicht gefunden.');
  });

  test('404 is reported as permanent', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('http'), {
        name: 'FunctionsHttpError',
        context: new Response(JSON.stringify({ fehler: 'Moment nicht gefunden.' }), { status: 404 }),
      }),
    });

    await expect(signedUrls('p1')).resolves.toEqual({ urls: null, permanentlyRejected: true });
  });

  test('every other error stays retryable', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('http'), {
        name: 'FunctionsHttpError',
        context: new Response(JSON.stringify({ fehler: 'Server nicht konfiguriert.' }), {
          status: 500,
        }),
      }),
    });

    await expect(signedUrls('p1')).resolves.toEqual({ urls: null, permanentlyRejected: false });
  });

  test('a response without a JSON body doesn’t lose at least the status', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('http'), {
        name: 'FunctionsHttpError',
        context: new Response('Service Unavailable', { status: 503 }),
      }),
    });

    await expect(signedUrls('p1')).resolves.toMatchObject({ urls: null });
    expect(errorLog.mock.calls[0].join(' ')).toContain('503');
  });
});

// === Final-Review, Important 4 ===
// If confirm responds with 409, storage has no complete object. That's the
// only failure where RE-UPLOADING helps instead of just re-confirming,
// without this distinction the worker skipped the uploads and only ever
// called confirm again, forever.
describe('confirmUpload', () => {
  const httpError = (status: number, body: unknown) => ({
    data: null,
    error: Object.assign(new Error('http'), {
      name: 'FunctionsHttpError',
      context: new Response(JSON.stringify(body), { status }),
    }),
  });

  test('success', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await expect(confirmUpload('p1')).resolves.toEqual({ error: null });
  });

  test('409 is reported as incomplete, with the Function’s plain text', async () => {
    mockInvoke.mockResolvedValueOnce(httpError(409, { fehler: 'Upload ist noch nicht vollständig.' }));
    const result = await confirmUpload('p1');
    expect(result.incomplete).toBe(true);
    expect(result.error).toBe('Upload ist noch nicht vollständig.');
  });

  // Counterpart to the test in signedUrls: the same class check has stood
  // here forever and never held on the device — the 409 detection there
  // was ineffective.
  test('409 is recognized as incomplete even without a real Response', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('http'), {
        name: 'FunctionsHttpError',
        context: {
          status: 409,
          json: async () => ({ fehler: 'Upload ist noch nicht vollständig.' }),
        },
      }),
    });

    const result = await confirmUpload('p1');

    expect(result.incomplete).toBe(true);
    expect(result.error).toBe('Upload ist noch nicht vollständig.');
  });

  test('409 without a usable body still counts as incomplete', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('http'), {
        name: 'FunctionsHttpError',
        context: new Response('kein json', { status: 409 }),
      }),
    });
    const result = await confirmUpload('p1');
    expect(result.incomplete).toBe(true);
    expect(result.error).not.toBeNull();
  });

  test('every other HTTP error is NOT incomplete, the uploads stay done', async () => {
    mockInvoke.mockResolvedValueOnce(httpError(500, { fehler: 'Bestätigen fehlgeschlagen.' }));
    const result = await confirmUpload('p1');
    expect(result.incomplete).toBe(false);
    expect(result.error).toBe('Bestätigen fehlgeschlagen.');
  });

  test('a network error names offline as the cause and is not incomplete', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function', context: { message: 'Network request failed' } },
    });
    const result = await confirmUpload('p1');
    expect(result.incomplete).toBeUndefined();
    expect(result.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });
});

// currentAuthorId(): used by the worker BEFORE job selection (Task-13-Fix-Runde-2).
describe('currentAuthorId', () => {
  test('returns the user id from the active session', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } }, error: null });
    await expect(currentAuthorId()).resolves.toBe('u1');
  });

  test('no session → null', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(currentAuthorId()).resolves.toBeNull();
  });

  test('session error → null instead of throwing', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: { message: 'kaputt' } });
    await expect(currentAuthorId()).resolves.toBeNull();
  });

  test('getSession() rejected (e.g. storage error) → null instead of throwing', async () => {
    mockGetSession.mockRejectedValueOnce(new Error('Storage kaputt'));
    await expect(currentAuthorId()).resolves.toBeNull();
  });
});
