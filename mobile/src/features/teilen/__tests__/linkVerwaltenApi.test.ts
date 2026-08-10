// Jest-Hoisting: jest.mock wandert über die Importe (Muster wie
// recapApi.test.ts/shareApi.test.ts), Zugriff auf die Mocks deshalb erst
// zur Aufrufzeit.
const mockFrom = jest.fn();
const mockInvoke = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

const ENV_BASIS_URL = 'http://127.0.0.1:8081';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_TEILEN_BASIS_URL = ENV_BASIS_URL;
});

// aktive_share_links: .select(…).eq('trip_id', …).order(…).limit(1).maybeSingle()
//
// Jede Stufe ein eigener jest.fn(), damit die AUFRUF-ARGUMENTE selbst prüfbar
// sind, nicht nur das Endergebnis (Review-Fund-Muster aus recapApi.test.ts:
// ein Mock, der Argumente verschluckt, liesse eine falsche Spalte oder einen
// falschen Filter unbemerkt durch).
//
// Die Kette hat KEIN `.eq('revoked', false)` mehr und der Aufrufer rechnet
// nichts mehr gegen die Uhr: was «trägt» heisst, steht seit Migration
// 20260810120000 in der View. Die Zusicherungen dazu sind damit nicht
// verschwunden, sie sind umgezogen und liegen jetzt in
// supabase/tests/18_recap_ist_geteilt_test.sql, wo sie gegen echtes Postgres
// laufen statt gegen einen Mock, der die Antwort ohnehin vorgibt.
function aktiveLinksKette(ergebnis: { data: unknown; error: unknown }) {
  const maybeSingle = jest.fn(async () => ergebnis);
  const limit = jest.fn(() => ({ maybeSingle }));
  const order = jest.fn(() => ({ limit }));
  const eqTrip = jest.fn(() => ({ order }));
  const select = jest.fn(() => ({ eq: eqTrip }));
  mockFrom.mockReturnValue({ select });
  return { select, eqTrip, order, limit, maybeSingle };
}

const httpFehler = (status: number, body: unknown) => ({
  data: null,
  error: Object.assign(new Error('http'), {
    name: 'FunctionsHttpError',
    context: new Response(JSON.stringify(body), { status }),
  }),
});

import { holeAktivenLink, erstelleLink, istRecapGeteilt, widerrufeLink } from '../linkVerwaltenApi';

describe('holeAktivenLink', () => {
  test('kein Treffer: data ist null, kein Fehler', async () => {
    aktiveLinksKette({ data: null, error: null });
    const { data, error } = await holeAktivenLink('t1');
    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  // Die Kette liest die VIEW, nicht die Tabelle, und filtert nicht mehr selbst
  // auf `revoked`. Das ist die Zusammenführung: dieselbe Regel stand vorher
  // hier UND in `recap_ist_geteilt`, ohne aneinander gebunden zu sein.
  test('liest die View und filtert nicht mehr selbst auf revoked', async () => {
    const { select, eqTrip, order, limit } = aktiveLinksKette({ data: null, error: null });
    await holeAktivenLink('t1');
    expect(mockFrom).toHaveBeenCalledWith('aktive_share_links');
    expect(mockFrom).not.toHaveBeenCalledWith('share_links');
    expect(select).toHaveBeenCalledWith('token, expires_at');
    expect(eqTrip).toHaveBeenCalledWith('trip_id', 't1');
    // Der jüngste zuerst, und genau einer: mehrere gültige Links gleichzeitig
    // sind möglich, das Sheet zeigt aber einen.
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(1);
  });

  test('ein Treffer ohne Ablauf (expires_at null) liefert einen AktiverLink mit gebauter URL', async () => {
    aktiveLinksKette({ data: { token: 'tok123', expires_at: null }, error: null });
    const { data, error } = await holeAktivenLink('t1');
    expect(error).toBeNull();
    expect(data).toEqual({ token: 'tok123', url: `${ENV_BASIS_URL}/teilen/tok123`, expiresAt: null });
  });

  test('ein Treffer mit Ablauf reicht das Datum zur Anzeige durch', async () => {
    const zukunft = new Date(Date.now() + 999_999).toISOString();
    aktiveLinksKette({ data: { token: 'tok1', expires_at: zukunft }, error: null });
    const { data } = await holeAktivenLink('t1');
    expect(data).toEqual({ token: 'tok1', url: `${ENV_BASIS_URL}/teilen/tok1`, expiresAt: zukunft });
  });

  // Die eigentliche Verhaltensänderung, und sie ist eine Verbesserung: die
  // alte Fassung verglich `expires_at` gegen `Date.now()`, also gegen die
  // GERÄTEUHR. Geht das Gerät vor, hielt sie einen tragenden Link für
  // abgelaufen und bot an, einen zweiten zu erstellen. Jetzt entscheidet die
  // Uhr in Postgres, dieselbe, an der auch `share-link/aufloesen` misst.
  //
  // Der Mock liefert hier bewusst eine Zeile, deren Ablauf nach Geräteuhr
  // längst vorbei ist: die alte Fassung hätte sie verworfen, die neue reicht
  // sie durch, weil der Server sie ausgegeben hat.
  test('die Geraeteuhr entscheidet nicht mehr mit, der Server hat entschieden', async () => {
    const langeVorbei = new Date(Date.now() - 86_400_000).toISOString();
    aktiveLinksKette({ data: { token: 'vom-server', expires_at: langeVorbei }, error: null });
    const { data } = await holeAktivenLink('t1');
    expect(data?.token).toBe('vom-server');
  });

  test('ein DB-Fehler wird zu einer deutschen Meldung, kein Absturz', async () => {
    aktiveLinksKette({ data: null, error: { message: 'irgendein Postgres-Fehler' } });
    const { data, error } = await holeAktivenLink('t1');
    expect(data).toBeNull();
    expect(error).toBe('Der Teilen-Link konnte nicht geladen werden. Probier es gleich nochmal.');
  });

  test('ein Netzwerkfehler wird als Offline erkannt', async () => {
    aktiveLinksKette({ data: null, error: { message: 'Network request failed' } });
    const { error } = await holeAktivenLink('t1');
    expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  // Fehlende EXPO_PUBLIC_TEILEN_BASIS_URL: ein gefundener Token liesse sich
  // sonst nur zu einer kaputten/falschen URL zusammenbauen (leerer Prefix),
  // das wäre schlechter als ein ehrlicher Konfigurationsfehler.
  test('ein Treffer OHNE gesetzte EXPO_PUBLIC_TEILEN_BASIS_URL liefert einen Konfigurationsfehler statt einer kaputten URL', async () => {
    delete process.env.EXPO_PUBLIC_TEILEN_BASIS_URL;
    aktiveLinksKette({ data: { token: 'tok1', expires_at: null }, error: null });
    const { data, error } = await holeAktivenLink('t1');
    expect(data).toBeNull();
    expect(error).toBe('Die Teilen-Funktion ist nicht eingerichtet. Wende dich an die Entwicklung.');
  });
});

describe('erstelleLink', () => {
  test('ruft die Function mit aktion "erstellen", trip_id und gueltig_tage auf', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { token: 'tok1', url: `${ENV_BASIS_URL}/teilen/tok1` }, error: null });
    const { data, error } = await erstelleLink('t1', 7);
    expect(error).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith('share-link', {
      body: { aktion: 'erstellen', trip_id: 't1', gueltig_tage: 7 },
    });
    expect(data?.token).toBe('tok1');
    expect(data?.url).toBe(`${ENV_BASIS_URL}/teilen/tok1`);
    // expiresAt ist client-seitig aus gueltigTage berechnet, ~7 Tage voraus.
    expect(data?.expiresAt).not.toBeNull();
    const inTagen = (Date.parse(data!.expiresAt!) - Date.now()) / 86_400_000;
    expect(inTagen).toBeGreaterThan(6.9);
    expect(inTagen).toBeLessThan(7.1);
  });

  test('gueltigTage=null (unbegrenzt) liefert expiresAt=null, ohne das der Function mitzugeben', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { token: 'tok1', url: 'https://x/teilen/tok1' }, error: null });
    const { data } = await erstelleLink('t1', null);
    expect(mockInvoke).toHaveBeenCalledWith('share-link', {
      body: { aktion: 'erstellen', trip_id: 't1', gueltig_tage: null },
    });
    expect(data?.expiresAt).toBeNull();
  });

  test('ein fachlicher Function-Fehler (z.B. 409 "noch versiegelt") wird 1:1 durchgereicht', async () => {
    mockInvoke.mockResolvedValueOnce(httpFehler(409, { fehler: 'Diese Reise ist noch versiegelt.' }));
    const { data, error } = await erstelleLink('t1', 7);
    expect(data).toBeNull();
    expect(error).toBe('Diese Reise ist noch versiegelt.');
  });

  test('eine kaputte 200er-Antwort (fehlendes token/url) zählt als Fehler, kein Absturz', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { token: 'tok1' }, error: null });
    const { data, error } = await erstelleLink('t1', 7);
    expect(data).toBeNull();
    expect(error).toBe('Der Link konnte nicht erstellt werden. Probier es gleich nochmal.');
  });

  test('ein Netzwerkfehler wird als Offline erkannt', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } });
    const { error } = await erstelleLink('t1', 7);
    expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });
});

describe('widerrufeLink', () => {
  test('ruft die Function mit aktion "widerrufen" und token auf', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const { error } = await widerrufeLink('tok1');
    expect(error).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith('share-link', { body: { aktion: 'widerrufen', token: 'tok1' } });
  });

  test('ein fachlicher Function-Fehler (z.B. 404 "gibt es nicht") wird 1:1 durchgereicht', async () => {
    mockInvoke.mockResolvedValueOnce(httpFehler(404, { fehler: 'Diesen Link gibt es nicht.' }));
    const { error } = await widerrufeLink('tok1');
    expect(error).toBe('Diesen Link gibt es nicht.');
  });

  test('eine 200er-Antwort ohne ok:true zählt als Fehler', async () => {
    mockInvoke.mockResolvedValueOnce({ data: {}, error: null });
    const { error } = await widerrufeLink('tok1');
    expect(error).toBe('Der Link konnte nicht deaktiviert werden. Probier es gleich nochmal.');
  });
});

// ===========================================================================
// istRecapGeteilt: die eine Auskunft, die auch Mitreisende bekommen
// ===========================================================================
//
// `holeAktivenLink` oben beantwortet dieselbe Frage, aber nur fuer die
// Owner-Person: die SELECT-Policy auf share_links ist owner-only, und sie
// bleibt es, denn wer die Zeile liest, liest den Token. Diese Funktion geht
// deshalb ueber `public.recap_ist_geteilt`, das nur ja oder nein sagt.
describe('istRecapGeteilt', () => {
  test('fragt die Datenbankfunktion mit der Reise-id, nicht die Tabelle', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const ergebnis = await istRecapGeteilt('t1');

    expect(ergebnis).toEqual({ data: true, error: null });
    expect(mockRpc).toHaveBeenCalledWith('recap_ist_geteilt', { p_trip_id: 't1' });
    // Der Punkt der ganzen Uebung: der Token wird nie gelesen.
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('«nicht geteilt» kommt als false durch', async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    expect(await istRecapGeteilt('t1')).toEqual({ data: false, error: null });
  });

  // Die eine Richtung, in die diese Auskunft nie irren darf: ein Fehler ist
  // NICHT «nicht geteilt». Käme hier `false` heraus, gäbe die App bei jedem
  // Netzhänger eine Entwarnung, die sie nicht geprüft hat.
  test('ein Fehler liefert null, nie false', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'kaputt' } });
    const ergebnis = await istRecapGeteilt('t1');
    expect(ergebnis.data).toBeNull();
    expect(ergebnis.error).toBe('Ob der Recap geteilt ist, liess sich gerade nicht prüfen. Probier es gleich nochmal.');
  });

  test('ein Netzwerkfehler nennt den Offline-Hinweis', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    const ergebnis = await istRecapGeteilt('t1');
    expect(ergebnis.data).toBeNull();
    expect(ergebnis.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  // Die Funktion ist `returns boolean`; alles andere heisst, dass etwas
  // grundlegend anders ist als angenommen, und auch dann gilt: lieber keine
  // Auskunft als eine falsche Entwarnung.
  test('etwas anderes als ein Boolean gilt ebenfalls als unbekannt', async () => {
    for (const wert of [null, undefined, 'ja', 1, {}]) {
      mockRpc.mockResolvedValue({ data: wert, error: null });
      expect((await istRecapGeteilt('t1')).data).toBeNull();
    }
  });

  test('auch eine ganz ausbleibende Antwort kippt nicht auf false', async () => {
    mockRpc.mockResolvedValue(undefined);
    expect((await istRecapGeteilt('t1')).data).toBeNull();
  });
});
