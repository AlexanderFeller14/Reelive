// Zweiter, öffentlicher Leseweg auf einen Recap (Task-5-Brief, Task-2-Brief
// der Gegenstelle): die Edge Function `share-link`, Aktion `aufloesen`,
// braucht KEIN JWT. Aufrufweg identisch zu recapApi.ts/urlVorrat.ts —
// supabase.functions.invoke, Fehler kommen entweder als FunctionsHttpError
// mit deutschem Klartext im JSON-Body, oder als Netzwerkfehler, der über
// istOffline erkannt wird.
//
// W4 (Spec-Versprechen): der Web-Player kann nichts schreiben. Diese Datei
// ruft AUSSCHLIESSLICH supabase.functions.invoke('share-link', { aktion:
// 'aufloesen' }) auf — kein .from(), kein .rpc(), kein .auth. Das ist hier
// per Test belegt (Spione auf dem gesamten Client, siehe shareApi.test.ts),
// und für den GANZEN Screen zusätzlich statisch über den Modulgraph
// (mobile/src/app/teilen/__tests__/modulgraph.test.ts) — nicht nur behauptet.
import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, istOffline } from '@/lib/netzfehler';

export type GeteiltesMoment = {
  post_id: string;
  autor_name: string;
  type: 'photo' | 'video';
  captured_at: string;
  captured_tz: string;
  place_name: string | null;
  caption: string | null;
  duration_s: number | null;
  medium_url: string;
  thumb_url: string | null;
};

export type GeteilterRecap = {
  reise: { name: string; start_date: string; end_date: string };
  medien: GeteiltesMoment[];
  gueltigBis: number;
};

// Gleiches Muster wie recapApi.ts/urlVorrat.ts/tripsApi.ts: Gelesen<T> ist
// dort jeweils NICHT exportiert — jede Datei bekommt ihre eigene lokale
// Definition. `data: GeteilterRecap | null` statt `Gelesen<GeteilterRecap>`
// (Abweichung vom Interface-Wortlaut im Task-Brief, siehe Bericht): ein
// abgelehnter/kaputter Token hat keinen sinnvollen "leeren" GeteilterRecap-
// Wert — dieselbe Form wie tripsApi.fetchTrip (`Gelesen<Trip | null>`), wo
// `data === null` bei `error === null` nie vorkommt (hier: `data` ist genau
// dann `null`, wenn `error` gesetzt ist).
type Gelesen<T> = { data: T; error: string | null };

// Die Function macht die vier Ablehnungen (unbekannt, widerrufen, abgelaufen,
// nicht aufgedeckt) laut Vertrag byte-gleich — kein Orakel. Dieser Client
// verstärkt das: er liest den Klartext der Function bei einem Fehler GAR
// NICHT erst, sondern bildet JEDEN HTTP-Fehler dieser Aktion auf denselben
// Satz ab, ohne Fallunterscheidung. Nur ein echter Netzwerkausfall (kein
// Kontakt zur Function) bekommt eine andere Meldung — das ist eine andere
// Ursache mit einer anderen Lösung ("verbinde dich"), kein Hinweis auf den
// Token selbst.
export const LINK_TOT_TEXT = 'Dieser Link funktioniert nicht mehr.';
const LADEFEHLER = 'Der Recap konnte nicht geladen werden. Probier es gleich nochmal.';

// functions-js ersetzt einen echten Netzwerkfehler durch einen festen
// englischen Satz und legt die ursprüngliche Fetch-Fehlermeldung in
// `context` ab — beide Stellen müssen geprüft werden (gleiches Muster wie
// recapApi.ts/urlVorrat.ts).
function funktionMeldung(error: unknown, sonst: string): string {
  const err = error as { message?: string; context?: { message?: string } } | null;
  if (istOffline({ message: err?.context?.message })) return OFFLINE_HINT;
  return istOffline(err ?? null) ? OFFLINE_HINT : sonst;
}

type MedienEintrag = {
  post_id: string;
  autor_name: string;
  type: 'photo' | 'video';
  captured_at: string;
  captured_tz: string;
  place_name: string | null;
  caption: string | null;
  duration_s: number | null;
  medium_url: string;
  thumb_url?: string; // nur gesetzt, wenn ein Thumbnail existiert (Vertrag, siehe media-urls-Vorbild)
};
type AufloeseAntwort = {
  reise: { name: string; start_date: string; end_date: string };
  medien: MedienEintrag[];
  gueltig_bis: string;
};

export async function loeseTokenAuf(token: string): Promise<Gelesen<GeteilterRecap | null>> {
  const { data, error } = await supabase.functions.invoke('share-link', {
    body: { aktion: 'aufloesen', token },
  });

  if (error) {
    return { data: null, error: funktionMeldung(error, LINK_TOT_TEXT) };
  }

  // Defensive Formprüfung wie holeVorrat (urlVorrat.ts): App und Edge
  // Function werden getrennt ausgerollt, eine unerwartete/kaputte 200er-
  // Antwort darf nicht zum Absturz führen, sondern zählt als Ladefehler.
  const antwort = data as Partial<AufloeseAntwort> | null;
  const gueltigBis = typeof antwort?.gueltig_bis === 'string' ? Date.parse(antwort.gueltig_bis) : NaN;
  const reise = antwort?.reise;
  if (
    !antwort ||
    !reise ||
    typeof reise.name !== 'string' ||
    typeof reise.start_date !== 'string' ||
    typeof reise.end_date !== 'string' ||
    !Array.isArray(antwort.medien) ||
    Number.isNaN(gueltigBis)
  ) {
    return { data: null, error: LADEFEHLER };
  }

  const medien: GeteiltesMoment[] = antwort.medien.map((m) => ({
    post_id: m.post_id,
    autor_name: m.autor_name,
    type: m.type,
    captured_at: m.captured_at,
    captured_tz: m.captured_tz,
    place_name: m.place_name,
    caption: m.caption,
    duration_s: m.duration_s,
    medium_url: m.medium_url,
    thumb_url: m.thumb_url ?? null,
  }));

  return {
    data: { reise: { name: reise.name, start_date: reise.start_date, end_date: reise.end_date }, medien, gueltigBis },
    error: null,
  };
}
