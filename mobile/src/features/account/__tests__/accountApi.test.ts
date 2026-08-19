// Jest hoisting: jest.mock moves above the imports (same pattern as
// recapApi.test.ts/urlPool.test.ts, supabase.functions.invoke mocked).
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

import { fetchDeletionCounts, deleteAccount, deletionSummaryText, type DeletionCounts } from '../accountApi';

beforeEach(() => {
  jest.clearAllMocks();
});

// Reconstructs a FunctionsHttpError the way supabase-js/functions-js
// actually delivers it on a non-2xx response: `context` is a real
// Response (same pattern as recapApi.test.ts/urlPool.test.ts).
function httpError(status: number, body: unknown) {
  return {
    name: 'FunctionsHttpError',
    context: new Response(JSON.stringify(body), { status }),
  };
}

describe('fetchDeletionCounts', () => {
  // Field names stay as the konto-loeschen edge function's response
  // (Task-13 contract), see accountApi.ts.
  const counts: DeletionCounts = {
    eigene_reisen: 3,
    momente_in_eigenen_reisen: 128,
    betroffene_personen: 5,
    eigene_momente_anderswo: 2,
  };

  test('success: asks aktion=zahlen and returns the counts unchanged', async () => {
    mockInvoke.mockResolvedValue({ data: counts, error: null });
    const result = await fetchDeletionCounts();
    expect(mockInvoke).toHaveBeenCalledWith('konto-loeschen', { body: { aktion: 'zahlen' } });
    expect(result).toEqual({ data: counts, error: null });
  });

  test('a functional error (plain text in the body) is passed through 1:1', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(500, { fehler: 'Die Zahlen konnten nicht ermittelt werden.' }),
    });
    const result = await fetchDeletionCounts();
    expect(result.data).toBeNull();
    expect(result.error).toBe('Die Zahlen konnten nicht ermittelt werden.');
  });

  test('a network error → offline hint, data stays null', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    const result = await fetchDeletionCounts();
    expect(result.data).toBeNull();
    expect(result.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  // An incomplete/broken response (missing field, wrong type) must NEVER
  // pass as "loaded", that's exactly the precondition for "without loaded
  // counts, confirming must not be possible" in the dialog.
  test.each([
    ['missing field', { eigene_reisen: 1, momente_in_eigenen_reisen: 1, betroffene_personen: 1 }],
    ['wrong type', { ...counts, eigene_reisen: '3' }],
    ['null', null],
  ])('a broken response (%s) returns data:null instead of guessed counts', async (_label, broken) => {
    mockInvoke.mockResolvedValue({ data: broken, error: null });
    const result = await fetchDeletionCounts();
    expect(result.data).toBeNull();
    expect(result.error).toBe('Die Zahlen konnten nicht ermittelt werden. Probier es gleich nochmal.');
  });
});

describe('deleteAccount', () => {
  test('success: calls aktion=loeschen', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
    const result = await deleteAccount();
    expect(mockInvoke).toHaveBeenCalledWith('konto-loeschen', { body: { aktion: 'loeschen' } });
    expect(result).toEqual({ error: null });
  });

  // The central contract detail from the brief: a 401 AFTER a deletion
  // attempt counts as success (the account no longer exists), not an
  // error, otherwise the UI would falsely show an error on an actual
  // success (lost response + retry).
  test('a 401 after the deletion attempt counts as success, not as an error', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(401, { fehler: 'Nicht angemeldet.' }) });
    const result = await deleteAccount();
    expect(result).toEqual({ error: null });
  });

  test('another functional error (e.g. 500) stays a genuine error with plain text', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(500, { fehler: 'Dein Konto konnte nicht vollständig gelöscht werden. Versuch es später noch einmal.' }),
    });
    const result = await deleteAccount();
    expect(result.error).toBe('Dein Konto konnte nicht vollständig gelöscht werden. Versuch es später noch einmal.');
  });

  test('a network error (no HTTP status) → offline hint, no false success', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    const result = await deleteAccount();
    expect(result.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('an error without a usable body falls back to the generic German message', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { name: 'FunctionsHttpError', context: new Response('kaputt', { status: 500 }) } });
    const result = await deleteAccount();
    expect(result.error).toBe('Dein Konto konnte nicht vollständig gelöscht werden. Probier es später noch einmal.');
  });
});

describe('deletionSummaryText', () => {
  test('brief example verbatim: "3 Reisen mit insgesamt 128 Momenten von 5 Personen"', () => {
    const text = deletionSummaryText({
      eigene_reisen: 3, momente_in_eigenen_reisen: 128, betroffene_personen: 5, eigene_momente_anderswo: 0,
    });
    expect(text).toContain('3 Reisen mit insgesamt 128 Momenten von 5 Personen');
  });

  test('singular for exactly one trip/one moment/one person', () => {
    const text = deletionSummaryText({
      eigene_reisen: 1, momente_in_eigenen_reisen: 1, betroffene_personen: 1, eigene_momente_anderswo: 0,
    });
    expect(text).toContain('1 Reise mit insgesamt 1 Moment von 1 Person verschwindet');
  });

  test('own moments in other trips are named ADDITIONALLY, even without own trips', () => {
    const text = deletionSummaryText({
      eigene_reisen: 0, momente_in_eigenen_reisen: 0, betroffene_personen: 0, eigene_momente_anderswo: 4,
    });
    expect(text).toContain('4 Momente in fremden Reisen');
    expect(text).not.toContain('Reisen mit insgesamt');
  });

  test('singular for a single moment elsewhere', () => {
    const text = deletionSummaryText({
      eigene_reisen: 0, momente_in_eigenen_reisen: 0, betroffene_personen: 0, eigene_momente_anderswo: 1,
    });
    expect(text).toContain('dein Moment in einer fremden Reise');
  });

  test('both sentences together, when both apply', () => {
    const text = deletionSummaryText({
      eigene_reisen: 2, momente_in_eigenen_reisen: 40, betroffene_personen: 3, eigene_momente_anderswo: 5,
    });
    expect(text).toContain('2 Reisen mit insgesamt 40 Momenten von 3 Personen');
    expect(text).toContain('5 Momente in fremden Reisen');
  });

  test('without own trips and without moments elsewhere, a true, non-empty sentence remains', () => {
    const text = deletionSummaryText({
      eigene_reisen: 0, momente_in_eigenen_reisen: 0, betroffene_personen: 0, eigene_momente_anderswo: 0,
    });
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });
});
