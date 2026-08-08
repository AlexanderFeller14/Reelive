// Die reine Logik von konto-loeschen — die REIHENFOLGE und was in sie
// hineingeht. Kein I/O: kein Deno.serve, kein Supabase-Client, kein Netz.
//
// Muster wie media-urls/lesenZugriff.ts, reveal-trip/reveal.ts und
// share-link/{aufloesung,verwaltung}.ts: die Entscheidung, an der etwas hängt,
// steht als reine Funktion da und wird ohne Docker geprüft (ablauf_test.ts).
// Der Integrationstest ist die zweite Schicht, nie die einzige.
//
// ---------------------------------------------------------------------------
// Warum die Reihenfolge hier die eigentliche Zusicherung ist (Spec §4, W7)
// ---------------------------------------------------------------------------
// Ein Objekt ohne Datenbankzeile ist Müll — niemand kennt seinen Pfad mehr, es
// liegt für immer im Speicher und kostet Geld. Eine Datenbankzeile ohne Objekt
// ist ein kaputter Recap — eine Kachel, die für alle Mitreisenden ins Leere
// lädt. Von den beiden Fehlerrichtungen ist die erste die schlimmere, weil sie
// unsichtbar und unumkehrbar ist.
//
// Also: SPEICHER ZUERST, Datenbank danach. Und scheitert der Speicherschritt —
// auch nur teilweise —, wird die Datenbank GAR NICHT angefasst. Ein Konto, das
// noch existiert, ist besser als eines, dessen Medien verwaist im Speicher
// liegen; und weil das Löschen im Speicher idempotent ist (ein bereits
// gelöschter Schlüssel ist kein Fehler, nachgemessen gegen die Storage-API),
// führt ein zweiter Versuch die Löschung sauber zu Ende, statt einen Rest
// zurückzulassen.

import { erwarteteSchluessel } from '../media-urls/keys.ts';

// ---------------------------------------------------------------------------
// 1. Welche Schlüssel überhaupt weggehören
// ---------------------------------------------------------------------------

export type PostZeile = {
  id: string;
  trip_id: string;
  type: 'photo' | 'video';
  media_ext: string | null;
};

// Medium und Thumbnail jedes übergebenen Moments — ABGELEITET, nie aus
// posts.storage_key übernommen. Derselbe Grund wie in media-urls und
// share-link, hier aber mit umgekehrtem Vorzeichen und deshalb noch
// wichtiger: Dort entscheidet die Ableitung, welches Objekt jemand LESEN
// darf; hier entscheidet sie, welches Objekt GELÖSCHT wird. Ein aus der
// Spalte übernommener Pfad liesse eine Kontolöschung zu einem Werkzeug
// werden, mit dem sich fremde Medien entfernen lassen — storage_key ist
// client-geschrieben (siehe keys.ts).
export function medienSchluessel(posts: PostZeile[]): string[] {
  const schluessel: string[] = [];
  for (const post of posts) {
    const abgeleitet = erwarteteSchluessel(post.trip_id, post.id, post.type, post.media_ext);
    schluessel.push(abgeleitet.storage_key, abgeleitet.thumb_key);
  }
  return schluessel;
}

// ---------------------------------------------------------------------------
// 2. Der Wächter für client-geschriebene Pfad-Spalten
// ---------------------------------------------------------------------------
// `trips.cover_key` und `profiles.avatar_key` sind Textspalten, die ein Client
// frei setzen darf (grant insert/update (…, cover_key, …) on public.trips,
// 20260803090200_membership_rls.sql; avatar_key über das Profil-Update). Für
// sie gibt es KEINE Ableitung wie keys.ts sie für Momente hat — und die
// einzigen Werte, die es heute überhaupt gibt, stehen in supabase/seed.sql und
// sehen so aus: 'covers/norwegen.jpg'. Ein flacher Namensraum ohne jede
// Bindung an einen Eigentümer.
//
// Damit wäre ein blosses "lösch, was in der Spalte steht" ein ernstes Loch:
// Wer 'covers/lissabon.jpg' — die Titelbild-Datei einer fremden Reise — in
// sein eigenes cover_key schreibt und danach sein Konto löscht, löscht das
// fremde Objekt gleich mit. Eine Kontolöschung darf nie ein Werkzeug gegen
// fremde Daten werden.
//
// Deshalb dieser Wächter: Ein solcher Pfad wird nur dann gelöscht, wenn er
// unter einem Präfix liegt, das nachweislich zu dieser Löschung gehört
// (`trips/<eigene trip_id>/` bzw. `profiles/<eigene user_id>/`). Was nicht
// passt, bleibt liegen und wird geloggt — lieber ein verwaistes Objekt als ein
// fremdes gelöschtes. Heute passt nichts, weil kein Codepfad diese Spalten je
// schreibt; sobald ein späteres Feature ein eigentümer-gebundenes Schema
// einführt (das einzige sichere), greift die Löschung von selbst.
export function pfadGehoertUns(key: string | null | undefined, erlaubtePraefixe: string[]): boolean {
  if (typeof key !== 'string' || key.length === 0) return false;
  // Kein Ausbruch nach oben und keine absoluten Pfade, unabhängig vom Präfix.
  if (key.includes('..') || key.startsWith('/')) return false;
  return erlaubtePraefixe.some((praefix) => praefix.length > 0 && key.startsWith(praefix));
}

// ---------------------------------------------------------------------------
// 3. Seitenweise einsammeln
// ---------------------------------------------------------------------------
// PostgREST kappt jede Antwort bei max_rows (supabase/config.toml: 1000) —
// ohne Fehler, ohne Hinweis. Für eine Kontolöschung wiegt das anders als beim
// Lesen: Ein übersehener Moment heisst nicht "der Recap ist kürzer", sondern
// "zwei Objekte bleiben für immer im Speicher liegen, und niemand kennt ihren
// Pfad mehr" — die Datenbankzeile, aus der er sich ableiten liesse, ist dann
// gerade kaskadiert worden.
//
// Dieselbe Schleife wie in share-link/aufloesung.ts (Versatz = "so viele hat
// der Server geliefert", Doubletten-Schutz, zwei Abbruchbedingungen), hier
// bewusst generisch statt importiert: die beiden Functions haben sonst nichts
// miteinander zu tun, und eine gemeinsame Datei zwischen ihnen wäre eine
// Kopplung ohne Gegenwert.
export type SeitenErgebnis<T> = { zeilen: T[]; anzahl: number | null; fehler: unknown };
export type HoleSeiteFn<T> = (von: number, mitZaehlung: boolean) => Promise<SeitenErgebnis<T>>;

export async function sammleAlle<T extends { id: string }>(
  holeSeite: HoleSeiteFn<T>,
): Promise<{ zeilen: T[]; verloren: number; fehler: unknown }> {
  const zeilen: T[] = [];
  const gesehen = new Set<string>();
  let abgeholt = 0;
  let gezaehlt: number | null = null;

  for (;;) {
    const seite = await holeSeite(abgeholt, gezaehlt === null);
    if (seite.fehler) return { zeilen, verloren: 0, fehler: seite.fehler };
    if (gezaehlt === null) gezaehlt = seite.anzahl;

    // Der Versatz wächst am GELIEFERTEN, nie am behaltenen Stand — sonst
    // stünde er bei einer Seite aus lauter Doubletten still (Endlosschleife).
    abgeholt += seite.zeilen.length;
    for (const zeile of seite.zeilen) {
      if (gesehen.has(zeile.id)) continue;
      gesehen.add(zeile.id);
      zeilen.push(zeile);
    }

    if (seite.zeilen.length === 0) break;
    if (gezaehlt !== null && abgeholt >= gezaehlt) break;
  }

  const verloren = gezaehlt === null ? 0 : Math.max(0, gezaehlt - zeilen.length);
  return { zeilen, verloren, fehler: null };
}

// ---------------------------------------------------------------------------
// 4. Die Reihenfolge
// ---------------------------------------------------------------------------

export type Schritt = {
  name: string;
  ausfuehren: () => Promise<{ fehler: unknown }>;
};

export type LoeschErgebnis =
  | { ok: true }
  | { ok: false; gescheitertBei: string; fehler: unknown; datenbankBeruehrt: boolean };

// speicher läuft ZUERST und allein. Erst wenn er ohne Fehler zurückkommt,
// beginnt die Datenbank — und die Schritte darin laufen streng nacheinander,
// jeder erst nach dem vorigen.
//
// Kein Promise.all, nirgends: Die Datenbankschritte hängen voneinander ab
// (`trips.owner_id → profiles.id` ist die einzige on-delete-restrict-Beziehung
// im Schema — der Auth-Nutzer lässt sich erst löschen, wenn die eigenen Reisen
// weg sind), und der Speicherschritt ist die Vorbedingung für alles.
//
// `datenbankBeruehrt` ist Teil des Ergebnisses und nicht nur eine interne
// Variable: Der Aufrufer soll dem Fehler ansehen können, ob ein zweiter
// Versuch auf einem unberührten oder auf einem halb abgeräumten Zustand
// aufsetzt. Beide Wege sind wiederholbar, aber sie erzählen dem Menschen davor
// nicht dasselbe.
export async function fuehreLoeschungAus(
  speicher: Schritt,
  datenbank: Schritt[],
): Promise<LoeschErgebnis> {
  let speicherErgebnis: { fehler: unknown };
  try {
    speicherErgebnis = await speicher.ausfuehren();
  } catch (err) {
    // Eine geworfene Ausnahme ist derselbe Fall wie ein zurückgegebener
    // Fehler: die Datenbank bleibt unberührt. Ohne dieses try/catch liefe der
    // Fehler am Aufrufer vorbei nach oben — was zufällig auch die Datenbank
    // verschonte, aber eben nur zufällig.
    return { ok: false, gescheitertBei: speicher.name, fehler: err, datenbankBeruehrt: false };
  }
  if (speicherErgebnis.fehler) {
    return {
      ok: false,
      gescheitertBei: speicher.name,
      fehler: speicherErgebnis.fehler,
      datenbankBeruehrt: false,
    };
  }

  for (const schritt of datenbank) {
    let ergebnis: { fehler: unknown };
    try {
      ergebnis = await schritt.ausfuehren();
    } catch (err) {
      return { ok: false, gescheitertBei: schritt.name, fehler: err, datenbankBeruehrt: true };
    }
    if (ergebnis.fehler) {
      return { ok: false, gescheitertBei: schritt.name, fehler: ergebnis.fehler, datenbankBeruehrt: true };
    }
  }

  return { ok: true };
}
