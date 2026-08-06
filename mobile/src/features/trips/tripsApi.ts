import { supabase } from '@/lib/supabase';
import type { InvitePreview, RedeemResult, Trip, TripMember } from './types';

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

async function loadCounts(): Promise<Map<string, number>> {
  // Absichtlich kein direktes `const { data, error } = await supabase.rpc(...)`:
  // im Test „fetchTrips liefert bei einem Fehler eine leere Liste" bleibt der
  // rpc-Mock unkonfiguriert und liefert `undefined` zurück. Im echten Betrieb
  // löst supabase.rpc() immer zu { data, error } auf (nie zu undefined) —
  // dieser Guard ist rein defensiv gegen den Test-Doppelgänger.
  const result = await supabase.rpc('my_post_counts');
  const data = result?.data;
  const error = result?.error;
  if (error || !data) return new Map();
  return new Map((data as { trip_id: string; count: number }[]).map((r) => [r.trip_id, r.count]));
}

export async function fetchTrips(): Promise<Trip[]> {
  const [{ data, error }, counts] = await Promise.all([
    supabase.from('trips').select(MIT_MITGLIEDERN).order('start_date', { ascending: false }),
    loadCounts(),
  ]);
  if (error || !data) return [];
  // `unknown` als Zwischenschritt: Ohne generischen Database-Typ am Client
  // parst postgrest-js MIT_MITGLIEDERN selbst auf Typ-Ebene und nimmt für
  // trip_members(profiles(...)) Array-Kardinalität an, obwohl profiles hier
  // ein Einzelobjekt ist (siehe TripRow oben). Laufzeit unverändert.
  return (data as unknown as TripRow[]).map((row) => toTrip(row, counts));
}

export async function fetchTrip(id: string): Promise<Trip | null> {
  const [{ data, error }, counts] = await Promise.all([
    supabase.from('trips').select(MIT_MITGLIEDERN).eq('id', id).maybeSingle(),
    loadCounts(),
  ]);
  if (error || !data) return null;
  return toTrip(data as unknown as TripRow, counts);
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
    return { id: null, error: 'Die Reise konnte nicht angelegt werden. Probier es gleich nochmal.' };
  }
  return { id: data.id, error: null };
}

export async function updateTrip(
  id: string,
  input: { name: string; startDate: string; endDate: string }
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('trips')
    .update({ name: input.name.trim(), start_date: input.startDate, end_date: input.endDate })
    .eq('id', id);
  return { error: error ? 'Die Änderung konnte nicht gespeichert werden. Probier es gleich nochmal.' : null };
}

export async function deleteTrip(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('trips').delete().eq('id', id);
  return { error: error ? 'Die Reise konnte nicht gelöscht werden. Probier es gleich nochmal.' : null };
}

export async function fetchMembers(tripId: string): Promise<TripMember[]> {
  const { data, error } = await supabase
    .from('trip_members')
    .select('user_id, role, profiles(username, display_name)')
    .eq('trip_id', tripId)
    .order('joined_at');
  if (error || !data) return [];
  type Row = { user_id: string; role: 'owner' | 'member'; profiles: { username: string; display_name: string } | null };
  // Gleicher Grund wie oben: postgrest-js inferiert profiles(...) ohne
  // Database-Typ als Array; unknown als Zwischenschritt behebt nur die
  // statische Typprüfung, Laufzeitverhalten bleibt unverändert.
  return (data as unknown as Row[]).map((r) => ({
    user_id: r.user_id,
    role: r.role,
    username: r.profiles?.username ?? '',
    display_name: r.profiles?.display_name ?? '',
  }));
}

// Deckt beide Fälle ab: Owner entfernt ein Mitglied, Mitglied verlässt selbst.
// Welcher Fall erlaubt ist, entscheidet die Policy trip_members_delete (Phase 1).
export async function removeMember(tripId: string, userId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', userId);
  return { error: error ? 'Das hat nicht geklappt. Probier es gleich nochmal.' : null };
}

export async function fetchInviteCode(tripId: string): Promise<string | null> {
  const { data, error } = await supabase.from('trips').select('invite_code').eq('id', tripId).maybeSingle();
  if (error || !data) return null;
  return data.invite_code;
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
