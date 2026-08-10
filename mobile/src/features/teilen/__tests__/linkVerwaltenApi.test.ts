// Jest-Hoisting: jest.mock wandert über die Importe (Muster wie
// recapApi.test.ts/shareApi.test.ts), Zugriff auf die Mocks deshalb erst
// zur Aufrufzeit.
const mockFrom = jest.fn();
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

const ENV_BASIS_URL = 'http://127.0.0.1:8081';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_TEILEN_BASIS_URL = ENV_BASIS_URL;
});

// share_links: .select(...).eq('trip_id', …).eq('revoked', false).order(…),
// jede Stufe ein eigener jest.fn(), damit die AUFRUF-ARGUMENTE selbst
// prüfbar sind, nicht nur das Endergebnis (Review-Fund-Muster aus
// recapApi.test.ts: ein Mock, der Argumente verschluckt, liesse eine falsche
// Spalte/einen falschen Filter unbemerkt durch).
function shareLinksKette(ergebnis: { data: unknown; error: unknown }) {
  const order = jest.fn(async () => ergebnis);
  const eqRevoked = jest.fn(() => ({ order }));
  const eqTrip = jest.fn(() => ({ eq: eqRevoked }));
  const select = jest.fn(() => ({ eq: eqTrip }));
  mockFrom.mockReturnValue({ select });
  return { select, eqTrip, eqRevoked, order };
}

const httpFehler = (status: number, body: unknown) => ({
  data: null,
  error: Object.assign(new Error('http'), {
    name: 'FunctionsHttpError',
    context: new Response(JSON.stringify(body), { status }),
  }),
});

import { holeAktivenLink, erstelleLink, widerrufeLink } from '../linkVerwaltenApi';

describe('holeAktivenLink', () => {
  test('kein Treffer: data ist null, kein Fehler', async () => {
    shareLinksKette({ data: [], error: null });
    const { data, error } = await holeAktivenLink('t1');
    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  test('fragt genau die erwartete Kette ab (Spalten, trip_id, revoked=false)', async () => {
    const { select, eqTrip, eqRevoked } = shareLinksKette({ data: [], error: null });
    await holeAktivenLink('t1');
    expect(mockFrom).toHaveBeenCalledWith('share_links');
    expect(select).toHaveBeenCalledWith('token, expires_at, created_at');
    expect(eqTrip).toHaveBeenCalledWith('trip_id', 't1');
    expect(eqRevoked).toHaveBeenCalledWith('revoked', false);
  });

  test('ein Treffer ohne Ablauf (expires_at null) liefert einen AktiverLink mit gebauter URL', async () => {
    shareLinksKette({
      data: [{ token: 'tok123', expires_at: null, created_at: '2026-08-08T10:00:00.000Z' }],
      error: null,
    });
    const { data, error } = await holeAktivenLink('t1');
    expect(error).toBeNull();
    expect(data).toEqual({ token: 'tok123', url: `${ENV_BASIS_URL}/teilen/tok123`, expiresAt: null });
  });

  test('ein Treffer mit Ablauf in der Zukunft zählt als aktiv', async () => {
    const zukunft = new Date(Date.now() + 999_999).toISOString();
    shareLinksKette({ data: [{ token: 'tok1', expires_at: zukunft, created_at: '2026-08-08T10:00:00.000Z' }], error: null });
    const { data } = await holeAktivenLink('t1');
    expect(data).toEqual({ token: 'tok1', url: `${ENV_BASIS_URL}/teilen/tok1`, expiresAt: zukunft });
  });

  // Kernfall (Brief: "ein abgelaufener Link zählt wie keiner"): die Zeile
  // existiert (revoked=false, RLS liefert sie), ist aber in der Vergangenheit
  // abgelaufen, holeAktivenLink darf sie NICHT als aktiv ausgeben, sonst
  // böte die Sheet einen toten Link zum Teilen an.
  test('ein abgelaufener, aber nicht widerrufener Link zählt wie kein Link', async () => {
    const vergangenheit = new Date(Date.now() - 1000).toISOString();
    shareLinksKette({ data: [{ token: 'alt', expires_at: vergangenheit, created_at: '2026-08-01T10:00:00.000Z' }], error: null });
    const { data, error } = await holeAktivenLink('t1');
    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  // `revoked=false` ist bereits Teil der Abfrage (server-seitig gefiltert),
  // dieser Test hält zusätzlich fest, dass ein GEMISCHTES Ergebnis (ein
  // abgelaufener VOR einem noch gültigen, absteigend nach created_at) den
  // ersten GÜLTIGEN nimmt, nicht einfach zeilen[0].
  test('bei mehreren Zeilen (neuester zuerst) wird der erste GÜLTIGE genommen, nicht zeilen[0] blind', async () => {
    const vergangenheit = new Date(Date.now() - 1000).toISOString();
    const zukunft = new Date(Date.now() + 999_999).toISOString();
    shareLinksKette({
      data: [
        { token: 'neu-aber-abgelaufen', expires_at: vergangenheit, created_at: '2026-08-08T12:00:00.000Z' },
        { token: 'aelter-aber-gueltig', expires_at: zukunft, created_at: '2026-08-01T10:00:00.000Z' },
      ],
      error: null,
    });
    const { data } = await holeAktivenLink('t1');
    expect(data?.token).toBe('aelter-aber-gueltig');
  });

  test('ein DB-Fehler wird zu einer deutschen Meldung, kein Absturz', async () => {
    shareLinksKette({ data: null, error: { message: 'irgendein Postgres-Fehler' } });
    const { data, error } = await holeAktivenLink('t1');
    expect(data).toBeNull();
    expect(error).toBe('Der Teilen-Link konnte nicht geladen werden. Probier es gleich nochmal.');
  });

  test('ein Netzwerkfehler wird als Offline erkannt', async () => {
    shareLinksKette({ data: null, error: { message: 'Network request failed' } });
    const { error } = await holeAktivenLink('t1');
    expect(error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  // Fehlende EXPO_PUBLIC_TEILEN_BASIS_URL: ein gefundener Token liesse sich
  // sonst nur zu einer kaputten/falschen URL zusammenbauen (leerer Prefix),
  // das wäre schlechter als ein ehrlicher Konfigurationsfehler.
  test('ein Treffer OHNE gesetzte EXPO_PUBLIC_TEILEN_BASIS_URL liefert einen Konfigurationsfehler statt einer kaputten URL', async () => {
    delete process.env.EXPO_PUBLIC_TEILEN_BASIS_URL;
    shareLinksKette({ data: [{ token: 'tok1', expires_at: null, created_at: '2026-08-08T10:00:00.000Z' }], error: null });
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
