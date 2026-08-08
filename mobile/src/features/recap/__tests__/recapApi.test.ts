// Jest-Hoisting: jest.mock wandert über die Importe, die Factory läuft also
// VOR den const-Zuweisungen — Zugriff auf die Mocks deshalb erst zur
// Aufrufzeit (Muster wie in tripsApi.test.ts/postsApi.test.ts).
const mockFrom = jest.fn();
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

import { fetchRecapMomente, revealTrip } from '../recapApi';

beforeEach(() => jest.clearAllMocks());

const zeile = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1', trip_id: 't1', author_id: 'u1', type: 'photo',
  duration_s: null, caption: null,
  captured_at: '2026-08-01T10:00:00.000Z', captured_tz: 'Europe/Zurich',
  place_name: null, upload_status: 'uploaded',
  profiles: { display_name: 'Lea' },
  ...overrides,
});

describe('fetchRecapMomente', () => {
  test('liest Momente samt Autorenname in einem Aufruf', async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: async () => ({ data: [zeile()], error: null }) }),
    });
    const { data, error } = await fetchRecapMomente('t1');
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        id: 'p1', trip_id: 't1', author_id: 'u1', type: 'photo',
        duration_s: null, caption: null,
        captured_at: '2026-08-01T10:00:00.000Z', captured_tz: 'Europe/Zurich',
        place_name: null, upload_status: 'uploaded', autor_name: 'Lea',
      },
    ]);
    expect(mockFrom).toHaveBeenCalledWith('posts');
  });

  test('sortiert das Ergebnis über tage.sortiereMomente — nicht bloss über die DB-Reihenfolge', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: async () => ({
          data: [
            zeile({ id: 'spaet', captured_at: '2026-08-01T15:00:00.000Z' }),
            zeile({ id: 'frueh', captured_at: '2026-08-01T09:00:00.000Z' }),
          ],
          error: null,
        }),
      }),
    });
    const { data } = await fetchRecapMomente('t1');
    expect(data.map((m) => m.id)).toEqual(['frueh', 'spaet']);
  });

  test('ein Moment ohne profiles-Treffer bekommt einen leeren Autorennamen statt zu werfen', async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: async () => ({ data: [zeile({ profiles: null })], error: null }) }),
    });
    const { data } = await fetchRecapMomente('t1');
    expect(data[0].autor_name).toBe('');
  });

  test('meldet einen Ladefehler statt einer leeren Liste ohne Erklärung', async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: async () => ({ data: null, error: { message: 'kaputt' } }) }),
    });
    const { data, error } = await fetchRecapMomente('t1');
    expect(data).toEqual([]);
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });

  test('benennt den Offline-Fall statt nur «probier es nochmal»', async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: async () => ({ data: null, error: { message: 'Network request failed' } }) }),
    });
    const { error } = await fetchRecapMomente('t1');
    expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  // Kein Fehlerfall: posts_select_revealed_members lässt vor dem Reveal
  // niemanden lesen — RLS filtert, wirft aber nicht.
  test('eine (noch) nicht aufgedeckte Reise liefert eine leere Liste ohne Fehler', async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: async () => ({ data: [], error: null }) }),
    });
    const { data, error } = await fetchRecapMomente('t1');
    expect(data).toEqual([]);
    expect(error).toBeNull();
  });
});

describe('revealTrip', () => {
  const httpFehler = (status: number, body: unknown) => ({
    data: null,
    error: Object.assign(new Error('http'), {
      name: 'FunctionsHttpError',
      context: new Response(JSON.stringify(body), { status }),
    }),
  });

  test('Erfolg: liefert revealed_at, ruft die Function mit trip_id auf', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: true, revealed_at: '2026-08-08T12:00:00Z' }, error: null });
    await expect(revealTrip('t1')).resolves.toEqual({ revealed_at: '2026-08-08T12:00:00Z', error: null });
    expect(mockInvoke).toHaveBeenCalledWith('reveal-trip', { body: { trip_id: 't1' } });
  });

  // Idempotenz laut Brief: ein zweiter Aufruf auf eine bereits aufgedeckte
  // Reise antwortet ebenfalls 200 mit demselben revealed_at — für revealTrip
  // ist das derselbe Erfolgspfad wie beim ersten Mal.
  test('ein Wiederholungsaufruf nach bereits erfolgtem Reveal ist ebenfalls Erfolg', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: true, revealed_at: '2026-08-08T12:00:00Z' }, error: null });
    await expect(revealTrip('t1')).resolves.toEqual({ revealed_at: '2026-08-08T12:00:00Z', error: null });
  });

  test('ein HTTP-Fehler der Function wird mit ihrem deutschen Klartext gemeldet', async () => {
    mockInvoke.mockResolvedValueOnce(httpFehler(403, { fehler: 'Nur wer die Reise angelegt hat, kann sie abschliessen.' }));
    const { revealed_at, error } = await revealTrip('t1');
    expect(revealed_at).toBeNull();
    expect(error).toBe('Nur wer die Reise angelegt hat, kann sie abschliessen.');
  });

  test('ein HTTP-Fehler ohne verwertbaren Body bekommt eine generische deutsche Meldung', async () => {
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

  test('ein Netzwerkfehler benennt Offline als Ursache', async () => {
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

  test('eine Antwort ohne ok:true wird als Fehlschlag gewertet', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { revealed_at: null }, error: null });
    const { error } = await revealTrip('t1');
    expect(error).toBe('Die Reise konnte nicht abgeschlossen werden. Probier es gleich nochmal.');
  });
});
