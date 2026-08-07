import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, istOffline } from '@/lib/netzfehler';
import type { QueueJob } from './types';

// Übersetzt einen postgrest-Fehler in eine deutsche Klartextmeldung (DESIGN-LANGUAGE
// §6: Fehler erklären Ursache und Lösung). Gleiches Muster wie tripsApi/profileApi.
function meldung(error: { message?: string } | null, sonst: string): string {
  return istOffline(error) ? OFFLINE_HINT : sonst;
}

// functions-js bricht einen echten Netzwerkfehler in FunctionsFetchError um und
// ersetzt dabei die Nachricht durch einen festen englischen Satz ("Failed to send
// a request to the Edge Function") — istOffline() träfe darauf nie zu. Die
// ursprüngliche Fetch-Fehlermeldung steckt aber im `context` der Exception, siehe
// node_modules/@supabase/functions-js FunctionsClient. Beide Stellen prüfen,
// bevor auf die generische Meldung zurückgefallen wird.
function funktionMeldung(error: unknown, sonst: string): string {
  const err = error as { message?: string; context?: { message?: string } } | null;
  if (istOffline({ message: err?.context?.message })) return OFFLINE_HINT;
  return meldung(err ?? null, sonst);
}

// Primärschlüssel schon vorhanden (Postgres 23505): ein Wiederanlauf nach Absturz
// ruft momentAnlegen erneut mit derselben id auf. Die Zeile existiert dann bereits
// — das ist Erfolg, kein Fehler, sonst bliebe der Job für immer hängen (Brief Step 3).
const PRIMARYKEY_VERLETZUNG = '23505';

// RLS-Ablehnung (Postgres 42501). Anders als jeder andere Fehlschlag lohnt hier kein
// Wiederholen: posts_insert_member (supabase/migrations/20260803090300_sealing_rls.sql)
// lässt nach dem Reveal nur noch Nachzügler durch, deren captured_at vor dem Reveal
// liegt. Liegt es danach, lehnt die Policy JEDEN Versuch dauerhaft ab (Task-6-Brief,
// «Reise wird währenddessen aufgedeckt»).
//
// ACHTUNG, Fix-Runde 1: der SQLSTATE 42501 allein ("insufficient_privilege") ist NICHT
// eindeutig — Postgres vergibt denselben Code auch für einen fehlenden GRANT ("permission
// denied for table …"), z.B. wenn eine künftige Migration eine weitere Insert-Spalte
// ergänzt, ohne den Spalten-Grant aus 20260803090600_role_hardening.sql nachzuziehen.
// Nur der Code allein hätte in diesem Fall JEDEN wartenden Moment JEDES Nutzers
// gelöscht statt ihn zu wiederholen. Zweites, von Postgres selbst (nicht von der App)
// erzeugtes Signal nötig: die RLS-WITH-CHECK-Verletzung trägt IMMER exakt den Text
// "new row violates row-level security policy for table …" — sprachunabhängig, weil er
// aus dem C-Code kommt, nicht aus einem übersetzbaren Format-String. Die Grant-Meldung
// lautet stattdessen "permission denied for …". Nur BEIDE Signale zusammen (Code UND
// dieser Text) gelten als dauerhafte Ablehnung. Im Zweifel: wiederholen, nicht verwerfen
// — ein zu Unrecht wiederholter Job kostet Bandbreite, ein zu Unrecht gelöschter eine
// Erinnerung, die es nie wieder gibt.
const RLS_ABLEHNUNG_CODE = '42501';
const RLS_ABLEHNUNG_MUSTER = /row-level security policy/i;

function istRlsAblehnung(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === RLS_ABLEHNUNG_CODE && RLS_ABLEHNUNG_MUSTER.test(error.message ?? '');
}

// Liest die aktuell aktive Autoren-Kennung aus der Sitzung. Genutzt vom
// Worker VOR der Job-Auswahl (queueLogic.naechsterJob), damit ein Job, dessen
// gespeicherte author_id nicht zur gerade angemeldeten Person passt, gar
// nicht erst ausgewählt wird — Task-13-Fix-Runde-2. momentAnlegen unten
// ermittelt die Kennung NICHT mehr selbst (siehe dort), das war die Lücke:
// sie kam bisher aus der Sitzung zum Zeitpunkt des Schreibens, nicht zu dem
// des Einreihens.
export async function aktuelleAutorId(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session?.user.id ?? null;
  } catch {
    // getSession() selbst kann rejecten (z.B. Storage-Fehler, siehe AuthProvider).
    return null;
  }
}

export async function momentAnlegen(
  job: QueueJob
): Promise<{ error: string | null; dauerhaftAbgelehnt?: boolean }> {
  // Die Autorenschaft kommt jetzt vom Job selbst (beim Einreihen festgehalten,
  // siehe QueueJob.author_id und preview.tsx) statt aus der AKTUELL aktiven
  // Sitzung — sonst könnte ein Moment, der bloss in der Warteschlange lag,
  // unter dem Namen der nächsten angemeldeten Person landen (Task-13-
  // Fix-Runde-2). uploadWorker wählt über aktuelleAutorId()+naechsterJob
  // ohnehin nur Jobs der gerade angemeldeten Person aus — dieser Insert
  // vertraut deshalb bewusst der gespeicherten Kennung.
  const { error } = await supabase.from('posts').insert({
    id: job.post_id,
    trip_id: job.trip_id,
    author_id: job.author_id,
    // Einziges Feld, dessen Name abweicht: QueueJob.typ → posts.type.
    type: job.typ,
    storage_key: job.storage_key,
    thumb_key: job.thumb_key,
    duration_s: job.duration_s,
    caption: job.caption,
    captured_at: job.captured_at,
    captured_tz: job.captured_tz,
    lat: job.lat,
    lng: job.lng,
    place_name: job.place_name,
  });

  if (!error) return { error: null };
  if (error.code === PRIMARYKEY_VERLETZUNG) return { error: null };
  if (istRlsAblehnung(error)) {
    return {
      error: 'Dieser Moment wurde nach der Aufdeckung der Reise aufgenommen und kann nicht mehr eingesendet werden.',
      dauerhaftAbgelehnt: true,
    };
  }
  return { error: meldung(error, 'Der Moment konnte nicht angelegt werden. Probier es gleich nochmal.') };
}

export async function signierteUrls(
  postId: string
): Promise<{ medium_url: string; thumb_url: string } | null> {
  const { data, error } = await supabase.functions.invoke('media-urls', {
    body: { aktion: 'sign', post_id: postId },
  });
  if (error || !data) {
    console.error('[postsApi] signierteUrls fehlgeschlagen', error);
    return null;
  }
  return data as { medium_url: string; thumb_url: string };
}

export async function uploadBestaetigen(postId: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase.functions.invoke('media-urls', {
    body: { aktion: 'confirm', post_id: postId },
  });
  if (error) {
    // Die Function liefert bei einem HTTP-Fehler ihren deutschen Klartext im
    // Response-Body mit — der landet über FunctionsHttpError im `context`.
    const httpFehler = error as { name?: string; context?: unknown };
    if (httpFehler?.name === 'FunctionsHttpError' && httpFehler.context instanceof Response) {
      try {
        const body = (await httpFehler.context.clone().json()) as { fehler?: string };
        if (typeof body.fehler === 'string') return { error: body.fehler };
      } catch {
        // Antwort war kein JSON — unten die generische Meldung.
      }
    }
    return { error: funktionMeldung(error, 'Der Upload konnte nicht bestätigt werden. Probier es gleich nochmal.') };
  }
  if (!(data as { ok?: boolean } | null)?.ok) {
    return { error: 'Der Upload konnte nicht bestätigt werden. Probier es gleich nochmal.' };
  }
  return { error: null };
}
