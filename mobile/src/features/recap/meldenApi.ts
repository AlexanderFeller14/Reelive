// Melden und Moderation (Task 8, Phase 6). Schema, RLS und Grants stehen
// bereits seit Phase 1 bzw. Task 1 dieser Phase, hier entsteht kein neues
// Schema, nur der Aufrufweg (gleiches Muster wie sozialApi.ts):
//
//   reports (id, post_id, reporter_id, reason 1–500, created_at, erledigt_am)
//   - reports_insert:        jedes Mitglied, nur im eigenen Namen, nur was
//                             can_see_post erlaubt (20260803090500_social_rls.sql)
//   - reports_select_owner:  nur die Owner-Person der zugehörigen Reise
//   - reports_update_owner:  nur die Owner-Person, und NUR die Spalte
//                             erledigt_am (Spalten-Grant,
//                             20260808120000_reports_erledigt.sql), ein
//                             Update, das erledigt_am UND eine andere Spalte
//                             zugleich setzt, scheitert als GANZES. Diese
//                             Datei setzt darum in verwirfMeldung() NIE etwas
//                             ausser erledigt_am in demselben Aufruf.
//   - posts_delete_after_reveal: die Owner-Person darf nach dem Reveal JEDEN
//                             Moment löschen, nicht nur den eigenen
//                             (20260803090300_sealing_rls.sql), Moderation.
//                             reports.post_id → posts ist ON DELETE CASCADE:
//                             ein entfernter Moment nimmt seine Meldung(en)
//                             automatisch mit, ohne dass diese Datei sie
//                             separat quittieren müsste.
import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, istOffline } from '@/lib/netzfehler';

type Gelesen<T> = { data: T; error: string | null };

function meldung(error: { message?: string } | null, sonst: string): string {
  return istOffline(error) ? OFFLINE_HINT : sonst;
}

// Gleiches Muster wie sozialApi.aktuelleUserId: die reporter_id kommt aus der
// aktiven Sitzung, nie aus einem Parameter, reports_insert verlangt ohnehin
// reporter_id = auth.uid(), ein falsch übergebener Wert würde nur an der
// Policy scheitern, nie tatsächlich eine fremde Meldung erzeugen.
async function aktuelleUserId(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

const OHNE_SITZUNG_MELDUNG = 'Du bist nicht angemeldet. Melde dich an und probier es nochmal.';

// Deckt sich mit dem Datenbank-Check `char_length(reason) between 1 and 500`
// (20260803090100_content_tables.sql), geprüft VOR dem Absenden (Brief,
// wörtlich), damit niemand in die rohe Postgres-Fehlermeldung läuft. Gleiches
// Trimm-Prinzip wie KOMMENTAR_MIN_LAENGE/-MAX_LAENGE in sozialApi.ts: führendes/
// nachgestelltes Leerzeichen zählt weder für die Prüfung noch fürs Speichern.
export const MELDEN_MIN_LAENGE = 1;
export const MELDEN_MAX_LAENGE = 500;
const MELDEN_LEER_FEHLER = 'Beschreib kurz, worum es geht, bevor du meldest.';
const MELDEN_ZU_LANG_FEHLER = `Deine Begründung darf höchstens ${MELDEN_MAX_LAENGE} Zeichen haben.`;
const MELDEN_SENDEN_FEHLER = 'Deine Meldung konnte nicht gesendet werden. Probier es gleich nochmal.';

// Meldet einen Moment. Der Moment selbst bleibt unverändert sichtbar, Melden
// ist kein Verstecken (Brief, wörtlich); das entscheidet ausschliesslich die
// Owner-Person über verwirfMeldung()/entferneMoment() unten.
export async function meldeMoment(postId: string, grund: string): Promise<{ error: string | null }> {
  const getrimmt = grund.trim();
  if (getrimmt.length < MELDEN_MIN_LAENGE) return { error: MELDEN_LEER_FEHLER };
  if (getrimmt.length > MELDEN_MAX_LAENGE) return { error: MELDEN_ZU_LANG_FEHLER };

  const userId = await aktuelleUserId();
  if (!userId) return { error: OHNE_SITZUNG_MELDUNG };

  const { error } = await supabase
    .from('reports')
    .insert({ post_id: postId, reporter_id: userId, reason: getrimmt });
  if (error) return { error: meldung(error, MELDEN_SENDEN_FEHLER) };
  return { error: null };
}

export type Meldung = {
  id: string;
  post_id: string;
  reason: string;
  created_at: string;
};

const MELDUNGEN_LADEFEHLER = 'Die Meldungen konnten nicht geladen werden. Probier es gleich nochmal.';

// Nur OFFENE Meldungen (erledigt_am ist null), genau die Liste, die die
// Owner-Person im Reise-Detail noch bearbeiten muss («2 gemeldete Momente»,
// Brief). reports_select_owner (RLS) filtert ohnehin schon auf die
// Owner-Person selbst; der trip_id-Filter hier grenzt zusätzlich auf DIESE
// Reise ein, dieselbe Person kann Owner mehrerer Reisen sein.
//
// `posts!inner(trip_id)`: reports selbst trägt kein trip_id, nur post_id.
// PostgREST braucht das `!inner`, damit der anschliessende
// `.eq('posts.trip_id', …)`-Filter auf der eingebetteten Tabelle tatsächlich
// die äusseren reports-Zeilen einschränkt (ein normaler, nicht als inner
// markierter Embed filtert die Trefferliste selbst nicht).
export async function fetchMeldungen(tripId: string): Promise<Gelesen<Meldung[]>> {
  const { data, error } = await supabase
    .from('reports')
    .select('id, post_id, reason, created_at, posts!inner(trip_id)')
    .eq('posts.trip_id', tripId)
    .is('erledigt_am', null)
    .order('created_at', { ascending: true });

  if (error || !data) {
    return { data: [], error: meldung(error, MELDUNGEN_LADEFEHLER) };
  }

  const meldungen = (
    data as unknown as { id: string; post_id: string; reason: string; created_at: string }[]
  ).map((zeile) => ({
    id: zeile.id,
    post_id: zeile.post_id,
    reason: zeile.reason,
    created_at: zeile.created_at,
  }));
  return { data: meldungen, error: null };
}

const ERLEDIGEN_FEHLER = 'Die Meldung konnte nicht verworfen werden. Probier es gleich nochmal.';

// «Meldung verwerfen»: setzt AUSSCHLIESSLICH erledigt_am. Der Spalten-Grant
// (siehe Kommentar am Dateikopf) lässt ein Update, das daneben noch reason
// oder post_id anfasst, komplett scheitern, dieser Aufruf darf darum NIE mit
// einem zweiten Feld zusammengelegt werden.
export async function verwirfMeldung(reportId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('reports')
    .update({ erledigt_am: new Date().toISOString() })
    .eq('id', reportId);
  if (error) return { error: meldung(error, ERLEDIGEN_FEHLER) };
  return { error: null };
}

const ENTFERNEN_FEHLER = 'Der Moment konnte nicht entfernt werden. Probier es gleich nochmal.';

// «Moment entfernen»: löscht den gemeldeten Post. posts_delete_after_reveal
// erlaubt der Owner-Person das Löschen jedes Moments nach dem Reveal, nicht
// nur des eigenen, genau die Moderationsbefugnis, die dieser Aufruf braucht.
export async function entferneMoment(postId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('posts').delete().eq('id', postId);
  if (error) return { error: meldung(error, ENTFERNEN_FEHLER) };
  return { error: null };
}
