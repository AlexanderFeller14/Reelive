// Die reine Logik der beiden ANGEMELDETEN Aktionen, `erstellen` und
// `widerrufen`. Gegenstück zu aufloesung.ts, die den öffentlichen Weg hält.
//
// Eigene Datei, damit aufloesung.ts genau das bleibt, was ihr Kopf verspricht:
// der Weg ohne Anmeldung, in einem Stück lesbar und ohne Verwaltungslogik
// dazwischen.
//
// Warum das überhaupt eine eigene reine Funktion ist und nicht einfach in
// Deno.serve steht: Seit
// supabase/migrations/20260808140000_share_links_nur_edge_function.sql hat
// `authenticated` kein Schreibrecht mehr auf share_links. Die Zusicherung
// «ein Share-Link entsteht nur für eine aufgedeckte Reise und nur durch die
// Owner-Person» (Spec §4, W3, erste Hälfte) hatte davor zwei Träger, die
// RLS-Policy und die Function. Jetzt trägt sie praktisch nur noch die
// Function: `service_role` hat `rolbypassrls`, die Policy wird für sie nie
// ausgewertet, und für `authenticated` gibt es das Privileg nicht mehr.
//
// Eine Zusicherung, die an genau einer Stelle hängt, darf nicht ausschliesslich
// von einem Test abgedeckt sein, der sich ohne Docker selbst überspringt.
// verwaltung_test.ts läuft auf jeder Maschine.

export type TripStatus = 'active' | 'revealed' | 'archived';

export type ErstellenTrip = {
  id: string;
  owner_id: string;
  status: TripStatus;
};

// Wer einen Token widerrufen will: die Zeile samt Eigentümerschaft der
// zugehörigen Reise. `null` heisst «gibt es nicht», und muss von «gehört
// jemand anderem» ununterscheidbar behandelt werden, siehe unten.
export type TokenBesitz = {
  token: string;
  trip_id: string;
  owner_id: string;
};

export type VerwaltungsUrteil =
  | { erlaubt: true }
  | { erlaubt: false; nachricht: string; status: number };

// ---------------------------------------------------------------------------
// erstellen
// ---------------------------------------------------------------------------
// Reihenfolge: Reise existiert → gehört der anfragenden Person → ist
// aufgedeckt. Die Trennung von 404 und 403 ist hier bewusst dieselbe wie in
// reveal-trip (das denselben Owner-Check führt): Sie verrät einer angemeldeten
// Person, dass es eine Reise mit dieser UUID gibt. Das ist bereits die
// bestehende, gereviewte Auskunftslage des Systems, und trip_id ist eine
// UUIDv4, anders als beim öffentlichen `aufloesen`, wo die Ununterscheidbarkeit
// der Ablehnungen die ganze Zusicherung trägt.
export function beurteileErstellen(
  trip: ErstellenTrip | null,
  anfragendeId: string,
): VerwaltungsUrteil {
  if (!trip) {
    return { erlaubt: false, nachricht: 'Reise nicht gefunden.', status: 404 };
  }
  if (trip.owner_id !== anfragendeId) {
    return { erlaubt: false, nachricht: 'Nur wer die Reise angelegt hat, kann den Recap teilen.', status: 403 };
  }
  // Versprechen W3, erste Hälfte: ein Share-Link auf eine nicht aufgedeckte
  // Reise entsteht gar nicht erst. Die zweite Hälfte hält beurteileToken in
  // aufloesung.ts, auch eine irgendwie doch entstandene Zeile löst sich nicht
  // auf.
  if (trip.status === 'active') {
    return { erlaubt: false, nachricht: 'Diese Reise ist noch versiegelt.', status: 409 };
  }
  // 'archived': lesbar bleibt lesbar («weggelegt ist nicht zugesperrt»), aber
  // ein NEUER Link entsteht dafür nicht mehr. Das spiegelt genau die Aufteilung
  // in 20260808130000: Anlegen revealed-only, Widerrufen auch für archiviert.
  if (trip.status !== 'revealed') {
    return { erlaubt: false, nachricht: 'Diese Reise ist archiviert. Für sie entsteht kein neuer Link mehr.', status: 409 };
  }
  return { erlaubt: true };
}

// Obergrenze für `gueltig_tage`. Kein Sicherheitswert, sondern eine
// Plausibilitätsgrenze: ein Link mit 100000 Tagen Laufzeit ist ein Tippfehler,
// kein Wunsch.
export const MAX_GUELTIG_TAGE = 3650;

export type AblaufErgebnis =
  | { ok: true; expiresAt: string | null }
  | { ok: false; nachricht: string };

// `gueltig_tage` fehlend oder null heisst «ohne Ablauf». Alles andere muss eine
// ganze Zahl im erlaubten Bereich sein, insbesondere kein Fliesskommawert und
// keine Zahl aus einem String, die sonst über eine implizite Umwandlung zu
// einem stillen `Invalid Date` würde.
export function berechneAblauf(gueltigTage: unknown, jetzt: Date): AblaufErgebnis {
  if (gueltigTage === undefined || gueltigTage === null) {
    return { ok: true, expiresAt: null };
  }
  if (
    typeof gueltigTage !== 'number' || !Number.isInteger(gueltigTage) ||
    gueltigTage < 1 || gueltigTage > MAX_GUELTIG_TAGE
  ) {
    return { ok: false, nachricht: `gueltig_tage muss eine ganze Zahl zwischen 1 und ${MAX_GUELTIG_TAGE} sein.` };
  }
  return { ok: true, expiresAt: new Date(jetzt.getTime() + gueltigTage * 86_400_000).toISOString() };
}

// ---------------------------------------------------------------------------
// widerrufen
// ---------------------------------------------------------------------------
// EINE Antwort für «Token gibt es nicht» und «Token gehört jemand anderem».
//
// Das ist kein Detail, sondern die Kehrseite der Zusicherung von `aufloesen`:
// Dort geben sich vier Ablehnungen alle Mühe, byte-gleich zu sein, damit sich
// die Existenz eines Tokens nicht abfragen lässt. Wäre `widerrufen` ein Orakel
// («403, gehört dir nicht» gegen «404, gibt es nicht»), liesse sich genau
// diese Auskunft dort holen, mit nichts weiter als einem beliebigen eigenen
// Konto. Die ganze Anstrengung in aufloesung.ts wäre umsonst.
//
// Wie in aufloesung.ts eine einzige gefrorene Konstante statt zweier gleich
// aussehender Literale, und aus demselben Grund.
export const WIDERRUF_ABLEHNUNG: { erlaubt: false; nachricht: string; status: number } = Object.freeze({
  erlaubt: false,
  nachricht: 'Diesen Link gibt es nicht.',
  status: 404,
});

export function beurteileWiderrufen(
  besitz: TokenBesitz | null,
  anfragendeId: string,
): VerwaltungsUrteil {
  if (!besitz) return WIDERRUF_ABLEHNUNG;
  if (besitz.owner_id !== anfragendeId) return WIDERRUF_ABLEHNUNG;
  return { erlaubt: true };
}
