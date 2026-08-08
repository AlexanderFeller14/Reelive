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
export type Vorrat = { urls: Map<string, MedienUrl>; gueltigBis: number };

// Fünf Minuten Vorlauf, bevor eine Lese-URL wirklich abläuft (Brief: die
// Schwelle ist eine benannte Konstante, keine rohe Zahl im Vergleich). Die
// Function signiert für LESE_URL_GUELTIGKEIT_SEKUNDEN = 3600 s (siehe
// supabase/functions/media-urls/index.ts) — fünf Minuten Puffer reichen bei
// dieser Grössenordnung, um vor dem tatsächlichen Ablauf neu zu holen, ohne
// bei jedem zweiten Weitertippen unnötig nachzusignieren.
const BALD_ABLAUF_SCHWELLE_MS = 5 * 60 * 1000;

// Deckt sich mit MedienEintrag in supabase/functions/media-urls/index.ts:
// thumb_url ist dort NUR gesetzt, wenn thumb_key existiert — bei einem
// Moment ohne Thumbnail fehlt das Feld ganz (kein `null`, kein leerer
// String). MedienUrl.thumb_url bildet das als `string | null` ab, die
// Umwandlung passiert unten beim Aufbau der Map.
type MedienEintrag = { post_id: string; medium_url: string; thumb_url?: string };
type LeseAntwort = { medien: MedienEintrag[]; gueltig_bis: string };

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

export async function holeVorrat(tripId: string): Promise<{ vorrat: Vorrat | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('media-urls', {
    body: { aktion: 'lesen', trip_id: tripId },
  });

  if (error) {
    // Die Function liefert bei einem HTTP-Fehler ihren deutschen Klartext im
    // Response-Body mit — der landet über FunctionsHttpError im `context`
    // (gleiches Muster wie revealTrip in recapApi.ts). Dazu gehören die
    // zwei zu unterscheidenden 403-Fälle: «Diese Reise ist noch versiegelt.»
    // (noch nicht aufgedeckt) und «Kein Zugriff auf diese Reise.» (Mitglied-
    // schaft mitten im Recap entzogen) — beide werden hier unverändert
    // durchgereicht, die Unterscheidung steckt bereits im Text der Function.
    const httpFehler = error as { name?: string; context?: unknown };
    if (httpFehler?.name === 'FunctionsHttpError' && httpFehler.context instanceof Response) {
      try {
        const body = (await httpFehler.context.clone().json()) as { fehler?: string };
        if (typeof body.fehler === 'string') return { vorrat: null, error: body.fehler };
      } catch {
        // Antwort war kein JSON — generische Meldung unten.
      }
    }
    return { vorrat: null, error: funktionMeldung(error, LADEFEHLER) };
  }

  const antwort = data as LeseAntwort | null;
  if (!antwort || !Array.isArray(antwort.medien) || typeof antwort.gueltig_bis !== 'string') {
    return { vorrat: null, error: LADEFEHLER };
  }

  const urls = new Map<string, MedienUrl>();
  for (const eintrag of antwort.medien) {
    urls.set(eintrag.post_id, {
      post_id: eintrag.post_id,
      medium_url: eintrag.medium_url,
      thumb_url: eintrag.thumb_url ?? null,
    });
  }

  return { vorrat: { urls, gueltigBis: Date.parse(antwort.gueltig_bis) }, error: null };
}

// true, sobald weniger als BALD_ABLAUF_SCHWELLE_MS bis gueltigBis übrig
// sind (auch wenn der Vorrat bereits abgelaufen ist — eine negative
// Restzeit ist erst recht "bald ab").
export function laeuftBaldAb(vorrat: Vorrat, jetzt: number): boolean {
  return vorrat.gueltigBis - jetzt < BALD_ABLAUF_SCHWELLE_MS;
}
