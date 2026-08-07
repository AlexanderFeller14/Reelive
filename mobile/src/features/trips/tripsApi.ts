import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, istOffline } from '@/lib/netzfehler';
import type { InvitePreview, RedeemResult, Trip, TripMember } from './types';

// Jede Lesefunktion liefert Daten UND Fehler getrennt. Ein nacktes [] bzw. null
// konnte der Screen nicht von «wirklich leer» unterscheiden und behauptete
// dann Dinge über die Daten des Nutzers, die nicht stimmen («Noch keine
// Reise»). DESIGN-LANGUAGE §6: Fehler erklären Ursache und Lösung.
type Gelesen<T> = { data: T; error: string | null };

// Übersetzt einen Supabase-Fehler in eine Meldung nach §6: Offline ist die
// eine Ursache, die der Nutzer selbst beheben kann, und wird deshalb benannt.
function meldung(error: { message?: string } | null, sonst: string): string {
  return istOffline(error) ? OFFLINE_HINT : sonst;
}

const SPALTEN = 'id, name, start_date, end_date, status, owner_id';
// Die Karte zeigt überlappende Avatare (DESIGN-LANGUAGE §4), also werden die
// Anzeigenamen gleich mitgeladen — die Mitgliederzahl fällt dabei ab und
// braucht keine eigene Aggregation.
const MIT_MITGLIEDERN = `${SPALTEN}, trip_members(profiles(display_name))`;

type TripRow = Omit<Trip, 'member_names' | 'member_count' | 'my_post_count'> & {
  trip_members: { profiles: { display_name: string } | null }[] | null;
};

function toTrip(row: TripRow, counts: Map<string, number>): Trip {
  const names = (row.trip_members ?? [])
    .map((m) => m.profiles?.display_name)
    .filter((n): n is string => !!n);
  return {
    id: row.id,
    name: row.name,
    start_date: row.start_date,
    end_date: row.end_date,
    status: row.status,
    owner_id: row.owner_id,
    member_names: names,
    member_count: names.length,
    my_post_count: counts.get(row.id) ?? 0,
  };
}

// Bewusst ohne Fehler-Weitergabe: der eigene Momente-Zähler ist Beiwerk auf der
// Karte. Fällt nur er aus, steht dort eine 0 statt gar keiner Reise — fällt das
// Netz aus, meldet ohnehin die Reise-Abfrage daneben den Fehler.
async function loadCounts(): Promise<Map<string, number>> {
  // Absichtlich kein direktes `const { data, error } = await supabase.rpc(...)`:
  // in den Fehlertests bleibt der rpc-Mock unkonfiguriert und liefert
  // `undefined` zurück. Im echten Betrieb löst supabase.rpc() immer zu
  // { data, error } auf (nie zu undefined) — dieser Guard ist rein defensiv
  // gegen den Test-Doppelgänger.
  const result = await supabase.rpc('my_post_counts');
  const data = result?.data;
  const error = result?.error;
  if (error || !data) return new Map();
  return new Map((data as { trip_id: string; count: number }[]).map((r) => [r.trip_id, r.count]));
}

// Öffentliche Fassung von loadCounts() für Aufrufer ausserhalb dieser Datei
// (Task 9: der Momente-Zähler zieht den Serverstand als Zuordnung Reise-id ->
// Zahl aus derselben rpc, ergänzt um noch nicht hochgeladene Momente aus der
// Warteschlange). Baut bewusst auf loadCounts() auf, statt die rpc erneut
// abzufragen — eine Zuordnung, eine Quelle.
export async function eigeneZaehler(): Promise<Record<string, number>> {
  return Object.fromEntries(await loadCounts());
}

export async function fetchTrips(): Promise<Gelesen<Trip[]>> {
  const [{ data, error }, counts] = await Promise.all([
    supabase.from('trips').select(MIT_MITGLIEDERN).order('start_date', { ascending: false }),
    loadCounts(),
  ]);
  if (error || !data) {
    return {
      data: [],
      error: meldung(error, 'Deine Reisen konnten nicht geladen werden. Probier es gleich nochmal.'),
    };
  }
  // `unknown` als Zwischenschritt: Ohne generischen Database-Typ am Client
  // parst postgrest-js MIT_MITGLIEDERN selbst auf Typ-Ebene und nimmt für
  // trip_members(profiles(...)) Array-Kardinalität an, obwohl profiles hier
  // ein Einzelobjekt ist (siehe TripRow oben). Laufzeit unverändert.
  return { data: (data as unknown as TripRow[]).map((row) => toTrip(row, counts)), error: null };
}

// data === null bei error === null heisst «gibt es (für dich) nicht mehr» —
// gelöscht, verlassen oder nie sichtbar gewesen. Der Screen unterscheidet das
// von einem Ladefehler, weil nur Letzterer einen Wiederholversuch lohnt.
export async function fetchTrip(id: string): Promise<Gelesen<Trip | null>> {
  const [{ data, error }, counts] = await Promise.all([
    supabase.from('trips').select(MIT_MITGLIEDERN).eq('id', id).maybeSingle(),
    loadCounts(),
  ]);
  if (error) {
    return {
      data: null,
      error: meldung(error, 'Diese Reise konnte nicht geladen werden. Probier es gleich nochmal.'),
    };
  }
  return { data: data ? toTrip(data as unknown as TripRow, counts) : null, error: null };
}

export async function createTrip(input: {
  name: string; startDate: string; endDate: string; ownerId: string;
}): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('trips')
    .insert({
      name: input.name.trim(),
      start_date: input.startDate,
      end_date: input.endDate,
      owner_id: input.ownerId,
    })
    .select('id')
    .single();
  if (error || !data) {
    return {
      id: null,
      error: meldung(error, 'Die Reise konnte nicht angelegt werden. Probier es gleich nochmal.'),
    };
  }
  return { id: data.id, error: null };
}

// Verwirft eine RLS-Policy den Schreibvorgang, liefert Postgres KEINEN Fehler,
// sondern «UPDATE 0» bzw. «DELETE 0». Ohne die angehängte Auswahl meldeten
// diese drei Funktionen Erfolg, und der Detailscreen navigierte weg, als wäre
// die Reise gelöscht — obwohl sie weiter existiert. `.select(...)` macht die
// betroffenen Zeilen sichtbar: leeres Ergebnis = nichts passiert = Fehlschlag.
// (RETURNING läuft dabei über die Select-Policy auf der Zeile VOR dem Schreiben,
// also sehen Owner bzw. Mitglied ihre eigene Zeile — lokal gegen die Policies
// verifiziert.)
export async function updateTrip(
  id: string,
  input: { name: string; startDate: string; endDate: string }
): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('trips')
    .update({ name: input.name.trim(), start_date: input.startDate, end_date: input.endDate })
    .eq('id', id)
    .select('id');
  if (error) {
    return { error: meldung(error, 'Die Änderung konnte nicht gespeichert werden. Probier es gleich nochmal.') };
  }
  if (!data || data.length === 0) {
    return { error: 'Die Änderung wurde nicht gespeichert. Die Reise gibt es nicht mehr, oder sie gehört dir nicht.' };
  }
  return { error: null };
}

export async function deleteTrip(id: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase.from('trips').delete().eq('id', id).select('id');
  if (error) {
    return { error: meldung(error, 'Die Reise konnte nicht gelöscht werden. Probier es gleich nochmal.') };
  }
  if (!data || data.length === 0) {
    return { error: 'Die Reise wurde nicht gelöscht. Es gibt sie nicht mehr, oder sie gehört dir nicht.' };
  }
  return { error: null };
}

export async function fetchMembers(tripId: string): Promise<Gelesen<TripMember[]>> {
  const { data, error } = await supabase
    .from('trip_members')
    .select('user_id, role, profiles(username, display_name)')
    .eq('trip_id', tripId)
    .order('joined_at');
  if (error || !data) {
    return {
      data: [],
      error: meldung(error, 'Die Mitglieder konnten nicht geladen werden. Probier es gleich nochmal.'),
    };
  }
  type Row = { user_id: string; role: 'owner' | 'member'; profiles: { username: string; display_name: string } | null };
  // Gleicher Grund wie oben: postgrest-js inferiert profiles(...) ohne
  // Database-Typ als Array; unknown als Zwischenschritt behebt nur die
  // statische Typprüfung, Laufzeitverhalten bleibt unverändert.
  return {
    data: (data as unknown as Row[]).map((r) => ({
      user_id: r.user_id,
      role: r.role,
      username: r.profiles?.username ?? '',
      display_name: r.profiles?.display_name ?? '',
    })),
    error: null,
  };
}

// Deckt beide Fälle ab: Owner entfernt ein Mitglied, Mitglied verlässt selbst.
// Welcher Fall erlaubt ist, entscheidet die Policy trip_members_delete (Phase 1).
export async function removeMember(tripId: string, userId: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('trip_members')
    .delete()
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .select('user_id');
  if (error) {
    return { error: meldung(error, 'Das hat nicht geklappt. Probier es gleich nochmal.') };
  }
  if (!data || data.length === 0) {
    return { error: 'Das hat nicht geklappt. Die Mitgliedschaft gibt es nicht mehr, oder du darfst sie nicht beenden.' };
  }
  return { error: null };
}

export async function fetchInviteCode(tripId: string): Promise<Gelesen<string | null>> {
  const { data, error } = await supabase.from('trips').select('invite_code').eq('id', tripId).maybeSingle();
  if (error) {
    return {
      data: null,
      error: meldung(error, 'Der Einladungslink konnte nicht geladen werden. Probier es gleich nochmal.'),
    };
  }
  return { data: data?.invite_code ?? null, error: null };
}

export async function peekInvite(code: string): Promise<InvitePreview | null> {
  const { data, error } = await supabase.rpc('peek_invite', { p_code: code });
  if (error || !data || (data as InvitePreview[]).length === 0) return null;
  return (data as InvitePreview[])[0];
}

export async function redeemInvite(code: string): Promise<RedeemResult> {
  const { data, error } = await supabase.rpc('redeem_invite', { p_code: code });
  if (error || !data || (data as RedeemResult[]).length === 0) {
    return { status: 'not_found', trip_id: null };
  }
  return (data as RedeemResult[])[0];
}
