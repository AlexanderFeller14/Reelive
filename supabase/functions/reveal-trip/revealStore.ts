// The real I/O adapter for reveal.ts' `RevealStore` interface, a thin
// forward to a Supabase client (service role), the same queries as in the
// version before the extraction, only moved here. Its own file instead of
// part of reveal.ts: reveal.ts stays pure logic with no Supabase import,
// testable with no I/O at all; here sit exactly the two queries no unit
// test can replace,
//   - the CAS condition `.eq('status','active')` in the update
//     (updateIfActive)
//   - the recipient restriction `.in('user_id', userIds)` when deleting
//     tokens (deleteTokens),
// and which revealStore_integration_test.ts therefore checks directly
// (with no detour through HTTP or Expo) against the real local stack.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { RevealStore, TripRow } from './reveal.ts';

// Factory instead of a direct `createClient(...)` call: only this lets the
// return type be named cleanly. `ReturnType<typeof createClient>` alone
// (without the factory) infers a DIFFERENT type at this point than the
// actual call `createClient(url, key)`, createClient has interdependent
// generic default type parameters, and `typeof createClient` references
// the general function signature, not the defaults inferred at a concrete
// call site (an earlier version of this function had `deno check` fail
// because of this, see task-2-report.md).
export function createAdminClient(supabaseUrl: string, serviceRoleKey: string) {
  return createClient(supabaseUrl, serviceRoleKey);
}
export type AdminClient = ReturnType<typeof createAdminClient>;

export function createRevealStore(supabaseAdmin: AdminClient): RevealStore {
  return {
    async fetchTrip(tripId) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .select('id, name, owner_id, status, revealed_at')
        .eq('id', tripId)
        .maybeSingle();
      return { data: data as TripRow | null, error };
    },

    // `revealed_at: 'now'` is not a typo for `new Date().toISOString()`:
    // 'now' is a special date/time input value in Postgres (see the
    // Postgres docs "Special Date/Time Inputs"), which on cast to
    // timestamptz resolves to the start time of the EXECUTING transaction,
    // exactly the same behaviour as now()/CURRENT_TIMESTAMP in SQL, just
    // expressible as an ordinary update value over PostgREST (which does
    // not accept SQL function calls in the request body). Verified against
    // the local stack: two PATCH calls several seconds apart return
    // different values matching their respective execution time, so the
    // timestamp really comes from the database, never from Deno. That
    // matters for the latecomer rule (posts_insert_member,
    // supabase/migrations/20260803090300_sealing_rls.sql), which compares
    // `captured_at <= t.revealed_at`, BUT `captured_at` is device time: the
    // client sets the column itself on insert (column grant in
    // supabase/migrations/20260803090600_role_hardening.sql, section 2).
    // The comparison therefore runs device time against server time either
    // way, `now` does not remove this larger, fundamentally unavoidable
    // delta. What `now` removes is the additional, smaller drift that
    // would arise WERE Deno itself to compute a timestamp (e.g. `new
    // Date().toISOString()`) and write it as a literal into the same
    // column: then revealed_at would additionally depend on the Deno
    // host's clock, which can differ from the DB server clock. `now` makes
    // sure revealed_at depends exclusively on ONE clock, the DB server's,
    // the same one that also determines when a `captured_at` value counts
    // as a latecomer.
    //
    // The CAS condition `.eq('status','active')`: only an update whose
    // WHERE clause still holds at execution time affects a row. Two
    // genuinely parallel calls serialize on Postgres's row lock, the second
    // one already sees status='revealed' at execution time and affects 0
    // rows. That is the part revealStore_integration_test.ts proves
    // directly (with no HTTP) against the real stack.
    async updateIfActive(tripId) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .update({ status: 'revealed', revealed_at: 'now' })
        .eq('id', tripId)
        .eq('status', 'active')
        .select('revealed_at')
        .maybeSingle();
      return { data: data as { revealed_at: string } | null, error };
    },

    async fetchRevealedAtFollowUp(tripId) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .select('revealed_at')
        .eq('id', tripId)
        .maybeSingle();
      return { data: data as { revealed_at: string | null } | null, error };
    },

    async fetchMembers(tripId) {
      const { data, error } = await supabaseAdmin
        .from('trip_members')
        .select('user_id')
        .eq('trip_id', tripId);
      return { data: data as { user_id: string }[] | null, error };
    },

    async fetchTokens(userIds) {
      const { data, error } = await supabaseAdmin
        .from('push_tokens')
        .select('token')
        .in('user_id', userIds);
      return { data: data as { token: string }[] | null, error };
    },

    // userIds in addition to tokens (review minor, see the comment in
    // reveal.ts/sendRevealPush): limits a mapping wrongly read as
    // DeviceNotRegistered to the just-notified recipient circle, instead of
    // running as the service role over the whole table. Checked directly
    // in revealStore_integration_test.ts.
    async deleteTokens(tokens, userIds) {
      const { error } = await supabaseAdmin
        .from('push_tokens')
        .delete()
        .in('token', tokens)
        .in('user_id', userIds);
      return { error };
    },
  };
}
