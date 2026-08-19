// Shared offline detection for all Supabase calls (authApi, tripsApi).
// DESIGN-LANGUAGE §6 requires that an error state name both cause AND
// remedy; "no network" is the one cause the user can fix themselves, so it
// must be named instead of disappearing into a generic "try again".

export const OFFLINE_HINT = 'Du bist offline. Verbinde dich und probier es nochmal.';

// Neither auth-js nor postgrest-js return a status code for an aborted
// network call; they pass the fetch error message through as `message`.
// Its wording depends on the platform:
//   Web/Node: "TypeError: Failed to fetch" / "AuthRetryableFetchError: ..."
//   React Native (Hermes): "TypeError: Network request failed"
// The second variant contains no "fetch", yet that's exactly the one that
// applies on the target device. The pattern therefore checks both
// wordings; a genuine Postgres/PostgREST error ("new row violates
// row-level security policy ...") contains neither.
const OFFLINE_MUSTER = /fetch|network request failed/i;

export function istOffline(error: { message?: string } | null | undefined): boolean {
  return OFFLINE_MUSTER.test(error?.message ?? '');
}
