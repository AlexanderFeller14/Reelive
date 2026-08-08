// Unit-Tests für die beiden angemeldeten Aktionen — ohne `supabase start`,
// ohne `functions serve`, ohne Netz, ohne Berechtigung:
//   cd supabase/functions/share-link && npx deno test verwaltung_test.ts
//
// Warum diese Datei existiert: Seit
// 20260808140000_share_links_nur_edge_function.sql hat `authenticated` kein
// Schreibrecht mehr auf share_links. Die Zusicherung «ein Share-Link entsteht
// nur für eine aufgedeckte Reise und nur durch die Owner-Person» (Spec §4, W3,
// erste Hälfte) hatte vorher zwei Träger — die RLS-Policy und die Function.
// Jetzt trägt sie praktisch nur noch die Function. Wäre ihr einziger Beleg der
// Integrationstest mit `ignore: !stackBereit`, wäre W3 auf jeder Maschine ohne
// Docker ungeprüft und der Lauf trotzdem grün.
//
// Belegt:
//   1. beurteileErstellen: Reise fehlt / fremde Reise / versiegelt /
//      archiviert / aufgedeckt — Reihenfolge und Wortlaut.
//   2. berechneAblauf: was als gueltig_tage durchgeht und was nicht.
//   3. beurteileWiderrufen: «gibt es nicht» und «gehört jemand anderem» sind
//      byte-gleich.

import { assertEquals, assertFalse } from 'jsr:@std/assert';
import {
  beurteileErstellen,
  beurteileWiderrufen,
  berechneAblauf,
  type ErstellenTrip,
  MAX_GUELTIG_TAGE,
  type TokenBesitz,
  type VerwaltungsUrteil,
  WIDERRUF_ABLEHNUNG,
} from './verwaltung.ts';

const LEA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const TRIP_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

function trip(status: ErstellenTrip['status'], ownerId = LEA): ErstellenTrip {
  return { id: TRIP_ID, owner_id: ownerId, status };
}

// Was der Aufrufer daraus macht: Status-Code und Body. Auf dieser Ebene muss
// verglichen werden — was zurückgeht, sind Bytes.
function alsHttpAntwort(urteil: VerwaltungsUrteil): string {
  if (urteil.erlaubt) return 'ERLAUBT';
  return `${urteil.status} ${JSON.stringify({ fehler: urteil.nachricht })}`;
}

// ===========================================================================
// erstellen — W3, erste Hälfte
// ===========================================================================

Deno.test('erstellen: für eine versiegelte Reise entsteht kein Link', () => {
  // Der Kern von W3. Ohne diese Zeile wäre ein öffentlicher Link auf eine noch
  // versiegelte Reise erzeugbar — und die Versiegelung ist das ganze Produkt.
  assertEquals(beurteileErstellen(trip('active'), LEA), {
    erlaubt: false,
    nachricht: 'Diese Reise ist noch versiegelt.',
    status: 409,
  });
});

Deno.test('erstellen: für eine archivierte Reise entsteht kein NEUER Link', () => {
  // Spiegelt 20260808130000: Anlegen bleibt revealed-only, Widerrufen geht
  // auch für archiviert. Bestehende Links auf archivierten Reisen lösen sich
  // weiterhin auf (beurteileToken in aufloesung.ts) — «weggelegt ist nicht
  // zugesperrt».
  assertEquals(beurteileErstellen(trip('archived'), LEA), {
    erlaubt: false,
    nachricht: 'Diese Reise ist archiviert. Für sie entsteht kein neuer Link mehr.',
    status: 409,
  });
});

Deno.test('erstellen: nur die Owner-Person, nicht irgendein Mitglied', () => {
  assertEquals(beurteileErstellen(trip('revealed'), BEN), {
    erlaubt: false,
    nachricht: 'Nur wer die Reise angelegt hat, kann den Recap teilen.',
    status: 403,
  });
});

Deno.test('erstellen: der Owner-Check kommt VOR dem Status-Check', () => {
  // Sonst erführe ein Fremder am Fehlertext, in welchem Zustand eine Reise
  // ist, die ihn nichts angeht.
  assertEquals(alsHttpAntwort(beurteileErstellen(trip('active', LEA), BEN)), alsHttpAntwort(beurteileErstellen(trip('revealed', LEA), BEN)));
});

Deno.test('erstellen: unbekannte Reise liefert 404, unabhängig von der anfragenden Person', () => {
  assertEquals(beurteileErstellen(null, LEA), {
    erlaubt: false,
    nachricht: 'Reise nicht gefunden.',
    status: 404,
  });
  assertEquals(beurteileErstellen(null, BEN), {
    erlaubt: false,
    nachricht: 'Reise nicht gefunden.',
    status: 404,
  });
});

Deno.test('erstellen: aufgedeckte eigene Reise wird zugelassen', () => {
  assertEquals(beurteileErstellen(trip('revealed'), LEA), { erlaubt: true });
});

// ===========================================================================
// gueltig_tage
// ===========================================================================

const JETZT = new Date('2026-08-08T12:00:00.000Z');

Deno.test('berechneAblauf: fehlend und null heissen «ohne Ablauf»', () => {
  assertEquals(berechneAblauf(undefined, JETZT), { ok: true, expiresAt: null });
  assertEquals(berechneAblauf(null, JETZT), { ok: true, expiresAt: null });
});

Deno.test('berechneAblauf: ganze Tage werden auf einen Zeitstempel gerechnet', () => {
  assertEquals(berechneAblauf(7, JETZT), { ok: true, expiresAt: '2026-08-15T12:00:00.000Z' });
  assertEquals(berechneAblauf(1, JETZT), { ok: true, expiresAt: '2026-08-09T12:00:00.000Z' });
  assertEquals(berechneAblauf(MAX_GUELTIG_TAGE, JETZT).ok, true);
});

Deno.test('berechneAblauf: alles andere wird abgelehnt, statt still zu einem Invalid Date zu werden', () => {
  // Der gefährliche Fall ist der letzte: `new Date(x)` mit NaN ergibt ein
  // Invalid Date, dessen toISOString() wirft — oder, schlimmer, ein
  // Ablaufdatum, das beurteileToken nicht lesen kann. Deshalb wird hier
  // abgelehnt und nicht gerechnet.
  for (const wert of [0, -1, 1.5, MAX_GUELTIG_TAGE + 1, '7', true, NaN, Infinity, {}, []]) {
    const ergebnis = berechneAblauf(wert, JETZT);
    assertFalse(ergebnis.ok, `${JSON.stringify(wert)} hätte abgelehnt werden müssen`);
  }
});

// ===========================================================================
// widerrufen — kein Orakel
// ===========================================================================

Deno.test('widerrufen: «gibt es nicht» und «gehört jemand anderem» sind byte-gleich', () => {
  const besitz: TokenBesitz = { token: 'abc', trip_id: TRIP_ID, owner_id: LEA };

  const nichtVorhanden = beurteileWiderrufen(null, BEN);
  const fremd = beurteileWiderrufen(besitz, BEN);

  const erwartet = `404 ${JSON.stringify({ fehler: 'Diesen Link gibt es nicht.' })}`;
  assertEquals(alsHttpAntwort(nichtVorhanden), erwartet);
  assertEquals(alsHttpAntwort(fremd), erwartet);
  assertEquals(alsHttpAntwort(nichtVorhanden), alsHttpAntwort(fremd));

  // Wäre das unterschiedlich, liesse sich die Existenz eines Tokens hier
  // abfragen — mit einem beliebigen eigenen Konto — und die byte-gleichen
  // Ablehnungen von `aufloesen` wären umsonst.
});

Deno.test('widerrufen: die Ablehnung lässt sich vom Aufrufer nicht verändern', () => {
  const urteil = beurteileWiderrufen(null, BEN);
  try {
    (urteil as { nachricht: string }).nachricht = 'Dieser Link gehört dir nicht.';
  } catch {
    // Im strict mode wirft die Zuweisung — beides ist recht, solange der Wert
    // danach unverändert ist.
  }
  assertEquals(alsHttpAntwort(beurteileWiderrufen(null, BEN)), alsHttpAntwort(WIDERRUF_ABLEHNUNG));
});

Deno.test('widerrufen: die eigene Zeile wird zugelassen', () => {
  assertEquals(
    beurteileWiderrufen({ token: 'abc', trip_id: TRIP_ID, owner_id: LEA }, LEA),
    { erlaubt: true },
  );
});
