// Vorrat an Lese-URLs für den Recap-Player: EIN Aufruf gegen die Edge
// Function `media-urls` (Aktion `lesen`) liefert signierte GET-URLs für ALLE
// hochgeladenen Momente einer Reise auf einmal (Task-Brief). Der Player holt
// sich damit nicht pro Moment eine eigene Signatur, sondern hält einen
// Vorrat, den er selbst auf drohenden Ablauf prüft — das ist die Klammer um
// Versprechen V10: eine abgelaufene URL darf den Recap nie beenden, der
// Player erneuert rechtzeitig im Hintergrund (Task 11, Step 6).
//
// Aufrufweg identisch zu recapApi.revealTrip und postsApi.signierteUrls/
// uploadBestaetigen: supabase.functions.invoke, Fehler kommen entweder als
// FunctionsHttpError mit deutschem Klartext im JSON-Body, oder als
// Netzwerkfehler, der über istOffline erkannt wird.
import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, istOffline } from '@/lib/netzfehler';

export type MedienUrl = { post_id: string; medium_url: string; thumb_url: string | null };
// ausgelassen: Anzahl Momente, für die es keine URL gab (Function liefert
// das Feld seit einer nachträglichen Erweiterung IMMER, auch als 0) — Task
// 11 zeigt daraus «N Momente konnten nicht geladen werden».
export type Vorrat = { urls: Map<string, MedienUrl>; gueltigBis: number; ausgelassen: number };

// Fünf Minuten Vorlauf, bevor eine Lese-URL wirklich abläuft (Brief: die
// Schwelle ist eine benannte Konstante, keine rohe Zahl im Vergleich). Die
// Function signiert für LESE_URL_GUELTIGKEIT_SEKUNDEN = 3600 s (siehe
// supabase/functions/media-urls/index.ts) — fünf Minuten Puffer reichen bei
// dieser Grössenordnung, um vor dem tatsächlichen Ablauf neu zu holen, ohne
// bei jedem zweiten Weitertippen unnötig nachzusignieren. Exportiert, weil
// Task 11 dieselbe Schwelle in seinen eigenen Tests braucht (Review-Fund) —
// ein zweites, wiederholtes Literal dort dürfte nie von diesem hier abweichen.
export const BALD_ABLAUF_SCHWELLE_MS = 5 * 60 * 1000;

// Die beiden fachlichen 403-Texte der Function als geteilte Konstanten
// (Review-Fund, Important 2), statt sie als rohe Stringliterale im Code zu
// verstreuen. `grund` unten wird NUR aus Status 403 UND einem dieser beiden
// exakten Texte hergeleitet — ein DB-Fehler beim Mitgliedschafts-Check der
// Function beantwortet ebenfalls mit «Kein Zugriff auf diese Reise.» und
// Status 403 (supabase/functions/media-urls/index.ts:256-259): serverseitig
// ist der Text allein kein zuverlässiger Unterscheider zwischen "wirklich
// kein Mitglied" und "DB-Ausfall beim Prüfen" — aus Client-Sicht ist das
// aber dieselbe Handlung («kein Zugriff», zurück, ggf. neu versuchen), die
// Function bildet diese Fälle also absichtlich auf denselben Text ab.
const REISE_VERSIEGELT_TEXT = 'Diese Reise ist noch versiegelt.';
const KEIN_ZUGRIFF_TEXT = 'Kein Zugriff auf diese Reise.';

// Strukturierter Grund statt eines rohen String-Vergleichs gegen deutsche
// Copy (Review-Fund, Important 2): Task 11 muss zwischen «zurück auf den
// Versiegelt-Screen» und «du bist nicht mehr Mitglied» entscheiden. Ändert
// die Function ihren Wortlaut, fällt ein reiner Text-Vergleich beim
// Aufrufer still auf "unbekannt" statt auf einen falschen Zweig — `error`
// bleibt trotzdem der Klartext für die Anzeige, `grund` ist zusätzlich die
// maschinenlesbare Verzweigung.
export type Grund = 'versiegelt' | 'kein_zugriff';

function grundAus(status: number, text: string): Grund | null {
  if (status !== 403) return null;
  if (text === REISE_VERSIEGELT_TEXT) return 'versiegelt';
  if (text === KEIN_ZUGRIFF_TEXT) return 'kein_zugriff';
  return null;
}

// Deckt sich mit MedienEintrag in supabase/functions/media-urls/index.ts:
// thumb_url ist dort NUR gesetzt, wenn thumb_key existiert — bei einem
// Moment ohne Thumbnail fehlt das Feld ganz (kein `null`, kein leerer
// String). MedienUrl.thumb_url bildet das als `string | null` ab, die
// Umwandlung passiert unten beim Aufbau der Map.
type MedienEintrag = { post_id: string; medium_url: string; thumb_url?: string };
type LeseAntwort = { medien: MedienEintrag[]; gueltig_bis: string; ausgelassen: number };

// functions-js ersetzt einen echten Netzwerkfehler durch einen festen
// englischen Satz und legt die ursprüngliche Fetch-Fehlermeldung in
// `context` ab (siehe ausführlicher Kommentar in postsApi.ts) — beide
// Stellen müssen geprüft werden, bevor auf die generische Meldung
// zurückgefallen wird. Gleiches Muster wie recapApi.ts.
function funktionMeldung(error: unknown, sonst: string): string {
  const err = error as { message?: string; context?: { message?: string } } | null;
  if (istOffline({ message: err?.context?.message })) return OFFLINE_HINT;
  return istOffline(err ?? null) ? OFFLINE_HINT : sonst;
}

const LADEFEHLER = 'Die Momente konnten nicht geladen werden. Probier es gleich nochmal.';

export async function holeVorrat(
  tripId: string
): Promise<{ vorrat: Vorrat | null; error: string | null; grund: Grund | null }> {
  const { data, error } = await supabase.functions.invoke('media-urls', {
    body: { aktion: 'lesen', trip_id: tripId },
  });

  if (error) {
    // Nur die beiden fachlichen 403 (Versiegelung, Mitgliedschaft) werden
    // 1:1 durchgereicht — sie nennen Ursache UND die einzig mögliche
    // "Lösung" (warten bzw. zurück, DESIGN-LANGUAGE §6). Alles andere, was
    // dieselbe Function sonst noch liefert (400 «trip_id fehlt.», 401 «Nicht
    // angemeldet.», 500 «Server nicht konfiguriert.», 502 «Signieren
    // fehlgeschlagen.» — supabase/functions/media-urls/index.ts) ist
    // Technik-Text ohne Lösung und nicht in Du-Form (Review-Fund, Minor):
    // dafür bleibt LADEFEHLER unten die richtige, konsistente Antwort.
    const httpFehler = error as { name?: string; context?: unknown };
    if (httpFehler?.name === 'FunctionsHttpError' && httpFehler.context instanceof Response) {
      const status = httpFehler.context.status;
      try {
        const body = (await httpFehler.context.clone().json()) as { fehler?: string };
        const grund = typeof body.fehler === 'string' ? grundAus(status, body.fehler) : null;
        if (grund) return { vorrat: null, error: body.fehler as string, grund };
      } catch {
        // Antwort war kein JSON — generische Meldung unten.
      }
    }
    return { vorrat: null, error: funktionMeldung(error, LADEFEHLER), grund: null };
  }

  // Review-Fund, Important 1: `Date.parse` liefert für einen unparsbaren
  // gueltig_bis-Wert NaN, statt zu werfen. Ungeprüft durchgereicht würde das
  // laeuftBaldAb NIE mehr "true" liefern können (siehe dort) — die Function
  // würde also NIE erneut aufgerufen, bis jede URL wirklich abgelaufen ist.
  // Das ist exakt das Ende, das Versprechen V10 verbietet. Ein kaputter Wert
  // zählt deshalb schon hier als Ladefehler, nicht erst beim Ablauf-Check.
  const antwort = data as Partial<LeseAntwort> | null;
  const gueltigBis = typeof antwort?.gueltig_bis === 'string' ? Date.parse(antwort.gueltig_bis) : NaN;
  if (
    !antwort ||
    !Array.isArray(antwort.medien) ||
    Number.isNaN(gueltigBis) ||
    typeof antwort.ausgelassen !== 'number'
  ) {
    return { vorrat: null, error: LADEFEHLER, grund: null };
  }

  const urls = new Map<string, MedienUrl>();
  for (const eintrag of antwort.medien) {
    urls.set(eintrag.post_id, {
      post_id: eintrag.post_id,
      medium_url: eintrag.medium_url,
      thumb_url: eintrag.thumb_url ?? null,
    });
  }

  return { vorrat: { urls, gueltigBis, ausgelassen: antwort.ausgelassen }, error: null, grund: null };
}

// true, sobald weniger als BALD_ABLAUF_SCHWELLE_MS bis gueltigBis übrig
// sind (auch wenn der Vorrat bereits abgelaufen ist — eine negative
// Restzeit ist erst recht "bald ab").
//
// Review-Fund, Important 1: bewusst als VERNEINTE `>=`-Prüfung geschrieben,
// nicht als `< BALD_ABLAUF_SCHWELLE_MS`. holeVorrat fängt ein unparsbares
// gueltig_bis zwar bereits beim Einlesen ab (siehe dort) — trifft `gueltigBis`
// hier trotzdem einmal NaN (z.B. ein Vorrat, der nicht über holeVorrat
// entstanden ist), ist JEDER Vergleich mit NaN laut IEEE 754 false. Mit der
// ursprünglichen Form `NaN - jetzt < SCHWELLE` wäre das Ergebnis `false` —
// "läuft nie bald ab", das exakte Gegenteil von Versprechen V10. Die
// verneinte Form kippt denselben NaN-Fall auf `true` ("erneuern") um: auch
// `NaN >= SCHWELLE` ist `false`, verneint also `true` — im Zweifel erneuert
// der Player lieber einmal zu oft, statt den Recap stumm zu beenden.
export function laeuftBaldAb(vorrat: Vorrat, jetzt: number): boolean {
  return !(vorrat.gueltigBis - jetzt >= BALD_ABLAUF_SCHWELLE_MS);
}
