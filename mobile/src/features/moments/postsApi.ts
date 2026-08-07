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

// RLS-Ablehnung (Postgres 42501, "new row violates row-level security policy").
// Anders als jeder andere Fehlschlag lohnt hier kein Wiederholen: posts_insert_member
// (supabase/migrations/20260803090300_sealing_rls.sql) lässt nach dem Reveal nur noch
// Nachzügler durch, deren captured_at vor dem Reveal liegt. Liegt es danach, lehnt die
// Policy JEDEN Versuch dauerhaft ab (Task-6-Brief, «Reise wird währenddessen aufgedeckt»).
const RLS_ABLEHNUNG = '42501';

export async function momentAnlegen(
  job: QueueJob
): Promise<{ error: string | null; dauerhaftAbgelehnt?: boolean }> {
  // Die Autorenschaft ist ein Sitzungswert, kein Feld auf QueueJob (Task-6-Kontext) —
  // sie kommt aus dem angemeldeten Client, nicht aus dem Job.
  let authorId: string | undefined;
  try {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      return { error: meldung(sessionError, 'Du bist nicht angemeldet. Melde dich an und probier es nochmal.') };
    }
    authorId = data.session?.user.id;
  } catch (fehler) {
    // getSession() selbst kann rejecten (z.B. Storage-Fehler, siehe AuthProvider).
    return { error: meldung(fehler as { message?: string }, 'Du bist nicht angemeldet. Melde dich an und probier es nochmal.') };
  }
  if (!authorId) {
    return { error: 'Du bist nicht angemeldet. Melde dich an und probier es nochmal.' };
  }

  const { error } = await supabase.from('posts').insert({
    id: job.post_id,
    trip_id: job.trip_id,
    author_id: authorId,
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
  if (error.code === RLS_ABLEHNUNG) {
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
