// Jest-Hoisting: jest.mock wandert über die Importe, die Factory läuft also
// VOR den const-Zuweisungen — Zugriff auf die Mocks deshalb erst zur
// Aufrufzeit (Muster wie recapApi.test.ts/urlVorrat.test.ts).
//
// W4, Kernstück dieser Datei: NICHT nur `functions.invoke` wird gemockt,
// sondern der GESAMTE Client — `from`, `rpc`, `auth` sind eigene Spione. Ein
// Test, der nur `functions.invoke` beobachtet, könnte einen heimlich
// hinzugefügten `.from(...)`-Aufruf gar nicht bemerken (genau die
// Phase-5-Warnung: ein Mock, der den zu prüfenden Mechanismus selbst
// ersetzt, prüft nichts). Hier bleibt die ECHTE loeseTokenAuf-Implementierung
// unangetastet — nur die IO-Grenze (der Client) ist ein Double.
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

import { loeseTokenAuf, LINK_TOT_TEXT } from '../shareApi';

beforeEach(() => jest.clearAllMocks());

const httpFehler = (status: number, body: unknown) => ({
  data: null,
  error: Object.assign(new Error('http'), {
    name: 'FunctionsHttpError',
    context: new Response(JSON.stringify(body), { status }),
  }),
});

const gueltigeAntwort = {
  reise: { name: 'Lissabon Städtetrip', start_date: '2026-08-10', end_date: '2026-08-14' },
  medien: [
    {
      post_id: 'p1', autor_name: 'Lea', type: 'photo', captured_at: '2026-08-10T09:00:00.000Z',
      captured_tz: 'Europe/Zurich', place_name: 'Lissabon', caption: 'Schön hier',
      duration_s: null, medium_url: 'https://s3/p1', thumb_url: 'https://s3/p1-thumb',
    },
    {
      post_id: 'p2', autor_name: 'Jonas', type: 'video', captured_at: '2026-08-10T10:00:00.000Z',
      captured_tz: 'Europe/Zurich', place_name: null, caption: null,
      duration_s: 8, medium_url: 'https://s3/p2', // kein Thumbnail: Feld fehlt ganz
    },
  ],
  gueltig_bis: '2026-08-08T13:00:00.000Z',
};

describe('loeseTokenAuf: Erfolg', () => {
  test('ruft die Function mit aktion "aufloesen" und dem Token auf, baut GeteilterRecap', async () => {
    mockInvoke.mockResolvedValueOnce({ data: gueltigeAntwort, error: null });

    const { data, error } = await loeseTokenAuf('tok123');

    expect(error).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith('share-link', { body: { aktion: 'aufloesen', token: 'tok123' } });
    expect(data?.reise).toEqual({ name: 'Lissabon Städtetrip', start_date: '2026-08-10', end_date: '2026-08-14' });
    expect(data?.gueltigBis).toBe(Date.parse('2026-08-08T13:00:00.000Z'));
    expect(data?.medien).toHaveLength(2);
    expect(data?.medien[0]).toEqual({
      post_id: 'p1', autor_name: 'Lea', type: 'photo', captured_at: '2026-08-10T09:00:00.000Z',
      captured_tz: 'Europe/Zurich', place_name: 'Lissabon', caption: 'Schön hier',
      duration_s: null, medium_url: 'https://s3/p1', thumb_url: 'https://s3/p1-thumb',
    });
  });

  // Fehlendes thumb_url wird zu null, nicht zu undefined — GeteiltesMoment.
  // thumb_url ist string | null, kein optionales Feld (ein Mutant, der
  // ?? undefined statt ?? null schreibt, fällt hier durch: toEqual
  // unterscheidet die fehlende von der null-Eigenschaft).
  test('ein Moment ohne thumb_url bekommt null, nicht undefined, und das Feld bleibt als eigene Property bestehen', async () => {
    mockInvoke.mockResolvedValueOnce({ data: gueltigeAntwort, error: null });
    const { data } = await loeseTokenAuf('tok123');
    expect(data?.medien[1].thumb_url).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(data!.medien[1], 'thumb_url')).toBe(true);
  });

  test('eine leere Filmrolle liefert einen GeteilterRecap mit leerem medien-Array, keinen Fehler', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ...gueltigeAntwort, medien: [] }, error: null });
    const { data, error } = await loeseTokenAuf('tok123');
    expect(error).toBeNull();
    expect(data?.medien).toEqual([]);
  });
});

describe('loeseTokenAuf: Ablehnung ist byte-gleich (Task-2-Vertrag)', () => {
  // Der Kern des Vertrags: UNTERSCHIEDLICHE zugrunde liegende Ursachen
  // (unbekannter Token, widerrufen, abgelaufen, nicht aufgedeckte Reise —
  // hier durch unterschiedliche Status/Texte SIMULIERT, weil share-link
  // selbst laut Vertrag ohnehin immer denselben Text sendet) münden auf
  // GENAU denselben Client-Text. Das ist die Zusicherung, die die Seite in
  // token.tsx nicht verrät, WELCHER Fall vorlag.
  test.each([
    [404, { fehler: 'Unbekannter Token.' }],
    [410, { fehler: 'Dieser Link ist abgelaufen.' }],
    [403, { fehler: 'Kein Zugriff.' }],
    [400, { fehler: 'Token fehlt.' }],
  ])('Status %s mit Function-Text %j wird trotzdem zu "%s"', async (status, body) => {
    mockInvoke.mockResolvedValueOnce(httpFehler(status as number, body));
    const { data, error } = await loeseTokenAuf('tok123');
    expect(data).toBeNull();
    expect(error).toBe(LINK_TOT_TEXT);
  });

  test('ein HTTP-Fehler ohne verwertbaren JSON-Body wird ebenfalls zu LINK_TOT_TEXT, nicht zu einem Absturz', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('http'), {
        name: 'FunctionsHttpError',
        context: new Response('kein json', { status: 500 }),
      }),
    });
    const { data, error } = await loeseTokenAuf('tok123');
    expect(data).toBeNull();
    expect(error).toBe(LINK_TOT_TEXT);
  });
});

describe('loeseTokenAuf: Offline ist eine ANDERE Ursache als ein toter Link', () => {
  test('ein Netzwerkfehler (verschachtelt in context) benennt Offline, nicht LINK_TOT_TEXT', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: {
        name: 'FunctionsFetchError',
        message: 'Failed to send a request to the Edge Function',
        context: { message: 'Network request failed' },
      },
    });
    const { data, error } = await loeseTokenAuf('tok123');
    expect(data).toBeNull();
    expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
    expect(error).not.toBe(LINK_TOT_TEXT);
  });

  test('ein Netzwerkfehler ohne verschachtelten context wird ebenfalls als offline erkannt', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } });
    const { data, error } = await loeseTokenAuf('tok123');
    expect(data).toBeNull();
    expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });
});

describe('loeseTokenAuf: kaputte 200er-Antwort zählt als Ladefehler, nicht als Absturz', () => {
  test('fehlendes medien-Array', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ...gueltigeAntwort, medien: undefined }, error: null });
    const { data, error } = await loeseTokenAuf('tok123');
    expect(data).toBeNull();
    expect(error).toBe('Der Recap konnte nicht geladen werden. Probier es gleich nochmal.');
  });

  test('unparsbares gueltig_bis', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ...gueltigeAntwort, gueltig_bis: 'nicht-iso' }, error: null });
    const { data, error } = await loeseTokenAuf('tok123');
    expect(data).toBeNull();
    expect(error).toBe('Der Recap konnte nicht geladen werden. Probier es gleich nochmal.');
  });

  test('fehlendes reise-Objekt', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ...gueltigeAntwort, reise: undefined }, error: null });
    const { data, error } = await loeseTokenAuf('tok123');
    expect(data).toBeNull();
    expect(error).toBe('Der Recap konnte nicht geladen werden. Probier es gleich nochmal.');
  });

  test('leere/kaputte Antwort ganz ohne error', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: null });
    const { data, error } = await loeseTokenAuf('tok123');
    expect(data).toBeNull();
    expect(error).toBe('Der Recap konnte nicht geladen werden. Probier es gleich nochmal.');
  });
});

// W4, siehe Kommentar am Mock oben: der schärfste Beweis, dass loeseTokenAuf
// NIE schreibt — weder im Erfolgs- noch im Fehlerfall.
describe('W4: loeseTokenAuf berührt nur functions.invoke, nie .from()/.rpc()/.auth', () => {
  test('Erfolgsfall', async () => {
    mockInvoke.mockResolvedValueOnce({ data: gueltigeAntwort, error: null });
    await loeseTokenAuf('tok123');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockAuthSignInWithOtp).not.toHaveBeenCalled();
    expect(mockAuthSignOut).not.toHaveBeenCalled();
  });

  test('Ablehnungsfall', async () => {
    mockInvoke.mockResolvedValueOnce(httpFehler(404, { fehler: 'Unbekannter Token.' }));
    await loeseTokenAuf('tok123');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockAuthSignInWithOtp).not.toHaveBeenCalled();
    expect(mockAuthSignOut).not.toHaveBeenCalled();
  });
});
