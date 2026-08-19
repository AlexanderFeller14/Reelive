import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, istOffline } from '@/lib/networkError';
import type { Face } from '@/components/Avatar';
import type { InvitePreview, RedeemResult, Trip, TripMember } from './types';

// Every read function returns data AND error separately. A bare [] or null
// could not be told apart by the screen from "genuinely empty" and would
// then claim things about the user's data that are not true ("no trip yet").
// DESIGN-LANGUAGE §6: errors explain cause and fix.
type Loaded<T> = { data: T; error: string | null };

// Translates a Supabase error into a message per §6: offline is the one
// cause the user can fix themselves, and is therefore named.
function message(error: { message?: string } | null, fallback: string): string {
  return istOffline(error) ? OFFLINE_HINT : fallback;
}

const COLUMNS = 'id, name, start_date, end_date, status, owner_id';
// The card shows overlapping avatars (DESIGN-LANGUAGE §4), so the display
// names get loaded along with it, the member count falls out of that and
// needs no separate aggregation. avatar_key travels along from here: name
// AND key come from the SAME row, never from two separate queries that
// could drift apart at the first person without a profile.
const WITH_MEMBERS = `${COLUMNS}, trip_members(profiles(display_name, avatar_key))`;

type TripRow = Omit<Trip, 'members' | 'member_count' | 'my_post_count'> & {
  trip_members: { profiles: { display_name: string; avatar_key: string | null } | null }[] | null;
};

function toTrip(row: TripRow, counts: Map<string, number>): Trip {
  // Name and key stay together in ONE mapping (not two separate .map()
  // lists for names and keys): otherwise, at the first person without a
  // profile, a face would carry another person's image.
  const members: Face[] = (row.trip_members ?? [])
    .map((m) => m.profiles)
    .filter((p): p is { display_name: string; avatar_key: string | null } => !!p?.display_name)
    .map((p) => ({ name: p.display_name, avatarKey: p.avatar_key }));
  return {
    id: row.id,
    name: row.name,
    start_date: row.start_date,
    end_date: row.end_date,
    status: row.status,
    owner_id: row.owner_id,
    members,
    member_count: members.length,
    my_post_count: counts.get(row.id) ?? 0,
  };
}

// Reads the rpc ONCE and returns state AND error separately, like every
// other read function above. That was not the case until the final review:
// the error was swallowed and a failure emitted as an empty mapping. For the
// trip card that is harmless (see loadCounts), for the moments counter it
// was the bug from Important 6: whoever has 40 sealed moments and captures
// one in flight mode saw 0 + 1 = 1, exactly the backwards jump that Spec §7
// rules out, and of all things in the offline case this phase exists for.
async function readCounts(): Promise<{ counts: Map<string, number>; error: string | null }> {
  // Deliberately not a direct `const { data, error } = await supabase.rpc(...)`:
  // in the error tests the rpc mock is left unconfigured and returns
  // `undefined`. In real operation supabase.rpc() always resolves to
  // { data, error } (never to undefined), this guard is purely defensive
  // against the test double.
  const result = await supabase.rpc('my_post_counts');
  const data = result?.data;
  const error = result?.error;
  if (error || !data) {
    return {
      counts: new Map(),
      error: message(error ?? null, 'Dein Momente-Zähler konnte nicht geladen werden. Probier es gleich nochmal.'),
    };
  }
  return {
    counts: new Map((data as { trip_id: string; count: number }[]).map((r) => [r.trip_id, r.count])),
    error: null,
  };
}

// Deliberately without passing on the error: the own moments counter is
// decoration on the card. If only it fails, a 0 shows there instead of no
// trip at all; if the network fails, the trip query reports the error right
// next to it anyway.
async function loadCounts(): Promise<Map<string, number>> {
  return (await readCounts()).counts;
}

// Public version for callers outside this file (Task 9: the moments counter
// pulls the server state as a mapping trip id -> number from the same rpc,
// adding moments not yet uploaded from the queue). Builds on the same
// readCounts() as loadCounts, one mapping, one source, but passes the error
// along because the counter must NOT treat it as "null" (see counter.ts).
export async function fetchOwnPostCounts(): Promise<Loaded<Record<string, number>>> {
  const { counts, error } = await readCounts();
  return { data: Object.fromEntries(counts), error };
}

// `countsError` kept separate from the trips' `error` (re-review, Minor 2):
// the two queries can fail independently. If the trips succeed and only the
// counts rpc fails, every trip would otherwise carry `my_post_count: 0`,
// decoration for the card (see loadCounts), but for anything that passes
// this state along or holds onto it, the same class of bug as Important 6,
// one level further out. Whoever needs the state must be able to tell
// whether the 0 was measured or merely failed to load.
export async function fetchTrips(): Promise<Loaded<Trip[]> & { countsError: string | null }> {
  const [{ data, error }, countsResult] = await Promise.all([
    supabase.from('trips').select(WITH_MEMBERS).order('start_date', { ascending: false }),
    readCounts(),
  ]);
  const counts = countsResult.counts;
  if (error || !data) {
    return {
      data: [],
      error: message(error, 'Deine Reisen konnten nicht geladen werden. Probier es gleich nochmal.'),
      countsError: countsResult.error,
    };
  }
  // `unknown` as an intermediate step: without a generic Database type on the
  // client, postgrest-js infers WITH_MEMBERS itself at the type level and
  // assumes array cardinality for trip_members(profiles(...)), even though
  // profiles is a single object here (see TripRow above). Runtime behavior
  // unchanged.
  return {
    data: (data as unknown as TripRow[]).map((row) => toTrip(row, counts)),
    error: null,
    countsError: countsResult.error,
  };
}

// data === null with error === null means "no longer exists (for you)":
// deleted, left, or never visible. The screen tells this apart from a load
// error, because only the latter is worth retrying.
export async function fetchTrip(id: string): Promise<Loaded<Trip | null>> {
  const [{ data, error }, counts] = await Promise.all([
    supabase.from('trips').select(WITH_MEMBERS).eq('id', id).maybeSingle(),
    loadCounts(),
  ]);
  if (error) {
    return {
      data: null,
      error: message(error, 'Diese Reise konnte nicht geladen werden. Probier es gleich nochmal.'),
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
      error: message(error, 'Die Reise konnte nicht angelegt werden. Probier es gleich nochmal.'),
    };
  }
  return { id: data.id, error: null };
}

// If an RLS policy rejects the write, Postgres returns NO error, just
// "UPDATE 0" resp. "DELETE 0". Without the attached select, these three
// functions reported success and the detail screen navigated away as if the
// trip had been deleted, even though it still exists. `.select(...)` makes
// the affected rows visible: empty result = nothing happened = failure.
// (RETURNING runs through the select policy on the row BEFORE the write, so
// the owner resp. member sees their own row, verified locally against the
// policies.)
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
    return { error: message(error, 'Die Änderung konnte nicht gespeichert werden. Probier es gleich nochmal.') };
  }
  if (!data || data.length === 0) {
    return { error: 'Die Änderung wurde nicht gespeichert. Die Reise gibt es nicht mehr, oder sie gehört dir nicht.' };
  }
  return { error: null };
}

export async function deleteTrip(id: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase.from('trips').delete().eq('id', id).select('id');
  if (error) {
    return { error: message(error, 'Die Reise konnte nicht gelöscht werden. Probier es gleich nochmal.') };
  }
  if (!data || data.length === 0) {
    return { error: 'Die Reise wurde nicht gelöscht. Es gibt sie nicht mehr, oder sie gehört dir nicht.' };
  }
  return { error: null };
}

export async function fetchMembers(tripId: string): Promise<Loaded<TripMember[]>> {
  const { data, error } = await supabase
    .from('trip_members')
    .select('user_id, role, profiles(username, display_name, avatar_key)')
    .eq('trip_id', tripId)
    .order('joined_at');
  if (error || !data) {
    return {
      data: [],
      error: message(error, 'Die Mitglieder konnten nicht geladen werden. Probier es gleich nochmal.'),
    };
  }
  type Row = {
    user_id: string;
    role: 'owner' | 'member';
    profiles: { username: string; display_name: string; avatar_key: string | null } | null;
  };
  // Same reason as above: postgrest-js infers profiles(...) as an array
  // without a Database type; unknown as an intermediate step only fixes the
  // static type check, runtime behavior is unchanged.
  return {
    data: (data as unknown as Row[]).map((r) => ({
      user_id: r.user_id,
      role: r.role,
      username: r.profiles?.username ?? '',
      display_name: r.profiles?.display_name ?? '',
      avatar_key: r.profiles?.avatar_key ?? null,
    })),
    error: null,
  };
}

// Covers both cases: an owner removes a member, a member leaves by
// themselves. Which case is allowed is decided by the trip_members_delete
// policy (Phase 1).
export async function removeMember(tripId: string, userId: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('trip_members')
    .delete()
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .select('user_id');
  if (error) {
    return { error: message(error, 'Das hat nicht geklappt. Probier es gleich nochmal.') };
  }
  if (!data || data.length === 0) {
    return { error: 'Das hat nicht geklappt. Die Mitgliedschaft gibt es nicht mehr, oder du darfst sie nicht beenden.' };
  }
  return { error: null };
}

export async function fetchInviteCode(tripId: string): Promise<Loaded<string | null>> {
  const { data, error } = await supabase.from('trips').select('invite_code').eq('id', tripId).maybeSingle();
  if (error) {
    return {
      data: null,
      error: message(error, 'Der Einladungslink konnte nicht geladen werden. Probier es gleich nochmal.'),
    };
  }
  return { data: data?.invite_code ?? null, error: null };
}

// Returns `Loaded<…>` like every other read function in this file. It used
// to return only `InvitePreview | null` and thereby folded two completely
// different situations into the same value: "this code doesn't exist" and
// "I couldn't check right now". In a dead zone, the join screen therefore
// claimed the invite link had expired, the one statement nobody can verify
// and that sends the guest away for good.
//
// An unknown code deliberately stays NO error: peek_invite returns zero rows
// for that, and `data: null, error: null` is exactly that statement.
export async function peekInvite(code: string): Promise<Loaded<InvitePreview | null>> {
  const { data, error } = await supabase.rpc('peek_invite', { p_code: code });
  if (error) {
    return {
      data: null,
      error: message(error, 'Die Einladung konnte nicht geladen werden. Probier es gleich nochmal.'),
    };
  }
  return { data: ((data ?? []) as InvitePreview[])[0] ?? null, error: null };
}

export async function redeemInvite(code: string): Promise<RedeemResult> {
  const { data, error } = await supabase.rpc('redeem_invite', { p_code: code });
  if (error || !data || (data as RedeemResult[]).length === 0) {
    return { status: 'not_found', trip_id: null };
  }
  return (data as RedeemResult[])[0];
}
