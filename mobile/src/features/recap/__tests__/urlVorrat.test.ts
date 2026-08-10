// Jest-Hoisting: jest.mock wandert über die Importe, die Factory läuft also
// VOR den const-Zuweisungen, Zugriff auf die Mocks deshalb erst zur
// Aufrufzeit (Muster wie in recapApi.test.ts/postsApi.test.ts). mockInvoke
// hält die Aufruf-Argumente fest, damit ein Test nicht nur das Ergebnis,
// sondern auch geprüft, WELCHE Aktion und trip_id tatsächlich gesendet
// wurden (Auftrag: Mocks müssen Argumente festhalten und prüfbar machen).
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

import { holeVorrat, laeuftBaldAb, BALD_ABLAUF_SCHWELLE_MS, type Vorrat } from '../urlVorrat';

beforeEach(() => jest.clearAllMocks());

const httpFehler = (status: number, body: unknown) => ({
  data: null,
  error: Object.assign(new Error('http'), {
    name: 'FunctionsHttpError',
    context: new Response(JSON.stringify(body), { status }),
  }),
});

describe('laeuftBaldAb', () => {
  const vorrat = (gueltigBis: number): Vorrat => ({ urls: new Map(), gueltigBis, ausgelassen: 0 });

  // Phase-5-Final-Review, Punkt 8 (Review-Fund): fehlte bisher, der Test
  // "exakt fünf Minuten" unten leitete seinen Vergleichswert bislang aus
  // `BALD_ABLAUF_SCHWELLE_MS` SELBST ab, statt gegen ein Literal zu prüfen.
  // Jeder Wert zwischen 4:59 (Test oben) und 10:00 (Test unten) bestand damit
  // alle vier Tests dieser Suite, die Fünf-Minuten-Schwelle aus Spec §7 war
  // nirgends festgenagelt. Literal-Pinning nach demselben Muster wie
  // `FOTO_DAUER_MS`/`VIDEO_DAUER_MIN_MS` in playerLogic.test.ts.
  test('BALD_ABLAUF_SCHWELLE_MS sind fünf Minuten (Spec §7: Ablauf-Vorlauf für Lese-URLs)', () => {
    expect(BALD_ABLAUF_SCHWELLE_MS).toBe(5 * 60 * 1000);
  });

  test('true, wenn noch weniger als fünf Minuten übrig sind', () => {
    const jetzt = 1_000_000;
    const vierMin59 = jetzt + 4 * 60 * 1000 + 59 * 1000;
    expect(laeuftBaldAb(vorrat(vierMin59), jetzt)).toBe(true);
  });

  // Grenzfall exakt bei fünf Minuten: die Schwelle greift bei WENIGER als
  // fünf Minuten, exakt fünf Minuten zählt noch nicht als "bald ab", ein
  // Mutant, der < zu <= dreht, fällt hier durch. Literal `5 * 60 * 1000`
  // statt `BALD_ABLAUF_SCHWELLE_MS` (Review-Fund, siehe oben): der Test prüft
  // damit den tatsächlichen Fünf-Minuten-Grenzwert, nicht bloss "was auch
  // immer die Konstante gerade ist".
  test('exakt fünf Minuten übrig gilt noch nicht als bald ablaufend', () => {
    const jetzt = 1_000_000;
    const fuenfMinuten = jetzt + 5 * 60 * 1000;
    expect(laeuftBaldAb(vorrat(fuenfMinuten), jetzt)).toBe(false);
  });

  // Knapp über der Schwelle (5:01), engere Gegenprobe zum 10-Minuten-Test
  // unten, die einen Mutanten fängt, der die Schwelle grosszügig nach oben
  // verschiebt (z.B. auf 10 Minuten): 5:01 läge dann fälschlich noch
  // innerhalb der (mutierten) Schwelle.
  test('fünf Minuten und eine Sekunde übrig gilt nicht mehr als bald ablaufend', () => {
    const jetzt = 1_000_000;
    const fuenfMinuten01 = jetzt + 5 * 60 * 1000 + 1000;
    expect(laeuftBaldAb(vorrat(fuenfMinuten01), jetzt)).toBe(false);
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

  // Review-Fund, Important 1: ein NaN-gueltigBis (holeVorrat fängt einen
  // unparsbaren Wert zwar schon beim Einlesen ab, siehe unten, dieser Test
  // sichert trotzdem laeuftBaldAb SELBST ab, unabhängig davon, wie ein
  // Vorrat entstanden ist). `NaN - jetzt < SCHWELLE` wäre `false` ("läuft
  // nie ab", das Gegenteil von V10); die verneinte `>=`-Form muss hier
  // `true` liefern ("erneuern").
  test('ein NaN-gueltigBis gilt als bald ablaufend, nicht als "läuft nie ab"', () => {
    expect(laeuftBaldAb(vorrat(NaN), 1_000_000)).toBe(true);
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
        ausgelassen: 1,
      },
      error: null,
    });

    const { vorrat, error, grund } = await holeVorrat('t1');

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
    // Fehlendes thumb_url im Function-Eintrag wird zu null, nicht zu
    // undefined, MedienUrl.thumb_url ist string | null, kein optionales
    // Feld (ein Mutant, der ?? undefined statt ?? null schreibt, fällt hier
    // durch: toEqual unterscheidet die fehlende von der null-Eigenschaft).
    expect(vorrat?.urls.get('p2')).toEqual({ post_id: 'p2', medium_url: 'https://s3/p2', thumb_url: null });
    expect(Object.prototype.hasOwnProperty.call(vorrat!.urls.get('p2'), 'thumb_url')).toBe(true);
  });

  test('eine leere Filmrolle liefert einen Vorrat mit leerer Zuordnung, keinen Fehler', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { medien: [], gueltig_bis: '2026-08-08T13:00:00.000Z', ausgelassen: 0 },
      error: null,
    });
    const { vorrat, error } = await holeVorrat('t1');
    expect(error).toBeNull();
    expect(vorrat?.urls.size).toBe(0);
    expect(vorrat?.ausgelassen).toBe(0);
  });

  // Review-Fund, Important 1: der ganze Zweck dieses Moduls ist, dass eine
  // abgelaufene URL den Recap nie beendet, ein UNPARSBARES gueltig_bis darf
  // deshalb nicht stillschweigend zu einem Vorrat werden, dessen Ablauf sich
  // nie mehr als "bald" erkennen liesse (Date.parse liefert NaN, NaN wäre in
  // JEDEM Vergleich false). Es muss stattdessen als Ladefehler gelten.
  test('ein unparsbares gueltig_bis wird als Fehlschlag gewertet, nicht als Vorrat mit kaputtem Ablauf', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { medien: [], gueltig_bis: 'nicht-iso', ausgelassen: 0 },
      error: null,
    });
    const { vorrat, error } = await holeVorrat('t1');
    expect(vorrat).toBeNull();
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });

  // Review-Fund: die Array.isArray-Prüfung auf `medien` darf nicht
  // entfernbar sein, ohne dass ein Test das bemerkt, ohne sie würfe das
  // `for…of` in Produktion einen TypeError statt einer Fehlermeldung.
  test('eine Antwort mit gültigem gueltig_bis, aber ohne medien-Array wird als Fehlschlag gewertet, nicht als Absturz', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { gueltig_bis: '2026-08-08T13:00:00.000Z', ausgelassen: 0 },
      error: null,
    });
    await expect(holeVorrat('t1')).resolves.toEqual({
      vorrat: null,
      error: 'Die Momente konnten nicht geladen werden. Probier es gleich nochmal.',
      grund: null,
    });
  });

  // Phase-5-Final-Review, Punkt 2: `ausgelassen` ist rein informativ («N
  // Momente liessen sich nicht laden»), anders als `medien`/`gueltig_bis`
  // darf sein Fehlen den Recap nicht am Laden hindern. App (EAS) und Edge
  // Function (`supabase functions deploy`) werden getrennt ausgerollt; ein
  // Rollback oder eine vertauschte Reihenfolge, in der die Function das Feld
  // (noch) nicht sendet, darf aus "ein Hinweistext fehlt" nicht "der ganze
  // Recap lädt nicht" machen.
  test('eine Antwort ohne ausgelassen wird als 0 behandelt, kein Ladefehler', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { medien: [], gueltig_bis: '2026-08-08T13:00:00.000Z' },
      error: null,
    });
    const { vorrat, error } = await holeVorrat('t1');
    expect(error).toBeNull();
    expect(vorrat?.ausgelassen).toBe(0);
  });

  // Gegenprobe zum Test oben: ein TATSÄCHLICH übermittelter Wert (auch 0)
  // wird weiterhin unverändert durchgereicht, `?? 0` darf einen echten Wert
  // nicht überschreiben, ein Mutant, der `antwort.ausgelassen ?? 0` zu
  // `antwort.ausgelassen || 0` verkürzt, würde HIER durchfallen, weil 0
  // bereits falsy ist und beide Schreibweisen für 0 identisch wirken; der
  // eigentliche Unterschied zeigt sich erst bei einem vorhandenen,
  // von 0 verschiedenen Wert wie hier.
  test('ein tatsächlich übermittelter ausgelassen-Wert bleibt unverändert', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { medien: [], gueltig_bis: '2026-08-08T13:00:00.000Z', ausgelassen: 4 },
      error: null,
    });
    const { vorrat, error } = await holeVorrat('t1');
    expect(error).toBeNull();
    expect(vorrat?.ausgelassen).toBe(4);
  });

  // Die beiden 403-Fälle bedeuten Verschiedenes (Reise noch versiegelt vs.
  // Mitgliedschaft mitten im Recap entzogen) und müssen MASCHINENLESBAR
  // unterscheidbar bleiben (Review-Fund, Important 2), nicht nur über den
  // angezeigten Text.
  test('403 «Diese Reise ist noch versiegelt.» wird durchgereicht und als grund "versiegelt" erkannt', async () => {
    mockInvoke.mockResolvedValueOnce(httpFehler(403, { fehler: 'Diese Reise ist noch versiegelt.' }));
    const { vorrat, error, grund } = await holeVorrat('t1');
    expect(vorrat).toBeNull();
    expect(error).toBe('Diese Reise ist noch versiegelt.');
    expect(grund).toBe('versiegelt');
  });

  test('403 «Kein Zugriff auf diese Reise.» wird durchgereicht und als grund "kein_zugriff" erkannt, unterscheidbar von "versiegelt"', async () => {
    mockInvoke.mockResolvedValueOnce(httpFehler(403, { fehler: 'Kein Zugriff auf diese Reise.' }));
    const { vorrat, error, grund } = await holeVorrat('t1');
    expect(vorrat).toBeNull();
    expect(error).toBe('Kein Zugriff auf diese Reise.');
    expect(grund).toBe('kein_zugriff');
    expect(grund).not.toBe('versiegelt');
  });

  // grundAus prüft Status UND Text, nicht nur den Text (Review-Fund,
  // Important 2: derselbe Wortlaut könnte theoretisch auch über einen
  // anderen Statuscode ankommen). Ein Test, der nur die beiden echten
  // 403-Antworten der Function durchspielt, würde eine entfernte
  // Status-Prüfung NICHT bemerken, dieser hier schon: derselbe Text, aber
  // Status 500, darf keinen grund liefern.
  test('derselbe Text bei einem anderen Status als 403 liefert keinen grund', async () => {
    mockInvoke.mockResolvedValueOnce(httpFehler(500, { fehler: 'Diese Reise ist noch versiegelt.' }));
    const { vorrat, error, grund } = await holeVorrat('t1');
    expect(vorrat).toBeNull();
    expect(grund).toBeNull();
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });

  // Review-Fund: der Name-Check auf 'FunctionsHttpError' war durch keinen
  // Test gedeckt, der ihn scharf stellt, ein Fehlerobjekt mit einem
  // ANDEREN Namen, aber demselben Response-Body, darf NICHT als strukturierter
  // 403-Fall durchgehen, sondern muss auf die generische Meldung zurückfallen.
  test('ein Response-Context mit fremdem Fehlernamen wird NICHT als strukturierter 403 behandelt', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('http'), {
        name: 'IrgendeinAndererFehler',
        context: new Response(JSON.stringify({ fehler: 'Diese Reise ist noch versiegelt.' }), { status: 403 }),
      }),
    });
    const { vorrat, error, grund } = await holeVorrat('t1');
    expect(vorrat).toBeNull();
    expect(grund).toBeNull();
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });

  // Minor-Fund: nur die beiden fachlichen 403 werden durchgereicht, jeder
  // andere Statuscode/Text bekommt die generische, lösungsorientierte
  // Meldung (DESIGN-LANGUAGE §6), nicht den rohen Function-Text.
  test('ein HTTP-Fehler ohne verwertbaren Body bekommt eine generische deutsche Meldung', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('http'), {
        name: 'FunctionsHttpError',
        context: new Response('kein json', { status: 500 }),
      }),
    });
    const { vorrat, error, grund } = await holeVorrat('t1');
    expect(vorrat).toBeNull();
    expect(grund).toBeNull();
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });

  test('ein 401/400/500/502-Klartext der Function wird NICHT durchgereicht, sondern durch die generische Meldung ersetzt', async () => {
    mockInvoke.mockResolvedValueOnce(httpFehler(401, { fehler: 'Nicht angemeldet.' }));
    const { error, grund } = await holeVorrat('t1');
    expect(grund).toBeNull();
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });

  test('ein Netzwerkfehler (verschachtelt in context) benennt Offline als Ursache statt der generischen Meldung', async () => {
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

  // Review-Fund: der zweite Offline-Zweig in funktionMeldung (Erkennung
  // direkt über error.message, ohne verschachtelten context) war durch
  // keinen Test allein geprüft, der obige Test wäre auch grün geblieben,
  // hätte man NUR den context-Zweig implementiert.
  test('ein Netzwerkfehler ohne verschachtelten context wird ebenfalls als offline erkannt', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: { message: 'Network request failed' },
    });
    const { vorrat, error } = await holeVorrat('t1');
    expect(vorrat).toBeNull();
    expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('eine leere/kaputte Antwort ohne error wird als Fehlschlag gewertet, nicht als leerer Vorrat', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: null });
    const { vorrat, error, grund } = await holeVorrat('t1');
    expect(vorrat).toBeNull();
    expect(grund).toBeNull();
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });

  test('eine Antwort ohne gueltig_bis wird als Fehlschlag gewertet', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { medien: [], ausgelassen: 0 }, error: null });
    const { vorrat, error } = await holeVorrat('t1');
    expect(vorrat).toBeNull();
    expect(error).toBe('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.');
  });
});
