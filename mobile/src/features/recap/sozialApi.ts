// Reaktionen und Kommentare im Recap-Player (Task 12). `reactions`/`comments`,
// ihre RLS-Policies und Grants stehen seit Phase 1 (supabase/migrations/
// 20260803090100_content_tables.sql, 20260803090500_social_rls.sql) — hier
// entsteht kein Schema, nur der Aufrufweg. Gleiches Muster wie recapApi.ts/
// urlVorrat.ts: `Gelesen<T>` lokal (nicht exportiert, siehe dortiger
// Kommentar), Fehler als deutsche Klartexte über `meldung()`.
import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, istOffline } from '@/lib/netzfehler';
import type { Kommentar, Reaktion } from './types';

type Gelesen<T> = { data: T; error: string | null };

function meldung(error: { message?: string } | null, sonst: string): string {
  return istOffline(error) ? OFFLINE_HINT : sonst;
}

// Praktisch unerreichbar (der Player läuft nur hinter status==='signedIn'),
// aber ein Schreibversuch ohne Sitzung darf nie einfach verschluckt werden —
// gleicher Text wie preview.tsx's OHNE_SITZUNG_MELDUNG (Task-13-Fix-Runde-2),
// aus Konsistenzgründen hier als eigenes Literal statt eines Imports über
// Feature-Grenzen hinweg (moments/ vs. recap/).
const OHNE_SITZUNG_MELDUNG = 'Du bist nicht angemeldet. Melde dich an und probier es nochmal.';

// Gleiches Muster wie postsApi.aktuelleAutorId: die Autoren-/Reagierenden-
// Kennung kommt aus der aktiven Sitzung, nicht aus einem Parameter — beide
// RLS-Policies (reactions_insert/comments_insert) verlangen ohnehin
// `user_id = auth.uid()`, ein falsch übergebener Wert würde also nur an der
// Policy scheitern, nie tatsächlich fremde Zeilen erzeugen. Der Aufrufweg
// bleibt trotzdem sauber: die Spalte selbst hat keinen Default, der Wert muss
// explizit im Payload stehen.
async function aktuelleUserId(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session?.user.id ?? null;
  } catch {
    // getSession() selbst kann rejecten (z.B. Storage-Fehler).
    return null;
  }
}

// Holt die Reaktionen für ALLE übergebenen Momente in einem Aufruf (Brief:
// "nicht pro Moment" — bei 200 Momenten ist das der Unterschied zwischen
// "lädt" und "lädt nicht"). Eine leere Liste ruft Supabase gar nicht erst
// auf: `.in('post_id', [])` wäre ein Netzwerk-Aufruf, der per Konstruktion
// nie etwas liefern kann.
export async function fetchReaktionen(
  postIds: string[]
): Promise<Gelesen<Record<string, Reaktion[]>>> {
  if (postIds.length === 0) return { data: {}, error: null };

  const { data, error } = await supabase
    .from('reactions')
    .select('post_id, user_id, emoji')
    .in('post_id', postIds)
    // Deterministische Reihenfolge je Moment — u.a. wichtig für die Liste
    // "Reaktionen anderer" im Player (erste Reaktion zuerst).
    .order('created_at', { ascending: true });

  if (error || !data) {
    return {
      data: {},
      error: meldung(error, 'Die Reaktionen konnten nicht geladen werden. Probier es gleich nochmal.'),
    };
  }

  const nachMoment: Record<string, Reaktion[]> = {};
  for (const zeile of data as Reaktion[]) {
    (nachMoment[zeile.post_id] ??= []).push(zeile);
  }
  return { data: nachMoment, error: null };
}

const REAKTION_SETZEN_FEHLER = 'Deine Reaktion konnte nicht gespeichert werden. Probier es gleich nochmal.';
const REAKTION_ENTFERNEN_FEHLER = 'Deine Reaktion konnte nicht entfernt werden. Probier es gleich nochmal.';

// `reactions` hat den Primärschlüssel (post_id, user_id, emoji) — ein zweiter
// Tipp auf dasselbe Emoji, dessen erste Anfrage noch unterwegs ist (oder ein
// Wiederholen nach einem Netzfehler), würde einen rohen INSERT sonst mit
// Postgres 23505 (duplicate key) scheitern lassen. `.upsert(...,
// {ignoreDuplicates: true})` macht daraus serverseitig ein "INSERT ... ON
// CONFLICT DO NOTHING": ein bereits vorhandenes Tripel ist Erfolg, kein
// Fehler. Bewusst NICHT `ignoreDuplicates: false` (Standard) — das würde ein
// "ON CONFLICT DO UPDATE" erzeugen, für das Postgres zusätzlich zum
// bestehenden INSERT-Grant auch ein UPDATE-Privileg verlangt (siehe Postgres-
// Doku zu INSERT ... ON CONFLICT). Genau dieses Privileg vergibt
// 20260803090500_social_rls.sql absichtlich NICHT ("keine Update-Policy
// vorgesehen") — mit dem Standardverhalten würde jeder zweite Tipp auf
// dasselbe Emoji serverseitig an einem fehlenden GRANT scheitern.
//
// Der eigentliche Schutz gegen einen SCHNELLEN Doppeltipp (zwei Anfragen
// praktisch gleichzeitig) sitzt zusätzlich im Player selbst (siehe dort,
// `pendingReaktionenRef`) — dieses `ignoreDuplicates` ist die zweite,
// serverseitige Absicherung für den Fall, dass trotzdem zwei Anfragen
// hinausgehen (z.B. ein Wiederholen nach Timeout, dessen ursprüngliche
// Anfrage doch noch ankommt).
export async function setzeReaktion(postId: string, emoji: string): Promise<{ error: string | null }> {
  const userId = await aktuelleUserId();
  if (!userId) return { error: OHNE_SITZUNG_MELDUNG };

  const { error } = await supabase
    .from('reactions')
    .upsert(
      { post_id: postId, user_id: userId, emoji },
      { onConflict: 'post_id,user_id,emoji', ignoreDuplicates: true }
    );
  if (error) return { error: meldung(error, REAKTION_SETZEN_FEHLER) };
  return { error: null };
}

// Löscht GENAU die eigene Reaktion mit diesem Emoji auf diesem Moment —
// explizit über alle drei PK-Spalten gefiltert, nicht nur über RLS verlassen
// (reactions_delete_own erlaubt ohnehin nur `user_id = auth.uid()`, aber ein
// Delete ohne post_id/emoji-Filter würde sonst — liesse man sich rein auf die
// Policy verlassen — versehentlich ALLE eigenen Reaktionen treffen, sobald
// hier einmal ein Filter vergessen ginge). Kein passender Datensatz (schon
// entfernt, doppelter Tipp) ist kein Fehler — DELETE ist idempotent.
export async function entferneReaktion(postId: string, emoji: string): Promise<{ error: string | null }> {
  const userId = await aktuelleUserId();
  if (!userId) return { error: OHNE_SITZUNG_MELDUNG };

  const { error } = await supabase
    .from('reactions')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', userId)
    .eq('emoji', emoji);
  if (error) return { error: meldung(error, REAKTION_ENTFERNEN_FEHLER) };
  return { error: null };
}

const KOMMENTAR_SPALTEN = 'id, post_id, user_id, text, created_at, profiles(display_name)';
type KommentarRow = Omit<Kommentar, 'autor_name'> & { profiles: { display_name: string } | null };

// Kommentare EINES Moments — anders als fetchReaktionen bewusst nicht
// gebündelt: das Kommentar-Panel zeigt immer nur den einen offenen Moment,
// ein Vorausladen für alle 200 Momente wäre reine Verschwendung.
export async function fetchKommentare(postId: string): Promise<Gelesen<Kommentar[]>> {
  const { data, error } = await supabase
    .from('comments')
    .select(KOMMENTAR_SPALTEN)
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (error || !data) {
    return {
      data: [],
      error: meldung(error, 'Die Kommentare konnten nicht geladen werden. Probier es gleich nochmal.'),
    };
  }

  const kommentare = (data as unknown as KommentarRow[]).map((zeile) => ({
    id: zeile.id,
    post_id: zeile.post_id,
    user_id: zeile.user_id,
    text: zeile.text,
    created_at: zeile.created_at,
    autor_name: zeile.profiles?.display_name ?? '',
  }));
  return { data: kommentare, error: null };
}

// Exportiert, damit der Player denselben Wert für einen Live-Zeichenzähler
// im Eingabefeld benutzen kann, statt ihn ein zweites Mal zu raten.
export const KOMMENTAR_MIN_LAENGE = 1;
export const KOMMENTAR_MAX_LAENGE = 500;
const KOMMENTAR_LEER_FEHLER = 'Schreib etwas, bevor du sendest.';
const KOMMENTAR_ZU_LANG_FEHLER = `Kommentare dürfen höchstens ${KOMMENTAR_MAX_LAENGE} Zeichen haben.`;
const KOMMENTAR_SENDEN_FEHLER = 'Dein Kommentar konnte nicht gesendet werden. Probier es gleich nochmal.';

// Prüft die Länge VOR dem Absenden — exakt der Bereich aus dem
// Datenbank-Check `char_length(text) between 1 and 500`
// (supabase/migrations/20260803090100_content_tables.sql) — damit niemand in
// dessen rohe Postgres-Fehlermeldung läuft. Führendes/nachgestelltes
// Leerzeichen wird vor der Prüfung UND vor dem Speichern entfernt: ein
// Kommentar aus reinen Leerzeichen besteht die DB-Prüfung technisch (positive
// Zeichenlänge), wäre aber inhaltsleer.
export async function schreibeKommentar(postId: string, text: string): Promise<{ error: string | null }> {
  const getrimmt = text.trim();
  if (getrimmt.length < KOMMENTAR_MIN_LAENGE) return { error: KOMMENTAR_LEER_FEHLER };
  if (getrimmt.length > KOMMENTAR_MAX_LAENGE) return { error: KOMMENTAR_ZU_LANG_FEHLER };

  const userId = await aktuelleUserId();
  if (!userId) return { error: OHNE_SITZUNG_MELDUNG };

  const { error } = await supabase.from('comments').insert({ post_id: postId, user_id: userId, text: getrimmt });
  if (error) return { error: meldung(error, KOMMENTAR_SENDEN_FEHLER) };
  return { error: null };
}
