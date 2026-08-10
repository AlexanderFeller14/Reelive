// Jest-Hoisting: jest.mock wandert über die Importe, die Factory läuft also
// VOR den const-Zuweisungen, Zugriff auf die Mocks deshalb erst zur
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

type Antwort = { data: unknown; error: unknown };

// posts: .select(SPALTEN).eq('trip_id', tripId), select/eq als jest.fn(),
// damit die AUFRUF-Argumente selbst prüfbar sind, nicht nur das Endergebnis
// (Review-Fund: ein Mock, der Argumente ignoriert, lässt "profiles(display_
// name) aus SPALTEN entfernt" bzw. "eq() auf falscher Spalte" unbemerkt
// durchrutschen, Muster wie tripKette in tripsApi.test.ts).
const postsKette = (ergebnis: Antwort) => {
  const eq = jest.fn(async () => ergebnis);
  // Parameter ausdrücklich typisiert (auch wenn ungenutzt): sonst inferiert
  // jest.fn() aus der Implementierung eine nullstellige Funktion, und
  // select.mock.calls[0][0] wäre ein Tupel-Zugriff ausserhalb der Länge.
  const select = jest.fn((_spalten: string) => ({ eq }));
  mockFrom.mockReturnValue({ select });
  return { select, eq };
};

describe('fetchRecapMomente', () => {
  test('liest Momente samt Autorenname in einem Aufruf', async () => {
    const { select, eq } = postsKette({ data: [zeile()], error: null });
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
    // Kein N+1: der Autorenname muss TEIL derselben select()-Spaltenliste
    // sein, nicht ein zweiter Aufruf gegen profiles.
    expect(select).toHaveBeenCalledTimes(1);
    // Der Fremdschlüsselname MUSS drinstehen: zwischen posts und profiles gibt
    // es zwei Wege (author_id direkt, und many-to-many über reactions).
    // Ohne ihn antwortet PostgREST mit HTTP 300 und der Recap bleibt leer,
    // was kein gemockter Test bemerkt, weil der Mock die Abfrage nie stellt.
    expect(select.mock.calls[0][0]).toEqual(
      expect.stringContaining('profiles!posts_author_id_fkey(display_name)')
    );
    expect(eq).toHaveBeenCalledWith('trip_id', 't1');
  });

  test('fetchRecapMomente fragt lat und lng mit ab', async () => {
    const { select } = postsKette({ data: [], error: null });
    await fetchRecapMomente('t1');
    const spalten = select.mock.calls[0][0] as string;
    expect(spalten).toContain('lat');
    expect(spalten).toContain('lng');
    // Der Fremdschlüsselname bleibt zwingend, ohne ihn liefert PostgREST
    // HTTP 300 und der gesamte Recap ist leer (siehe Kommentar in recapApi.ts).
    expect(spalten).toContain('profiles!posts_author_id_fkey(display_name)');
  });

  test('fetchRecapMomente reicht lat/lng durch', async () => {
    postsKette({
      data: [zeile({ place_name: 'Alfama', lat: 38.7139, lng: -9.1301 })],
      error: null,
    });
    const { data } = await fetchRecapMomente('t1');
    expect(data[0].lat).toBe(38.7139);
    expect(data[0].lng).toBe(-9.1301);
  });

  test('sortiert das Ergebnis über tage.sortiereMomente, nicht bloss über die DB-Reihenfolge', async () => {
    postsKette({
      data: [
        zeile({ id: 'spaet', captured_at: '2026-08-01T15:00:00.000Z' }),
        zeile({ id: 'frueh', captured_at: '2026-08-01T09:00:00.000Z' }),
      ],
      error: null,
    });
    const { data } = await fetchRecapMomente('t1');
    expect(data.map((m) => m.id)).toEqual(['frueh', 'spaet']);
  });

  test('ein Moment ohne profiles-Treffer bekommt einen leeren Autorennamen statt zu werfen', async () => {
    postsKette({ data: [zeile({ profiles: null })], error: null });
    const { data } = await fetchRecapMomente('t1');
    expect(data[0].autor_name).toBe('');
  });

  test('meldet einen Ladefehler statt einer leeren Liste ohne Erklärung', async () => {
    postsKette({ data: null, error: { message: 'kaputt' } });
    const { data, error } = await fetchRecapMomente('t1');
    expect(data).toEqual([]);
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });

  test('benennt den Offline-Fall statt nur «probier es nochmal»', async () => {
    postsKette({ data: null, error: { message: 'Network request failed' } });
    const { error } = await fetchRecapMomente('t1');
    expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  // Kein Fehlerfall: posts_select_revealed_members lässt vor dem Reveal
  // niemanden lesen, RLS filtert, wirft aber nicht.
  test('eine (noch) nicht aufgedeckte Reise liefert eine leere Liste ohne Fehler', async () => {
    postsKette({ data: [], error: null });
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

  // Idempotenz laut Brief: ein Wiederholen nach einem Netzfehler ist immer
  // erlaubt, revealTrip sperrt nichts. Anders als ein blosser zweiter
  // Erfolgs-Aufruf (der von jeder Memoisierung unbemerkt geblieben wäre)
  // prüft das hier konkret: die Function wird nach einem Fehlschlag TATSÄCHLICH
  // ein zweites Mal aufgerufen, nicht aus einem Cache beantwortet.
  test('ein Wiederholungsaufruf nach einem Fehlschlag ruft die Function erneut auf, statt zu sperren', async () => {
    mockInvoke
      .mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } })
      .mockResolvedValueOnce({ data: { ok: true, revealed_at: '2026-08-08T12:00:00Z' }, error: null });

    const erster = await revealTrip('t1');
    expect(erster.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');

    const zweiter = await revealTrip('t1');
    expect(zweiter).toEqual({ revealed_at: '2026-08-08T12:00:00Z', error: null });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
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
