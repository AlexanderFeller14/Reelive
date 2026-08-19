// Management of the OWNER'S OWN share link (Task-6-brief), the counterpart
// to shareApi.ts (there: `aufloesen`, no JWT, for the public web player,
// Task 5). Creating and revoking go through the edge function `share-link`
// (service role): it re-checks owner role and trip status server-side
// again, even though the calling site (uebersicht.tsx) already knows that,
// the UI only hides, the function enforces (CLAUDE.md cornerstone).
//
// DELIBERATELY NOT added to shareApi.ts, even though the plan (phase-6
// plan, file structure) sketches exactly one shared file "create, revoke,
// resolve link": `mobile/src/app/share/__tests__/modulgraph.test.ts`
// (Task 5, W4 proof) reads the ENTIRE source text of every file reachable
// from teilen/[token].tsx and demands that EXACTLY ONE `aktion` literal
// appears in the whole graph: `'aufloesen'`. shareApi.ts is in this graph
// (the web player imports it). Additional `aktion: 'erstellen'`/
// `'widerrufen'` literals in the SAME file would have broken this
// already-committed, verified test, not because the web player would
// actually call them (it doesn't import this file at all), but because the
// test searches the source text of the whole file, not just the execution
// path reachable from the web player. A separate file is therefore not
// only cleaner (the app manages its own link, the web player only resolves
// it), but the only option that doesn't weaken the existing W4 guarantee.
import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, istOffline } from '@/lib/networkError';

type Loaded<T> = { data: T; error: string | null };

function message(error: { message?: string } | null, fallback: string): string {
  return istOffline(error) ? OFFLINE_HINT : fallback;
}

// functions-js replaces a genuine network error with a fixed English
// sentence and stashes the original fetch error message in `context`
// (same pattern as recapApi.ts/urlPool.ts/shareApi.ts).
function functionMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string; context?: { message?: string } } | null;
  if (istOffline({ message: err?.context?.message })) return OFFLINE_HINT;
  return message(err ?? null, fallback);
}

async function functionErrorText(error: unknown, fallback: string): Promise<string> {
  const httpError = error as { name?: string; context?: unknown };
  if (httpError?.name === 'FunctionsHttpError' && httpError.context instanceof Response) {
    try {
      const body = (await httpError.context.clone().json()) as { fehler?: string };
      if (typeof body.fehler === 'string') return body.fehler;
    } catch {
      // Response wasn't JSON, generic message below.
    }
  }
  return functionMessage(error, fallback);
}

// Base of the public web player, see comment in .env.example, not a
// security value, only a display decision. Without a default: a guessed
// default would give a link that looks like one and isn't (the same stance
// as the function itself, supabase/functions/share-link/index.ts,
// SHARE_BASE_URL).
//
// Read as a FUNCTION rather than a module-wide constant: `process.env.*`
// gets replaced by a literal at build time by Metro, but is read normally
// at runtime under Jest, a constant would have frozen the value at the
// FIRST import of this module and couldn't be switched anymore in tests
// that want to check both the set and the missing case.
function shareBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_SHARE_BASE_URL ?? '').replace(/\/$/, '');
}
const MISSING_CONFIG_TEXT = 'Die Teilen-Funktion ist nicht eingerichtet. Wende dich an die Entwicklung.';

function buildUrl(token: string): string {
  return `${shareBaseUrl()}/share/${token}`;
}

export type ActiveLink = { token: string; url: string; expiresAt: string | null };

// `created_at` is in the view, but only needed here for sorting, never read.
type ShareLinkRow = { token: string; expires_at: string | null };

const LOAD_ERROR = 'Der Teilen-Link konnte nicht geladen werden. Probier es gleich nochmal.';
const CREATE_ERROR = 'Der Link konnte nicht erstellt werden. Probier es gleich nochmal.';
const REVOKE_ERROR = 'Der Link konnte nicht deaktiviert werden. Probier es gleich nochmal.';

// The most recent link of this trip that currently carries, or `data: null`
// if there is none (never created, all revoked, or all expired). An
// expired link deliberately counts as none at all: the sheet would
// otherwise offer a dead link to copy instead of letting a new one be
// created.
//
// Reads `aktive_share_links` (migration 20260810120000), not the table.
// What "carries" means used to live twice in the project: here as a client
// filter and in `recap_ist_geteilt` as SQL. Both said the same thing but
// weren't bound to each other, and a drift would stand side by side for
// the same trip: this sheet says "no active link", the row on the trip
// screen says "this recap is shared".
//
// With that, the CLOCK also moves to the right place. The old version
// compared against `Date.now()`, i.e. the device clock; the view compares
// against `now()` in Postgres. That's the same clock `share-link/aufloesen`
// measures a token against too, and the only one that counts: if the
// device is two days fast, the app used to consider a carrying link
// expired and offered to create a second one.
//
// RLS stays unchanged: the view carries `security_invoker = on`,
// `share_links_select_owner` still applies. Whoever isn't the owner sees
// nothing here and gets their answer via `isRecapShared` further below.
export async function fetchActiveLink(tripId: string): Promise<Loaded<ActiveLink | null>> {
  const { data, error } = await supabase
    .from('aktive_share_links')
    .select('token, expires_at')
    .eq('trip_id', tripId)
    // Most recent first, and only that one: several valid links at once
    // are possible (every "create link" adds a new one without revoking
    // the previous one), but the sheet shows exactly one.
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { data: null, error: message(error, LOAD_ERROR) };

  const active = data as ShareLinkRow | null;
  if (!active) return { data: null, error: null };

  if (!shareBaseUrl()) return { data: null, error: MISSING_CONFIG_TEXT };

  return { data: { token: active.token, url: buildUrl(active.token), expiresAt: active.expires_at }, error: null };
}

// validDays: null means "no expiry" (share-link/index.ts, Task-2 contract).
// `expiresAt` in the return value is computed HERE, in the client, from
// `validDays`; the function itself returns only { token, url } on
// `erstellen`, no expires_at. This is purely informative for display
// ("valid until …"), never for a check: the only authoritative clock is
// the function's own (beurteileToken there compares against the expires_at
// row actually stored in share_links). A deviation of a few seconds from
// network latency doesn't matter for a display text.
export async function createLink(tripId: string, validDays: number | null): Promise<Loaded<ActiveLink | null>> {
  const { data, error } = await supabase.functions.invoke('share-link', {
    body: { aktion: 'erstellen', trip_id: tripId, gueltig_tage: validDays },
  });
  if (error) {
    return { data: null, error: await functionErrorText(error, CREATE_ERROR) };
  }
  const antwort = data as { token?: unknown; url?: unknown } | null;
  if (!antwort || typeof antwort.token !== 'string' || typeof antwort.url !== 'string') {
    return { data: null, error: CREATE_ERROR };
  }
  const expiresAt = validDays === null ? null : new Date(Date.now() + validDays * 86_400_000).toISOString();
  return { data: { token: antwort.token, url: antwort.url, expiresAt }, error: null };
}

// Idempotent server-side (share-link/index.ts), a second revoke is not an
// error, this function passes that through unchanged.
export async function revokeLink(token: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase.functions.invoke('share-link', {
    body: { aktion: 'widerrufen', token },
  });
  if (error) {
    return { error: await functionErrorText(error, REVOKE_ERROR) };
  }
  const result = data as { ok?: boolean } | null;
  if (!result?.ok) return { error: REVOKE_ERROR };
  return { error: null };
}

// Whether this trip's recap is currently shared, for ALL fellow travelers.
//
// `fetchActiveLink` above answers the same question, but only for the
// owner: the SELECT policy on share_links is owner-only, and it stays that
// way, because whoever reads the row reads the token, and the token IS the
// authorization. Whoever came along still has a right to know that their
// moments are currently sitting behind a public URL, places included.
//
// Hence a database function that only says yes or no
// (`public.recap_ist_geteilt`, migration 20260810100000). It checks
// membership itself and applies the same three conditions as
// `share-link/aufloesen`: not revoked, not expired, row exists.
//
// The error case returns `null` instead of `false`, and that's the point:
// "not shared" and "we can't tell right now" are two different answers,
// and the second must not pass itself off as the first. A network error
// would otherwise turn into "your recap isn't shared", and that's the one
// direction this line must never be wrong in.
const SHARE_STATUS_ERROR =
  'Ob der Recap geteilt ist, liess sich gerade nicht prüfen. Probier es gleich nochmal.';

export async function isRecapShared(tripId: string): Promise<Loaded<boolean | null>> {
  // No direct destructuring: in tests the rpc mock sometimes stays
  // unconfigured and returns `undefined`, in real operation
  // `supabase.rpc()` always resolves to { data, error } (same safeguard
  // and same reason as in features/trips/tripsApi.ts).
  const result = await supabase.rpc('recap_ist_geteilt', { p_trip_id: tripId });
  const error = result?.error;
  if (error) return { data: null, error: message(error, SHARE_STATUS_ERROR) };
  // The function is `returns boolean` and can only deliver null if
  // something is fundamentally different than assumed. Then the same
  // applies as on error: better no answer than a false all-clear.
  const value = result?.data;
  if (typeof value !== 'boolean') return { data: null, error: SHARE_STATUS_ERROR };
  return { data: value, error: null };
}
