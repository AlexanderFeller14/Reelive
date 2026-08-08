// Jest-Hoisting: jest.mock wandert über die Importe, die Factory läuft also
// VOR den const-Zuweisungen — Zugriff auf die Mocks deshalb erst zur
// Aufrufzeit (Muster wie in recapApi.test.ts/postsApi.test.ts). mockInvoke
// hält die Aufruf-Argumente fest, damit ein Test nicht nur das Ergebnis,
// sondern auch geprüft, WELCHE Aktion und trip_id tatsächlich gesendet
// wurden (Auftrag: Mocks müssen Argumente festhalten und prüfbar machen).
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

import { holeVorrat, laeuftBaldAb, type Vorrat } from '../urlVorrat';

beforeEach(() => jest.clearAllMocks());

const httpFehler = (status: number, body: unknown) => ({
  data: null,
  error: Object.assign(new Error('http'), {
    name: 'FunctionsHttpError',
    context: new Response(JSON.stringify(body), { status }),
  }),
});

describe('laeuftBaldAb', () => {
  const vorrat = (gueltigBis: number): Vorrat => ({ urls: new Map(), gueltigBis });

  test('true, wenn noch weniger als fünf Minuten übrig sind', () => {
    const jetzt = 1_000_000;
    const vierMin59 = jetzt + 4 * 60 * 1000 + 59 * 1000;
    expect(laeuftBaldAb(vorrat(vierMin59), jetzt)).toBe(true);
  });

  // Grenzfall exakt bei fünf Minuten: die Schwelle greift bei WENIGER als
  // fünf Minuten, exakt fünf Minuten zählt noch nicht als "bald ab" — ein
  // Mutant, der < zu <= dreht, fällt hier durch.
  test('exakt fünf Minuten übrig gilt noch nicht als bald ablaufend', () => {
    const jetzt = 1_000_000;
    const fuenfMinuten = jetzt + 5 * 60 * 1000;
    expect(laeuftBaldAb(vorrat(fuenfMinuten), jetzt)).toBe(false);
  });

  test('false, wenn mehr als fünf Minuten übrig sind', () => {
    const jetzt = 1_000_000;
    const zehnMinuten = jetzt + 10 * 60 * 1000;
    expect(laeuftBaldAb(vorrat(zehnMinuten), jetzt)).toBe(false);
  });

  test('true, wenn der Vorrat bereits abgelaufen ist (negative Restzeit)', () => {
    const jetzt = 1_000_000;
    const abgelaufen = jetzt - 60 * 1000;
    expect(laeuftBaldAb(vorrat(abgelaufen), jetzt)).toBe(true);
  });
});

describe('holeVorrat', () => {
  test('Erfolg: baut eine post_id → URLs-Zuordnung, ruft die Function mit aktion "lesen" und trip_id auf', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: {
        medien: [
          { post_id: 'p1', medium_url: 'https://s3/p1', thumb_url: 'https://s3/p1-thumb' },
          { post_id: 'p2', medium_url: 'https://s3/p2' }, // kein Thumbnail: Feld fehlt ganz
        ],
        gueltig_bis: '2026-08-08T13:00:00.000Z',
      },
      error: null,
    });

    const { vorrat, error } = await holeVorrat('t1');

    expect(error).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith('media-urls', { body: { aktion: 'lesen', trip_id: 't1' } });
    expect(vorrat?.gueltigBis).toBe(Date.parse('2026-08-08T13:00:00.000Z'));
    expect(vorrat?.urls.size).toBe(2);
    expect(vorrat?.urls.get('p1')).toEqual({
      post_id: 'p1',
      medium_url: 'https://s3/p1',
      thumb_url: 'https://s3/p1-thumb',
    });
    // Fehlendes thumb_url im Function-Eintrag wird zu null, nicht zu
    // undefined — MedienUrl.thumb_url ist string | null, kein optionales
    // Feld (ein Mutant, der ?? undefined statt ?? null schreibt, fällt hier
    // durch: toEqual unterscheidet die fehlende von der null-Eigenschaft).
    expect(vorrat?.urls.get('p2')).toEqual({ post_id: 'p2', medium_url: 'https://s3/p2', thumb_url: null });
    expect(Object.prototype.hasOwnProperty.call(vorrat!.urls.get('p2'), 'thumb_url')).toBe(true);
  });

  test('eine leere Filmrolle liefert einen Vorrat mit leerer Zuordnung, keinen Fehler', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { medien: [], gueltig_bis: '2026-08-08T13:00:00.000Z' },
      error: null,
    });
    const { vorrat, error } = await holeVorrat('t1');
    expect(error).toBeNull();
    expect(vorrat?.urls.size).toBe(0);
  });

  // Die beiden 403-Fälle bedeuten Verschiedenes (Reise noch versiegelt vs.
  // Mitgliedschaft mitten im Recap entzogen) und müssen unterscheidbar
  // bleiben — beide Texte kommen unverändert von der Function.
  test('403 «Diese Reise ist noch versiegelt.» wird unverändert gemeldet', async () => {
    mockInvoke.mockResolvedValueOnce(httpFehler(403, { fehler: 'Diese Reise ist noch versiegelt.' }));
    const { vorrat, error } = await holeVorrat('t1');
    expect(vorrat).toBeNull();
    expect(error).toBe('Diese Reise ist noch versiegelt.');
  });

  test('403 «Kein Zugriff auf diese Reise.» (Mitgliedschaft entzogen) wird unverändert gemeldet, unterscheidbar von der Versiegelung', async () => {
    mockInvoke.mockResolvedValueOnce(httpFehler(403, { fehler: 'Kein Zugriff auf diese Reise.' }));
    const { vorrat, error } = await holeVorrat('t1');
    expect(vorrat).toBeNull();
    expect(error).toBe('Kein Zugriff auf diese Reise.');
    expect(error).not.toBe('Diese Reise ist noch versiegelt.');
  });

  test('ein HTTP-Fehler ohne verwertbaren Body bekommt eine generische deutsche Meldung', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('http'), {
        name: 'FunctionsHttpError',
        context: new Response('kein json', { status: 500 }),
      }),
    });
    const { vorrat, error } = await holeVorrat('t1');
    expect(vorrat).toBeNull();
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });

  test('ein Netzwerkfehler benennt Offline als Ursache statt der generischen Meldung', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: {
        name: 'FunctionsFetchError',
        message: 'Failed to send a request to the Edge Function',
        context: { message: 'Network request failed' },
      },
    });
    const { vorrat, error } = await holeVorrat('t1');
    expect(vorrat).toBeNull();
    expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('eine leere/kaputte Antwort ohne error wird als Fehlschlag gewertet, nicht als leerer Vorrat', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: null });
    const { vorrat, error } = await holeVorrat('t1');
    expect(vorrat).toBeNull();
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });

  test('eine Antwort ohne gueltig_bis wird als Fehlschlag gewertet', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { medien: [] }, error: null });
    const { vorrat, error } = await holeVorrat('t1');
    expect(vorrat).toBeNull();
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });
});
