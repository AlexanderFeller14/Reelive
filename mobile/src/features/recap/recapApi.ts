import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, istOffline } from '@/lib/netzfehler';
import { sortiereMomente } from './tage';
import type { RecapMoment } from './types';

// Gleiches Muster wie tripsApi.ts/postsApi.ts: Daten und Fehler getrennt
// zurückgeben, damit ein leeres Array nie mit «wirklich leer» verwechselt
// wird (Gelesen<T> ist dort nicht exportiert, jede Datei bekommt ihre eigene
// lokale Definition derselben Form, kein zweiter Import-Umweg für zwei Felder).
type Gelesen<T> = { data: T; error: string | null };

function meldung(error: { message?: string } | null, sonst: string): string {
  return istOffline(error) ? OFFLINE_HINT : sonst;
}

// functions-js ersetzt einen echten Netzwerkfehler durch einen festen
// englischen Satz und legt die ursprüngliche Fetch-Fehlermeldung in
// `context` ab (siehe ausführlicher Kommentar in postsApi.ts), beide
// Stellen müssen geprüft werden, bevor auf die generische Meldung
// zurückgefallen wird.
function funktionMeldung(error: unknown, sonst: string): string {
  const err = error as { message?: string; context?: { message?: string } } | null;
  if (istOffline({ message: err?.context?.message })) return OFFLINE_HINT;
  return meldung(err ?? null, sonst);
}

// `profiles!posts_author_id_fkey` statt nur `profiles`: zwischen `posts` und
// `profiles` gibt es ZWEI Wege, der direkte über `posts.author_id` und ein
// many-to-many über `reactions` (post_id/user_id). PostgREST verweigert eine
// mehrdeutige Einbettung mit HTTP 300 (PGRST201) und liefert gar keine Daten.
//
// Gefunden erst beim Durchspielen der laufenden App: der Recap zeigte
// «Die Momente konnten nicht geladen werden», für jede Reise, für jede
// Person. Kein Test hat es gesehen, weil alle den Supabase-Client mocken und
// der Mock die Abfrage nie wirklich stellt. Wer den Namen hier kürzt, bricht
// den Recap vollständig.
const SPALTEN = [
  'id', 'trip_id', 'author_id', 'type', 'duration_s', 'caption',
  'captured_at', 'captured_tz', 'place_name', 'lat', 'lng', 'upload_status',
  'profiles!posts_author_id_fkey(display_name)',
].join(', ');

type PostRow = Omit<RecapMoment, 'autor_name'> & {
  profiles: { display_name: string } | null;
};

// Liest alle Momente einer Reise inklusive Autorenname in EINEM Aufruf (kein
// N+1, Brief), profiles(display_name) hängt am author_id-Fremdschlüssel,
// analog zu trip_members(profiles(display_name)) in tripsApi.fetchMembers.
//
// Läuft nur nach dem Reveal: posts_select_revealed_members lässt Mitglieder
// erst lesen, wenn trips.status in ('revealed', 'archived') ist, vorher
// liefert die Abfrage eine leere Liste ohne Fehler (RLS filtert, wirft
// nicht). Das ist hier kein Sonderfall, den diese Funktion behandeln müsste.
export async function fetchRecapMomente(tripId: string): Promise<Gelesen<RecapMoment[]>> {
  const { data, error } = await supabase.from('posts').select(SPALTEN).eq('trip_id', tripId);
  if (error || !data) {
    return {
      data: [],
      error: meldung(error, 'Die Momente konnten nicht geladen werden. Probier es gleich nochmal.'),
    };
  }
  // `unknown` als Zwischenschritt: Ohne generischen Database-Typ am Client
  // inferiert postgrest-js profiles(...) als Array statt als Einzelobjekt
  // (gleicher Grund wie TripRow in tripsApi.ts). Laufzeit unverändert.
  const momente = (data as unknown as PostRow[]).map((row) => ({
    id: row.id,
    trip_id: row.trip_id,
    author_id: row.author_id,
    type: row.type,
    duration_s: row.duration_s,
    caption: row.caption,
    captured_at: row.captured_at,
    captured_tz: row.captured_tz,
    place_name: row.place_name,
    lat: row.lat,
    lng: row.lng,
    upload_status: row.upload_status,
    autor_name: row.profiles?.display_name ?? '',
  }));
  // Sortierung IMMER über tage.sortiereMomente (CLAUDE.md-Eckpfeiler:
  // captured_at aufsteigend, id als stabiles zweites Kriterium), bewusst
  // OHNE zusätzliches .order() auf der Abfrage selbst, damit diese Garantie
  // an genau einer Stelle steht und unabhängig vom DB-Ausführungsplan
  // nachweisbar bleibt (Task-5-Brief).
  return { data: sortiereMomente(momente), error: null };
}

// Ruft die Edge Function aus Task 2 auf. Sie ist idempotent, ein Wiederholen
// nach einem Netzfehler ist immer erlaubt, es gibt hier nichts zu sperren.
export async function revealTrip(
  tripId: string
): Promise<{ revealed_at: string | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('reveal-trip', {
    body: { trip_id: tripId },
  });
  if (error) {
    // Die Function liefert bei einem HTTP-Fehler ihren deutschen Klartext im
    // Response-Body mit, der landet über FunctionsHttpError im `context`
    // (gleiches Muster wie uploadBestaetigen in postsApi.ts).
    const httpFehler = error as { name?: string; context?: unknown };
    if (httpFehler?.name === 'FunctionsHttpError' && httpFehler.context instanceof Response) {
      try {
        const body = (await httpFehler.context.clone().json()) as { fehler?: string };
        if (typeof body.fehler === 'string') return { revealed_at: null, error: body.fehler };
      } catch {
        // Antwort war kein JSON, generische Meldung unten.
      }
    }
    return {
      revealed_at: null,
      error: funktionMeldung(error, 'Die Reise konnte nicht abgeschlossen werden. Probier es gleich nochmal.'),
    };
  }
  const ergebnis = data as { ok?: boolean; revealed_at?: string | null } | null;
  if (!ergebnis?.ok) {
    return { revealed_at: null, error: 'Die Reise konnte nicht abgeschlossen werden. Probier es gleich nochmal.' };
  }
  return { revealed_at: ergebnis.revealed_at ?? null, error: null };
}
