// Jest-Hoisting: jest.mock wandert über die Importe (gleiches Muster wie
// recapApi.test.ts/urlVorrat.test.ts, supabase.functions.invoke gemockt).
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

import { holeLoeschZahlen, loescheKonto, zahlenText, type LoeschZahlen } from '../kontoApi';

beforeEach(() => {
  jest.clearAllMocks();
});

// Baut einen FunctionsHttpError nach, wie ihn supabase-js/functions-js bei
// einer Nicht-2xx-Antwort tatsächlich liefert: `context` ist eine echte
// Response (gleiches Muster wie recapApi.test.ts/urlVorrat.test.ts).
function httpFehler(status: number, body: unknown) {
  return {
    name: 'FunctionsHttpError',
    context: new Response(JSON.stringify(body), { status }),
  };
}

describe('holeLoeschZahlen', () => {
  const zahlen: LoeschZahlen = {
    eigene_reisen: 3,
    momente_in_eigenen_reisen: 128,
    betroffene_personen: 5,
    eigene_momente_anderswo: 2,
  };

  test('Erfolg: fragt aktion=zahlen ab und liefert die Zahlen unverändert', async () => {
    mockInvoke.mockResolvedValue({ data: zahlen, error: null });
    const ergebnis = await holeLoeschZahlen();
    expect(mockInvoke).toHaveBeenCalledWith('konto-loeschen', { body: { aktion: 'zahlen' } });
    expect(ergebnis).toEqual({ data: zahlen, error: null });
  });

  test('ein fachlicher Fehler (Klartext im Body) wird 1:1 durchgereicht', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpFehler(500, { fehler: 'Die Zahlen konnten nicht ermittelt werden.' }),
    });
    const ergebnis = await holeLoeschZahlen();
    expect(ergebnis.data).toBeNull();
    expect(ergebnis.error).toBe('Die Zahlen konnten nicht ermittelt werden.');
  });

  test('ein Netzwerkfehler → Offline-Hinweis, data bleibt null', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    const ergebnis = await holeLoeschZahlen();
    expect(ergebnis.data).toBeNull();
    expect(ergebnis.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  // Eine unvollständige/kaputte Antwort (fehlendes Feld, falscher Typ) darf
  // NIE als "geladen" durchgehen, genau das ist die Voraussetzung für "ohne
  // geladene Zahlen darf nicht bestätigt werden können" im Dialog.
  test.each([
    ['fehlendes Feld', { eigene_reisen: 1, momente_in_eigenen_reisen: 1, betroffene_personen: 1 }],
    ['falscher Typ', { ...zahlen, eigene_reisen: '3' }],
    ['null', null],
  ])('eine kaputte Antwort (%s) liefert data:null statt geratener Zahlen', async (_label, kaputt) => {
    mockInvoke.mockResolvedValue({ data: kaputt, error: null });
    const ergebnis = await holeLoeschZahlen();
    expect(ergebnis.data).toBeNull();
    expect(ergebnis.error).toBe('Die Zahlen konnten nicht ermittelt werden. Probier es gleich nochmal.');
  });
});

describe('loescheKonto', () => {
  test('Erfolg: ruft aktion=loeschen auf', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
    const ergebnis = await loescheKonto();
    expect(mockInvoke).toHaveBeenCalledWith('konto-loeschen', { body: { aktion: 'loeschen' } });
    expect(ergebnis).toEqual({ error: null });
  });

  // Das zentrale Vertragsdetail aus dem Brief: ein 401 NACH einem
  // Löschversuch ist Erfolg (das Konto existiert bereits nicht mehr), kein
  // Fehler, sonst zeigt die UI im tatsächlichen Erfolgsfall (verlorene
  // Antwort + Wiederholung) fälschlich einen Fehler an.
  test('ein 401 nach dem Löschversuch gilt als Erfolg, nicht als Fehler', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpFehler(401, { fehler: 'Nicht angemeldet.' }) });
    const ergebnis = await loescheKonto();
    expect(ergebnis).toEqual({ error: null });
  });

  test('ein anderer fachlicher Fehler (z.B. 500) bleibt ein echter Fehler mit Klartext', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpFehler(500, { fehler: 'Dein Konto konnte nicht vollständig gelöscht werden. Versuch es später noch einmal.' }),
    });
    const ergebnis = await loescheKonto();
    expect(ergebnis.error).toBe('Dein Konto konnte nicht vollständig gelöscht werden. Versuch es später noch einmal.');
  });

  test('ein Netzwerkfehler (kein HTTP-Status) → Offline-Hinweis, kein falscher Erfolg', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    const ergebnis = await loescheKonto();
    expect(ergebnis.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('ein Fehler ohne verwertbaren Body fällt auf die generische deutsche Meldung zurück', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { name: 'FunctionsHttpError', context: new Response('kaputt', { status: 500 }) } });
    const ergebnis = await loescheKonto();
    expect(ergebnis.error).toBe('Dein Konto konnte nicht vollständig gelöscht werden. Probier es später noch einmal.');
  });
});

describe('zahlenText', () => {
  test('Brief-Beispiel wörtlich: "3 Reisen mit insgesamt 128 Momenten von 5 Personen"', () => {
    const text = zahlenText({
      eigene_reisen: 3, momente_in_eigenen_reisen: 128, betroffene_personen: 5, eigene_momente_anderswo: 0,
    });
    expect(text).toContain('3 Reisen mit insgesamt 128 Momenten von 5 Personen');
  });

  test('Singular bei genau einer Reise/einem Moment/einer Person', () => {
    const text = zahlenText({
      eigene_reisen: 1, momente_in_eigenen_reisen: 1, betroffene_personen: 1, eigene_momente_anderswo: 0,
    });
    expect(text).toContain('1 Reise mit insgesamt 1 Moment von 1 Person verschwindet');
  });

  test('eigene Momente in fremden Reisen werden ZUSÄTZLICH genannt, auch ohne eigene Reisen', () => {
    const text = zahlenText({
      eigene_reisen: 0, momente_in_eigenen_reisen: 0, betroffene_personen: 0, eigene_momente_anderswo: 4,
    });
    expect(text).toContain('4 Momente in fremden Reisen');
    expect(text).not.toContain('Reisen mit insgesamt');
  });

  test('Singular für einen einzelnen Moment anderswo', () => {
    const text = zahlenText({
      eigene_reisen: 0, momente_in_eigenen_reisen: 0, betroffene_personen: 0, eigene_momente_anderswo: 1,
    });
    expect(text).toContain('dein Moment in einer fremden Reise');
  });

  test('beide Sätze zusammen, wenn beides zutrifft', () => {
    const text = zahlenText({
      eigene_reisen: 2, momente_in_eigenen_reisen: 40, betroffene_personen: 3, eigene_momente_anderswo: 5,
    });
    expect(text).toContain('2 Reisen mit insgesamt 40 Momenten von 3 Personen');
    expect(text).toContain('5 Momente in fremden Reisen');
  });

  test('ohne eigene Reisen und ohne Momente anderswo bleibt ein wahrer, nicht leerer Satz', () => {
    const text = zahlenText({
      eigene_reisen: 0, momente_in_eigenen_reisen: 0, betroffene_personen: 0, eigene_momente_anderswo: 0,
    });
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });
});
