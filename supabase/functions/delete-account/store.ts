// The real I/O adapter for delete-account, the same division of roles as
// share-link/store.ts against resolution.ts and reveal-trip/revealStore.ts
// against reveal.ts: process.ts stays pure logic with no Supabase import,
// here sit exactly the queries no unit test can replace and that
// delete_account_integration_test.ts therefore checks against the real
// stack.
//
// The five that matter:
//   - `leaveForeignTrips` runs with the PERSON's own JWT, not the service
//     role. The reason lives there and is not a detail.
//   - `deleteOwnTrips` resolves the schema's only on-delete-restrict
//     relationship and thereby triggers the biggest cascade.
//   - `deleteObjects` in blocks, with the (measured) property that an
//     already-deleted key is NOT an error.
//   - `deleteAvatar` in its own `avatare` bucket, the same property, just
//     via the storage API instead of S3 (reasoning there).
//   - the count queries for the dialog: they have to tell the truth.
//
// ---------------------------------------------------------------------------
// Why `deleteObjects` runs over the S3 protocol, not the Supabase storage
// API
// ---------------------------------------------------------------------------
// Until the Phase 6 final review this file deleted via
// `supabaseAdmin.storage.from(bucket).remove(...)`, the only place in the
// whole repo that addressed storage via the storage API instead of S3.
// media-urls and share-link both sign via `S3_ENDPOINT` (aws4fetch, SigV4).
// README.md promises that switching to Cloudflare R2 changes "only the
// endpoint and credentials", a promise that did not hold for this
// function: a deployed R2 bucket is not known to the storage API at all
// (it only knows the local Supabase storage service), so `remove()` there
// would either have silently hit nothing (unknown keys are, by the same
// "not an error" principle, not a failure) or permanently responded with
// an error, depending on whether the storage service even still exists.
// Either way would have made W6 ("a deleted account leaves no object
// behind") green locally and silently wrong in a real deployment.
//
// Now this function too deletes via `S3_ENDPOINT`, with the same five
// environment variables as media-urls/share-link (see index.ts), through
// the same aws4fetch signing. The R2 switch therefore really only touches
// endpoint and credentials, equally for all three functions.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { AwsClient } from 'npm:aws4fetch@1';
import type { PostRow, PageResult } from './process.ts';

export function createAdminClient(supabaseUrl: string, serviceRoleKey: string) {
  return createClient(supabaseUrl, serviceRoleKey);
}
export type AdminClient = ReturnType<typeof createAdminClient>;

// A client acting as the requesting PERSON (anon key + her JWT), not as the
// service role. PostgREST thereby runs its requests as `authenticated`
// with auth.uid() set.
export function createPersonClient(supabaseUrl: string, anonKey: string, jwt: string) {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Page size when collecting moments. Aligned with max_rows from
// supabase/config.toml (1000); the correctness of the loop in collectAll
// does not depend on the two numbers being equal.
export const POSTS_PAGE_SIZE = 1000;

// Block size when deleting in storage. Unlike the storage API (one call, a
// list of paths), the S3 protocol only knows a single DELETE per object,
// `deleteObjectsInBlocks` therefore sends up to OBJECT_BLOCK_SIZE requests
// SIDE BY SIDE per block (Promise.all), instead of all keys at once: a
// single block therefore stays within a time limit, and progress between
// blocks is preserved, a second attempt after a partial abort then only
// skips what is already gone (see deleteObjectsInBlocks).
export const OBJECT_BLOCK_SIZE = 200;

// The avatar bucket, a constant instead of an environment variable: unlike
// the S3 variables (which change between local and R2), this bucket is
// named the same locally and in production, `avatare`
// (supabase/config.toml, [storage.buckets.avatare]), so there is nothing to
// configure.
const AVATAR_BUCKET = 'avatare';

export type TripRow = { id: string; cover_key: string | null };
export type DeletionCounts = {
  own_trips: number;
  moments_in_own_trips: number;
  affected_people: number;
  own_moments_elsewhere: number;
};

export interface AccountStore {
  fetchOwnTrips(userId: string): Promise<{ data: TripRow[] | null; error: unknown }>;
  fetchAvatarKey(userId: string): Promise<{ data: string | null; error: unknown }>;

  fetchPostsPageInTrips(tripIds: string[], from: number, withCount: boolean): Promise<PageResult<PostRow>>;
  fetchOwnPostsPageElsewhere(
    userId: string,
    ownTripIds: string[],
    from: number,
    withCount: boolean,
  ): Promise<PageResult<PostRow>>;

  fetchCounts(userId: string, ownTripIds: string[]): Promise<{ data: DeletionCounts | null; error: unknown }>;

  deleteObjects(keys: string[]): Promise<{ error: unknown }>;
  deleteAvatar(key: string | null): Promise<{ error: unknown }>;
  leaveForeignTrips(userId: string, ownTripIds: string[]): Promise<{ error: unknown }>;
  deleteOwnTrips(tripIds: string[]): Promise<{ error: unknown }>;
  deleteAuthUser(userId: string): Promise<{ error: unknown }>;
}

// PostgREST `in` filters need a list in parentheses. For an empty list
// `in.()` would be a syntax error, so callers check for empty beforehand,
// and this helper exists only so the quoting lives in one place. UUIDs
// contain no commas or quotes; the values also come exclusively from the
// database, never from the request body.
function idList(ids: string[]): string {
  return `(${ids.join(',')})`;
}

// ---------------------------------------------------------------------------
// Deleting in storage, over S3, one DELETE per key
// ---------------------------------------------------------------------------

// Result of ONE DELETE. `ok` is the only value `deleteObjectsInBlocks`
// evaluates, `status`/`error` only exist for the error message, should `ok`
// be false.
export type DeleteOneResult = { ok: boolean; status: number; error?: unknown };
export type DeleteOneFn = (key: string) => Promise<DeleteOneResult>;

// The pure blocking/short-circuit logic, extracted from the S3 signing
// (style like `collectAll` in process.ts and `send`/`toBlocks` in
// reveal-trip/push.ts): an injectable `deleteOne` function makes this
// testable with no real network (see store_test.ts), the real signing sits
// exclusively in `createS3Deleter` further below.
//
// In blocks AND parallel within a block (Promise.all): unlike the previous
// storage API version, which made exactly one HTTP call per block with a
// list of paths, the S3 protocol only knows one DELETE per object. With no
// parallelism within a block, an account deletion with hundreds of objects
// would be noticeably slower than before, with it the number of
// simultaneous requests stays capped by OBJECT_BLOCK_SIZE, exactly the way
// the previous version capped the size of a single storage API request.
export async function deleteObjectsInBlocks(
  keys: string[],
  deleteOne: DeleteOneFn,
  blockSize: number = OBJECT_BLOCK_SIZE,
): Promise<{ error: unknown }> {
  for (let i = 0; i < keys.length; i += blockSize) {
    const block = keys.slice(i, i + blockSize);
    const results = await Promise.all(block.map((key) => deleteOne(key)));
    const failed = results.find((r) => !r.ok);
    if (failed) {
      return {
        error: failed.error ?? new Error(`S3 DELETE fehlgeschlagen: HTTP ${failed.status}`),
      };
    }
  }
  return { error: null };
}

// The real adapter: signs and sends ONE S3 DELETE. `signQuery: true`
// produces the same kind of request as `objectSize` in
// media-urls/index.ts (HEAD via a presigned URL), just with method DELETE
// instead of HEAD.
//
// Important AND verified, the same property as before with the storage
// API: a key under which no object (still) sits is NOT an error.
// S3-compatible object storages (AWS S3, Cloudflare R2, the local Supabase
// storage service via its S3 gateway) answer a DELETE against a
// non-(no longer)-existing key the same way as against an existing one,
// with a success status (typically 204 No Content), not a 404. Two things
// follow from this, word for word as in the previous version:
//   1. A second delete attempt after a partial abort runs through cleanly.
//      process.ts relies on exactly this when it would rather touch nothing
//      in the database at all on a storage step error.
//   2. "No error" does NOT mean "the object existed", the only instance
//      that can prove that is a test that puts an object down BEFOREHAND
//      and AFTERWARDS checks its absence through an independent path
//      (delete_account_integration_test.ts does exactly that via the
//      storage REST API, independent of the S3 path here). A test that
//      only checks "no error came back" would prove nothing, that is
//      exactly the trap point 2 warns about: "got back less than
//      requested" must not count as a failure, but it also proves no
//      success.
export function createS3Deleter(
  aws: AwsClient,
  s3Endpoint: string,
  bucket: string,
  fetchImpl: typeof fetch = fetch,
): DeleteOneFn {
  return async (key) => {
    const url = new URL(`${s3Endpoint}/${bucket}/${key}`);
    try {
      const signed = await aws.sign(url.toString(), { method: 'DELETE', aws: { signQuery: true } });
      const response = await fetchImpl(signed);
      await response.body?.cancel();
      if (!response.ok) return { ok: false, status: response.status };
      return { ok: true, status: response.status };
    } catch (err) {
      return { ok: false, status: 0, error: err };
    }
  };
}

export function createAccountStore(
  supabaseAdmin: AdminClient,
  personClient: AdminClient,
  deleteOne: DeleteOneFn,
): AccountStore {
  return {
    async fetchOwnTrips(userId) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .select('id, cover_key')
        .eq('owner_id', userId);
      return { data: data as TripRow[] | null, error };
    },

    async fetchAvatarKey(userId) {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('avatar_key')
        .eq('id', userId)
        .maybeSingle();
      const row = data as { avatar_key: string | null } | null;
      return { data: row?.avatar_key ?? null, error };
    },

    // ALL moments of the person's own trips, including fellow travellers'.
    // The trip gets deleted along with everything (Spec §3: "gets deleted
    // along with it, media of every member included"), so their objects
    // have to go too. Without this path, every foreign moment in an own
    // trip would leave an object pair behind whose path nobody knows
    // anymore afterwards.
    async fetchPostsPageInTrips(tripIds, from, withCount) {
      if (tripIds.length === 0) return { rows: [], count: withCount ? 0 : null, error: null };
      const { data, error, count } = await supabaseAdmin
        .from('posts')
        .select('id, trip_id, type, media_ext', withCount ? { count: 'exact' } : undefined)
        .in('trip_id', tripIds)
        .order('id', { ascending: true })
        .range(from, from + POSTS_PAGE_SIZE - 1);
      if (error) return { rows: [], count: null, error };
      return {
        rows: (data ?? []) as unknown as PostRow[],
        count: withCount ? (count ?? null) : null,
        error: null,
      };
    },

    // The person's own moments in FOREIGN trips. They disappear via
    // posts.author_id -> profiles (on delete cascade) once the auth user is
    // gone, but their objects only if they get collected here. `not.in`
    // instead of a second pass, so no moment that sits in an own trip AND
    // was authored by the person gets counted twice.
    async fetchOwnPostsPageElsewhere(userId, ownTripIds, from, withCount) {
      let query = supabaseAdmin
        .from('posts')
        .select('id, trip_id, type, media_ext', withCount ? { count: 'exact' } : undefined)
        .eq('author_id', userId);
      if (ownTripIds.length > 0) {
        query = query.not('trip_id', 'in', idList(ownTripIds));
      }
      const { data, error, count } = await query
        .order('id', { ascending: true })
        .range(from, from + POSTS_PAGE_SIZE - 1);
      if (error) return { rows: [], count: null, error };
      return {
        rows: (data ?? []) as unknown as PostRow[],
        count: withCount ? (count ?? null) : null,
        error: null,
      };
    },

    // The four numbers for the dialog. They have to tell the truth:
    // whoever has own trips deletes them along with everything, including
    // the moments of ALL members. A dialog that hides or downplays this
    // turns a decision into a trap.
    async fetchCounts(userId, ownTripIds) {
      const countRows = async (
        table: 'posts' | 'trip_members',
        build: (
          q: ReturnType<ReturnType<AdminClient['from']>['select']>,
        ) => ReturnType<ReturnType<AdminClient['from']>['select']>,
      ): Promise<{ count: number; error: unknown }> => {
        const { count, error } = await build(
          supabaseAdmin.from(table).select('*', { count: 'exact', head: true }),
        );
        return { count: count ?? 0, error };
      };

      const momentsInOwn = ownTripIds.length === 0
        ? { count: 0, error: null }
        : await countRows('posts', (q) => q.in('trip_id', ownTripIds));
      if (momentsInOwn.error) return { data: null, error: momentsInOwn.error };

      const ownElsewhere = await countRows('posts', (q) => {
        const withAuthor = q.eq('author_id', userId);
        return ownTripIds.length > 0 ? withAuthor.not('trip_id', 'in', idList(ownTripIds)) : withAuthor;
      });
      if (ownElsewhere.error) return { data: null, error: ownElsewhere.error };

      // Affected people: every member of the person's own trips except
      // herself, each person counted only once, someone can be in several
      // own trips. Hence fetching the rows and de-duplicating in JS
      // instead of taking count: PostgREST cannot do `count(distinct …)`.
      let affected = 0;
      if (ownTripIds.length > 0) {
        const { data, error } = await supabaseAdmin
          .from('trip_members')
          .select('user_id')
          .in('trip_id', ownTripIds)
          .neq('user_id', userId);
        if (error) return { data: null, error };
        affected = new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)).size;
      }

      return {
        data: {
          own_trips: ownTripIds.length,
          moments_in_own_trips: momentsInOwn.count,
          affected_people: affected,
          own_moments_elsewhere: ownElsewhere.count,
        },
        error: null,
      };
    },

    // The actual logic (blocking, short-circuit on errors) lives in
    // deleteObjectsInBlocks above, only the wiring with the really-signing
    // `deleteOne` sits here, which index.ts builds from the S3 environment
    // variables (createS3Deleter).
    async deleteObjects(keys) {
      return deleteObjectsInBlocks(keys, deleteOne);
    },

    // The avatar does NOT live in the moments' S3 bucket, but in the
    // Supabase storage bucket `avatare` (spec
    // 2026-08-12-profilbild-design.md). Hence this path instead of
    // deleteObjects/createS3Deleter: the same admin client the store
    // already holds, and a bucket name as a constant, since it is named the
    // same locally and in production.
    //
    // An already-deleted object is not an error (remove() is idempotent),
    // the same property the whole deletion's repeatability rests on (see
    // createS3Deleter).
    async deleteAvatar(key: string | null): Promise<{ error: unknown }> {
      if (!key) return { error: null };
      const { error } = await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([key]);
      return { error };
    },

    // The person's own trip_members rows in FOREIGN trips, and specifically
    // in the person's own name, not as the service role. That is not a
    // matter of style:
    //
    // trip_members carries a delete trigger
    // (rotate_invite_code_on_member_removal, 20260807090000). It rolls a
    // new trips.invite_code WHEN the deleting person is not the one deleted,
    // or when no client context exists at all, because then a forced
    // removal cannot be ruled out. A service role has no auth.uid(), and
    // GoTrue even less so. Were the cascade from deleting the auth user
    // left to clear these rows, the invite code of EVERY trip the person
    // was a member of would rotate, and everyone else who was invited would
    // run into "Diesen Einladungslink gibt es nicht mehr." with their link.
    // That exact damage was the reason for that migration.
    //
    // Deleting an account is, in substance, a voluntary leaving, not a
    // forced removal. With the person's own JWT, the trigger's early-exit
    // condition applies (auth.uid() = old.user_id), and everyone else's
    // links stay valid. The policy trip_members_delete allows exactly that
    // (`user_id = auth.uid() and role <> 'owner'`).
    //
    // The person's own trips are excluded: there the role is 'owner', the
    // policy forbids it, and the rows disappear along with the trip
    // regardless.
    async leaveForeignTrips(userId, ownTripIds) {
      let query = personClient.from('trip_members').delete().eq('user_id', userId);
      if (ownTripIds.length > 0) {
        query = query.not('trip_id', 'in', idList(ownTripIds));
      }
      const { error } = await query;
      return { error };
    },

    // Resolves the schema's ONLY on-delete-restrict relationship
    // (trips.owner_id -> profiles.id, 20260803090600_role_hardening.sql:87-89).
    // Without this step, deleting the auth user fails with 23503. The
    // cascade clears the trip's posts, trip_members, share_links, and via
    // the posts also reactions, comments, and reports.
    async deleteOwnTrips(tripIds) {
      if (tripIds.length === 0) return { error: null };
      const { error } = await supabaseAdmin.from('trips').delete().in('id', tripIds);
      return { error };
    },

    // Last. The cascade profiles.id -> auth.users clears the profile, and
    // from there everything still pointing at the person.
    async deleteAuthUser(userId) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      return { error };
    },
  };
}
