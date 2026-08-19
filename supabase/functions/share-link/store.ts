// The real I/O adapter for share-link, the same division of roles as
// reveal-trip/revealStore.ts against reveal.ts: resolution.ts stays pure
// logic with no Supabase import, here sit exactly the queries no unit test
// can replace and that the integration test therefore checks against the
// real stack:
//
//   - the ONE query that fetches the token row AND the trip together (see
//     fetchTokenWithTrip, the reason is not convenience, but timing
//     behaviour)
//   - `.eq('trip_id', …)` and `.eq('upload_status', 'uploaded')` while
//     collecting the moments (W1 and "only finished uploads")
//   - the sort by captured_at, id (global constraint)
//   - the embed on profiles for author name AND picture key (since Task 10:
//     display_name, avatar_key). author_id sits in no select list, that
//     does not make it secret anymore though, it travels inside avatar_key.
//     Reasoning at the query itself (fetchMomentsPage, point 4)
import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { ResolutionTrip, MomentRow, PageResult, ShareLinkRow, TripStatus } from './resolution.ts';

// Factory instead of a direct `createClient(...)` call: only this lets the
// return type be named cleanly. `ReturnType<typeof createClient>` alone
// infers a DIFFERENT type at this point than the actual call
// `createClient(url, key)`, createClient has interdependent generic default
// type parameters (details in reveal-trip/revealStore.ts).
export function createAdminClient(supabaseUrl: string, serviceRoleKey: string) {
  return createClient(supabaseUrl, serviceRoleKey);
}
export type AdminClient = ReturnType<typeof createAdminClient>;

// Page size when collecting moments. Aligned with max_rows from
// supabase/config.toml (1000): bigger has no effect, since PostgREST caps
// there anyway, smaller only costs extra round trips. The correctness of
// the loop in collectMoments does NOT depend on the two numbers being
// equal.
export const POSTS_PAGE_SIZE = 1000;

// `name` has been included since the share notification: the push text
// names the trip ("… euren Recap von «Lissabon» geteilt"), and fetching it
// afterwards through a second query would mean loading the same record
// twice.
export type TripForCreate = { id: string; owner_id: string; status: TripStatus; name: string };
export type TokenOwner = { token: string; trip_id: string; owner_id: string; name: string };

export interface ShareStore {
  // Token row and trip in ONE query.
  fetchTokenWithTrip(
    token: string,
  ): Promise<{ row: ShareLinkRow | null; trip: ResolutionTrip | null; error: unknown }>;

  fetchMomentsPage(tripId: string, from: number, withCount: boolean): Promise<PageResult>;

  fetchTripForCreate(tripId: string): Promise<{ data: TripForCreate | null; error: unknown }>;

  createLink(tripId: string, expiresAt: string | null): Promise<{ token: string | null; error: unknown }>;

  fetchTokenOwner(token: string): Promise<{ data: TokenOwner | null; error: unknown }>;

  revokeLink(token: string): Promise<{ error: unknown }>;

  // The three paths of the share notification (notification.ts), word
  // for word the same as the reveal store's: the same table, the same
  // restriction, and when deleting the same extra limit to the notified
  // circle.
  fetchMembers(tripId: string): Promise<{ data: { user_id: string }[] | null; error: unknown }>;

  fetchTokens(userIds: string[]): Promise<{ data: { token: string }[] | null; error: unknown }>;

  deleteTokens(tokens: string[], userIds: string[]): Promise<{ error: unknown }>;

  // The display name of the owner for the notification text. A failure
  // here only costs the name, not the notification (see sendSharePush).
  fetchDisplayName(userId: string): Promise<{ data: string | null; error: unknown }>;
}

// Raw shape of the PostgREST embed: `trips(...)` comes back as an embedded
// object (many-to-one via share_links.trip_id), in rare cases as a null
// object. supabase-js does not know the shape without generated database
// types, hence named once and cast once here, instead of spreading `any`
// across five places.
type ShareLinkWithTrip = {
  token: string;
  trip_id: string;
  expires_at: string | null;
  revoked: boolean;
  trips: { status: TripStatus; name: string; start_date: string; end_date: string } | null;
};

type PostWithProfile = {
  id: string;
  type: 'photo' | 'video';
  media_ext: string | null;
  storage_key: string;
  thumb_key: string | null;
  captured_at: string;
  captured_tz: string;
  place_name: string | null;
  // double precision in Postgres (20260803090100_content_tables.sql), so
  // number in JSON, and nullable, because a moment with no place sharing is
  // the normal case.
  lat: number | null;
  lng: number | null;
  caption: string | null;
  duration_s: number | null;
  // avatar_key has been in the embed since Task 10: the same join that
  // already fetches display_name, so no extra round trip. Nullable, because
  // a profile with no picture is the normal case (Avatar() then draws the
  // initial, see mobile/src/components/Avatar.tsx).
  profiles: { display_name: string; avatar_key: string | null } | null;
};

export function createShareStore(supabaseAdmin: AdminClient): ShareStore {
  return {
    // ONE query for token and trip, not two in sequence, and that is not
    // polish, it belongs to the guarantee of byte-identical rejections.
    //
    // With two queries an unknown token would need ONE round trip to the
    // database and a valid token TWO. The four rejections would then still
    // be byte-identical in content, but measurably different in timing:
    // "token unknown" would systematically come back faster than "trip not
    // revealed". That is exactly what Spec §5.1 explicitly warns against
    // ("with the same text and the same response time"). With the embed,
    // Postgres runs both in ONE statement (LATERAL join); all four
    // rejection paths consist of exactly one database round trip and one
    // return.
    //
    // What this does NOT eliminate, for honesty's sake: the index lookup on
    // the primary key differs between a hit and a miss by a fraction of a
    // microsecond, and a hit additionally pulls the trip row. That sits far
    // below the noise of an HTTP round trip over the network. It would only
    // be exploitable with very many measurements per candidate, and the
    // candidate space is 2^128 tokens.
    async fetchTokenWithTrip(token) {
      const { data, error } = await supabaseAdmin
        .from('share_links')
        .select('token, trip_id, expires_at, revoked, trips(status, name, start_date, end_date)')
        .eq('token', token)
        .maybeSingle();

      if (error) return { row: null, trip: null, error };

      const raw = data as unknown as ShareLinkWithTrip | null;
      if (!raw) return { row: null, trip: null, error: null };

      // The trip fields get SEPARATED from the token row here, so
      // evaluateToken gets the trip as its own argument and no single row
      // gets passed through as a whole.
      const row: ShareLinkRow = {
        token: raw.token,
        trip_id: raw.trip_id,
        expires_at: raw.expires_at,
        revoked: raw.revoked,
      };
      const trip: ResolutionTrip | null = raw.trips
        ? {
          status: raw.trips.status,
          name: raw.trips.name,
          start_date: raw.trips.start_date,
          end_date: raw.trips.end_date,
        }
        : null;
      return { row, trip, error: null };
    },

    // One page of moments. The loop over it sits in
    // resolution.ts/collectMoments (pure logic, testable with no stack);
    // here sit only the four parts that really depend on Postgres:
    //
    //   1. `.eq('trip_id', tripId)`, the trip_id comes from the share_links
    //      row. Without this restriction the query would run over the
    //      whole posts table, and the derivation comparison in buildMedia
    //      would be the only remaining barrier (W1).
    //   2. `.eq('upload_status', 'uploaded')`, a moment with 'pending' has
    //      no complete object in storage, a URL for it would be a 404 in
    //      the film roll.
    //   3. captured_at ascending, id as the second criterion (global
    //      constraint: never by created_at, never by upload time).
    //   4. the embed `profiles!posts_author_id_fkey(display_name,
    //      avatar_key)` (avatar_key added since Task 10, same join, no
    //      second round trip). The disambiguation is needed because
    //      PostgREST finds TWO relations between posts and profiles (the
    //      foreign key column author_id and the many-to-many path via
    //      reactions) and would otherwise abort with PGRST201. Only
    //      display_name and avatar_key are fetched, author_id sits in no
    //      select list of this file, but it has not been WITHHELD since the
    //      profile picture feature (2026-08-12) anymore: `avatar_key` reads
    //      `profiles/<author_id>/<32 hex>.jpg` and thereby carries the
    //      author's auth UUID into the anonymous response once she has a
    //      picture. Accepted deliberately (see addendum in
    //      docs/superpowers/specs/2026-08-08-phase-6-teilen-export-store-design.md
    //      §5.1): the UUID by itself grants no access, profiles RLS
    //      requires shared membership, `select` on storage.objects requires
    //      authenticated, and no anonymous endpoint accepts a raw uid. All
    //      that can be read off is that two shared recaps have the same
    //      author; the response names her anyway.
    async fetchMomentsPage(tripId, from, withCount) {
      const { data, error, count } = await supabaseAdmin
        .from('posts')
        .select(
          'id, type, media_ext, storage_key, thumb_key, captured_at, captured_tz, place_name, lat, lng, caption, duration_s, profiles!posts_author_id_fkey(display_name, avatar_key)',
          withCount ? { count: 'exact' } : undefined,
        )
        .eq('trip_id', tripId)
        .eq('upload_status', 'uploaded')
        .order('captured_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + POSTS_PAGE_SIZE - 1);

      if (error) return { rows: [], count: null, error };

      const raw = (data ?? []) as unknown as PostWithProfile[];
      const rows: MomentRow[] = raw.map((r) => ({
        id: r.id,
        type: r.type,
        media_ext: r.media_ext,
        storage_key: r.storage_key,
        thumb_key: r.thumb_key,
        captured_at: r.captured_at,
        captured_tz: r.captured_tz,
        place_name: r.place_name,
        lat: r.lat,
        lng: r.lng,
        caption: r.caption,
        duration_s: r.duration_s,
        author_name: r.profiles?.display_name ?? null,
        // Same pattern as author_name: `?.` instead of a crash for the
        // (today theoretical) case of a missing profile, `?? null` for the
        // REAL normal case "profile exists, but with no picture".
        author_avatar_key: r.profiles?.avatar_key ?? null,
      }));
      return { rows, count: withCount ? (count ?? null) : null, error: null };
    },

    // `create` checks ownership and status itself, because the service role
    // writes past RLS and share_links_insert_owner therefore never gets
    // evaluated at all.
    async fetchTripForCreate(tripId) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .select('id, owner_id, status, name')
        .eq('id', tripId)
        .maybeSingle();
      return { data: data as TripForCreate | null, error };
    },

    // token is NOT passed in: the column's default
    // (encode(gen_random_bytes(16), 'hex'), 20260803090100_content_tables.sql)
    // generates it in the database. A token generated in the function would
    // be a second source for the same thing, and the randomness would then
    // come from the edge runtime instead of pgcrypto.
    async createLink(tripId, expiresAt) {
      const { data, error } = await supabaseAdmin
        .from('share_links')
        .insert({ trip_id: tripId, expires_at: expiresAt })
        .select('token')
        .maybeSingle();
      const row = data as { token: string } | null;
      return { token: row?.token ?? null, error };
    },

    // For `revoke`: the token row plus ownership of the trip it belongs to,
    // again in one query. The reason here differs from fetchTokenWithTrip
    // (not timing behaviour, simply fewer round trips), the pattern is the
    // same.
    async fetchTokenOwner(token) {
      const { data, error } = await supabaseAdmin
        .from('share_links')
        .select('token, trip_id, trips(owner_id, name)')
        .eq('token', token)
        .maybeSingle();
      if (error) return { data: null, error };
      const raw = data as unknown as
        | { token: string; trip_id: string; trips: { owner_id: string; name: string } | null }
        | null;
      if (!raw || !raw.trips) return { data: null, error: null };
      return {
        data: {
          token: raw.token,
          trip_id: raw.trip_id,
          owner_id: raw.trips.owner_id,
          name: raw.trips.name,
        },
        error: null,
      };
    },

    // Deliberately no delete: a revoked link stays distinguishable from one
    // that never existed, so a support case stays answerable (Spec §5.1).
    // From the outside both look the same.
    //
    // No status criterion: a revocation makes a link weaker, never
    // stronger, and therefore has to work on an archived trip exactly like
    // on a revealed one. RLS does not apply to the service role anyway; the
    // corresponding relaxation for the direct client path sits in
    // supabase/migrations/20260808130000_share_links_widerruf_archiviert.sql.
    async revokeLink(token) {
      const { error } = await supabaseAdmin
        .from('share_links')
        .update({ revoked: true })
        .eq('token', token);
      return { error };
    },

    // Word for word the same as createRevealStore (reveal-trip/revealStore.ts):
    // ALL members, including the person who triggered it. The exclusion
    // happens in `recipientCircle` as a pure filter, so a test reaches it
    // with no Docker.
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

    // userIds in addition to tokens, the same restriction and the same
    // reason as in the reveal store: the ticket-to-token mapping is
    // position-based, a shifted block must never be allowed to delete
    // outside the notified circle.
    async deleteTokens(tokens, userIds) {
      const { error } = await supabaseAdmin
        .from('push_tokens')
        .delete()
        .in('token', tokens)
        .in('user_id', userIds);
      return { error };
    },

    async fetchDisplayName(userId) {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('display_name')
        .eq('id', userId)
        .maybeSingle();
      const row = data as { display_name: string } | null;
      return { data: row?.display_name ?? null, error };
    },
  };
}
