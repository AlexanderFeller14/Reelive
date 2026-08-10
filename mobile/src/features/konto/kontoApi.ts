// Account-Löschung (Task 9, Phase 6). Ruft die Edge Function `konto-loeschen`
// auf (fertig und geprüft, siehe supabase/functions/konto-loeschen/), hier
// entsteht kein neues Schema, nur der Aufrufweg. Gleiches Muster wie
// recapApi.revealTrip/urlVorrat.holeVorrat: supabase.functions.invoke, Fehler
// kommen entweder als FunctionsHttpError mit deutschem Klartext im
// JSON-Body, oder als Netzwerkfehler, der über istOffline erkannt wird.
import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, istOffline } from '@/lib/netzfehler';

type Gelesen<T> = { data: T; error: string | null };

function meldung(error: { message?: string } | null, sonst: string): string {
  return istOffline(error) ? OFFLINE_HINT : sonst;
}

// functions-js ersetzt einen echten Netzwerkfehler durch einen festen
// englischen Satz und legt die ursprüngliche Fetch-Fehlermeldung in
// `context` ab, beide Stellen müssen geprüft werden, bevor auf die
// generische Meldung zurückgefallen wird (gleiches Muster wie recapApi.ts/
// urlVorrat.ts).
function funktionMeldung(error: unknown, sonst: string): string {
  const err = error as { message?: string; context?: { message?: string } } | null;
  if (istOffline({ message: err?.context?.message })) return OFFLINE_HINT;
  return meldung(err ?? null, sonst);
}

// Der HTTP-Status eines FunctionsHttpError, falls die Function wirklich
// geantwortet hat (nicht bloss ein Netzwerkfehler), `loescheKonto` braucht
// GENAU diesen Status, um 401-nach-Löschung von jedem anderen Fehler zu
// unterscheiden (siehe dort).
function funktionsStatus(error: unknown): number | null {
  const httpFehler = error as { name?: string; context?: unknown } | null;
  if (httpFehler?.name === 'FunctionsHttpError' && httpFehler.context instanceof Response) {
    return httpFehler.context.status;
  }
  return null;
}

// Der deutsche Klartext aus dem JSON-Body eines FunctionsHttpError, falls
// vorhanden, sonst `null` (Aufrufer fällt dann auf die generische Meldung
// zurück). Eigene Funktion statt Inline-try/catch an jeder Aufrufstelle
// (gleiches Wiederverwendungsprinzip wie funktionMeldung).
async function funktionsKlartext(error: unknown): Promise<string | null> {
  const httpFehler = error as { name?: string; context?: unknown } | null;
  if (httpFehler?.name === 'FunctionsHttpError' && httpFehler.context instanceof Response) {
    try {
      const body = (await httpFehler.context.clone().json()) as { fehler?: string };
      if (typeof body.fehler === 'string') return body.fehler;
    } catch {
      // Antwort war kein JSON, null, Aufrufer fällt zurück.
    }
  }
  return null;
}

// Deckt sich mit der Antwort der Function bei `{ aktion: 'zahlen' }`
// (supabase/functions/konto-loeschen/index.ts). `betroffene_personen` zählt
// bereits OHNE die anfragende Person selbst (store.ts, `zaehle`),
// `zahlenText` unten muss das nicht mehr korrigieren.
export type LoeschZahlen = {
  eigene_reisen: number;
  momente_in_eigenen_reisen: number;
  betroffene_personen: number;
  eigene_momente_anderswo: number;
};

const ZAHLEN_FEHLER = 'Die Zahlen konnten nicht ermittelt werden. Probier es gleich nochmal.';

// Holt, was der Löschdialog anzeigen MUSS, bevor überhaupt bestätigt werden
// kann (Brief: "Ohne geladene Zahlen darf nicht bestätigt werden können."),
// `data: null` bei jedem Fehler, nie eine geratene/leere Zahlenstruktur, die
// ein Aufrufer versehentlich als "geladen" durchgehen lassen könnte.
export async function holeLoeschZahlen(): Promise<Gelesen<LoeschZahlen | null>> {
  const { data, error } = await supabase.functions.invoke('konto-loeschen', {
    body: { aktion: 'zahlen' },
  });
  if (error) {
    const klartext = await funktionsKlartext(error);
    return { data: null, error: klartext ?? funktionMeldung(error, ZAHLEN_FEHLER) };
  }
  const zahlen = data as Partial<LoeschZahlen> | null;
  if (
    !zahlen ||
    typeof zahlen.eigene_reisen !== 'number' ||
    typeof zahlen.momente_in_eigenen_reisen !== 'number' ||
    typeof zahlen.betroffene_personen !== 'number' ||
    typeof zahlen.eigene_momente_anderswo !== 'number'
  ) {
    return { data: null, error: ZAHLEN_FEHLER };
  }
  return {
    data: {
      eigene_reisen: zahlen.eigene_reisen,
      momente_in_eigenen_reisen: zahlen.momente_in_eigenen_reisen,
      betroffene_personen: zahlen.betroffene_personen,
      eigene_momente_anderswo: zahlen.eigene_momente_anderswo,
    },
    error: null,
  };
}

const LOESCHEN_FEHLER = 'Dein Konto konnte nicht vollständig gelöscht werden. Probier es später noch einmal.';

// Löst die Löschung aus. **Vertragsdetail (Task-9-Brief, wörtlich):** Geht
// die Erfolgsantwort auf dem Rückweg verloren und dieser Aufruf wiederholt
// sich (z.B. ein erneuter Tipp nach einem Timeout), antwortet die Function
// beim zweiten Versuch mit 401, das Konto (und damit der Nutzer hinter dem
// JWT) existiert dann bereits nicht mehr (supabaseAdmin.auth.getUser scheitert
// für ein gelöschtes Konto). Ein 401 NACH einem Löschversuch ist darum Erfolg,
// nicht Fehler, sonst zeigt die UI im tatsächlichen Erfolgsfall einen
// Fehler an. Jeder ANDERE Status bleibt ein echter Fehler.
export async function loescheKonto(): Promise<{ error: string | null }> {
  const { error } = await supabase.functions.invoke('konto-loeschen', {
    body: { aktion: 'loeschen' },
  });
  if (!error) return { error: null };
  if (funktionsStatus(error) === 401) return { error: null };
  const klartext = await funktionsKlartext(error);
  return { error: klartext ?? funktionMeldung(error, LOESCHEN_FEHLER) };
}

// Reine Textbausteine (kein IO), separat testbar, keine eigene Datei nötig
// für zwei kleine Sätze. `betroffene_personen` zählt bereits ohne die
// anfragende Person (siehe LoeschZahlen oben).
function eigeneReisenSatz(z: LoeschZahlen): string {
  const reiseWort = z.eigene_reisen === 1 ? 'Reise' : 'Reisen';
  const momentWort = z.momente_in_eigenen_reisen === 1 ? 'Moment' : 'Momenten';
  const personenWort = z.betroffene_personen === 1 ? 'Person' : 'Personen';
  const verb = z.eigene_reisen === 1 ? 'verschwindet' : 'verschwinden';
  return (
    `${z.eigene_reisen} ${reiseWort} mit insgesamt ${z.momente_in_eigenen_reisen} ${momentWort} von ` +
    `${z.betroffene_personen} ${personenWort} ${verb} unwiederbringlich, auch für alle anderen.`
  );
}

function eigeneMomenteAnderswoSatz(anzahl: number): string {
  return anzahl === 1
    ? 'Ausserdem geht dein Moment in einer fremden Reise verloren.'
    : `Ausserdem gehen deine ${anzahl} Momente in fremden Reisen verloren.`;
}

// Der Dialogtext, "muss die Wahrheit sagen" (Brief, wörtlich): nennt IMMER
// die konkreten Zahlen, wenn welche zutreffen, statt einer beschönigenden
// Pauschalformulierung. Ohne eigene Reisen UND ohne eigene Momente anderswo
// bleibt nur die nackte Kontolöschung selbst zu sagen.
export function zahlenText(zahlen: LoeschZahlen): string {
  const saetze: string[] = [];
  if (zahlen.eigene_reisen > 0) saetze.push(eigeneReisenSatz(zahlen));
  if (zahlen.eigene_momente_anderswo > 0) saetze.push(eigeneMomenteAnderswoSatz(zahlen.eigene_momente_anderswo));
  if (saetze.length === 0) return 'Dein Konto und dein Profil werden endgültig gelöscht.';
  return saetze.join(' ');
}
