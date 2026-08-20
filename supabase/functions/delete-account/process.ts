// The pure logic of delete-account, the ORDER and what goes into it. No
// I/O: no Deno.serve, no Supabase client, no network.
//
// Pattern like media-urls/readAccess.ts, reveal-trip/reveal.ts, and
// share-link/{resolution,management}.ts: the decision something hangs on
// stands as a pure function and is checked with no Docker (process_test.ts).
// The integration test is the second layer, never the only one.
//
// ---------------------------------------------------------------------------
// Why the order here IS the actual guarantee (Spec §4, W7)
// ---------------------------------------------------------------------------
// An object with no database row is garbage, nobody knows its path anymore,
// it sits in storage forever and costs money. A database row with no object
// is a broken recap, a tile that loads into nothing for every fellow
// traveller. Of the two failure directions, the first is the worse one,
// because it is invisible and irreversible.
//
// So: STORAGE FIRST, database after. And should ONE storage step fail, even
// just one of several (since the profile picture there are two: the
// moments in R2, the avatar in Supabase Storage), the database is NOT
// touched AT ALL. An account that still exists is better than one whose
// media sits orphaned in storage; and because deleting is idempotent in
// both places (an already-deleted key is not an error, verified against
// S3-compatible object storage APIs, see store.ts/createS3Deleter, and
// documented for the storage API in store.ts/deleteAvatar), a second
// attempt cleanly finishes the deletion instead of leaving a remainder.

import { expectedKeys } from '../media-urls/keys.ts';

// ---------------------------------------------------------------------------
// 1. Which keys belong to it at all
// ---------------------------------------------------------------------------

export type PostRow = {
  id: string;
  trip_id: string;
  type: 'photo' | 'video';
  media_ext: string | null;
};

// Medium and thumbnail of every passed-in moment, DERIVED, never taken from
// posts.storage_key. Same reason as in media-urls and share-link, here
// though with the opposite sign, and so even more important: there the
// derivation decides which object someone may READ; here it decides which
// object gets DELETED. A path taken from the column would turn an account
// deletion into a tool for removing someone else's media, storage_key is
// client-written (see keys.ts).
export function mediaKeys(posts: PostRow[]): string[] {
  const keys: string[] = [];
  for (const post of posts) {
    const derived = expectedKeys(post.trip_id, post.id, post.type, post.media_ext);
    keys.push(derived.storage_key, derived.thumb_key);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// 2. The guard for client-written path columns
// ---------------------------------------------------------------------------
// `trips.cover_key` and `profiles.avatar_key` are text columns a client may
// set freely (grant insert/update (…, cover_key, …) on public.trips,
// 20260803090200_membership_rls.sql; avatar_key via the profile update).
// There is NO derivation for them the way keys.ts has one for moments, and
// the only values that exist today at all sit in supabase/seed.sql and look
// like this: 'covers/norwegen.jpg'. A flat namespace with no binding to an
// owner whatsoever.
//
// That would make a bare "delete whatever sits in the column" a serious
// hole: whoever writes 'covers/lissabon.jpg', a foreign trip's cover image
// file, into their own cover_key and then deletes their account would take
// the foreign object down with it. An account deletion must never become a
// tool against someone else's data.
//
// Hence this guard: such a path only ever gets deleted when it sits under a
// prefix demonstrably belonging to this deletion (`trips/<own trip_id>/`
// resp. `profiles/<own user_id>/`). Whatever does not fit stays put and
// gets logged, an orphaned object is better than a deleted foreign one.
// Today nothing fits, because no code path ever writes these columns; the
// moment a later feature introduces an owner-bound scheme (the only safe
// one), the deletion applies on its own.
export function pathBelongsToUs(key: string | null | undefined, allowedPrefixes: string[]): boolean {
  if (typeof key !== 'string' || key.length === 0) return false;
  // No breaking out upward and no absolute paths, regardless of the prefix.
  if (key.includes('..') || key.startsWith('/')) return false;
  return allowedPrefixes.some((prefix) => prefix.length > 0 && key.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// 3. Collecting page by page
// ---------------------------------------------------------------------------
// PostgREST caps every response at max_rows (supabase/config.toml: 1000),
// with no error, no hint. For an account deletion that weighs differently
// than for reading: an overlooked moment does not mean "the recap is
// shorter", it means "two objects stay in storage forever, and nobody knows
// their path anymore", the database row it could be derived from has just
// been cascaded away.
//
// Same loop as in share-link/resolution.ts (offset = "however many the
// server has delivered", duplicate protection, two termination conditions),
// deliberately generic here instead of imported: the two functions have
// nothing else to do with each other, and a shared file between them would
// be coupling with no benefit.
export type PageResult<T> = { rows: T[]; count: number | null; error: unknown };
export type FetchPageFn<T> = (from: number, withCount: boolean) => Promise<PageResult<T>>;

export async function collectAll<T extends { id: string }>(
  fetchPage: FetchPageFn<T>,
): Promise<{ rows: T[]; lost: number; error: unknown }> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let fetchedCount = 0;
  let countedTotal: number | null = null;

  for (;;) {
    const page = await fetchPage(fetchedCount, countedTotal === null);
    if (page.error) return { rows, lost: 0, error: page.error };
    if (countedTotal === null) countedTotal = page.count;

    // The offset grows against what was DELIVERED, never against what was
    // kept, otherwise it would stand still on a page made entirely of
    // duplicates (infinite loop).
    fetchedCount += page.rows.length;
    for (const row of page.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }

    if (page.rows.length === 0) break;
    if (countedTotal !== null && fetchedCount >= countedTotal) break;
  }

  const lost = countedTotal === null ? 0 : Math.max(0, countedTotal - rows.length);
  return { rows, lost, error: null };
}

// ---------------------------------------------------------------------------
// 4. The order
// ---------------------------------------------------------------------------

export type Step = {
  name: string;
  run: () => Promise<{ error: unknown }>;
};

export type DeletionResult =
  | { ok: true }
  | { ok: false; failedAt: string; error: unknown; databaseTouched: boolean };

// storage runs FIRST and alone. Only once ALL storage steps come back with
// no error does the database begin, and its steps run strictly in
// sequence, each only after the previous one.
//
// Since the profile picture there are two storage locations: the moments in
// R2 and the avatar in Supabase Storage. Both have to finish before the
// database is touched, since an object with no row is garbage nobody finds
// again. A list instead of a single step keeps this guarantee and still
// lets `failedAt` name which storage failed.
//
// No Promise.all, neither here nor for the database: the database steps
// depend on each other (`trips.owner_id -> profiles.id` is the only
// on-delete-restrict relationship in the schema, the auth user can only be
// deleted once their own trips are gone), and the storage steps are the
// precondition for everything after. Running side by side would also mean:
// should the first storage step fail, the second would still start
// anyway, even though the result gets discarded regardless, unnecessary
// work, and a trap for the day someone introduces a dependency between the
// steps.
//
// `databaseTouched` is part of the result and not just an internal
// variable: the caller should be able to tell from the error whether a
// second attempt starts on an untouched or on a half-cleared state. Both
// paths are repeatable, but they do not tell the person in front of it the
// same story.
export async function performDeletion(
  storage: Step[],
  database: Step[],
): Promise<DeletionResult> {
  for (const step of storage) {
    let result: { error: unknown };
    try {
      result = await step.run();
    } catch (err) {
      // A thrown exception is the same case as a returned error: the
      // database stays untouched. Without this try/catch, the error would
      // pass the caller by on its way up, which would happen to spare the
      // database too, but only by accident.
      return { ok: false, failedAt: step.name, error: err, databaseTouched: false };
    }
    if (result.error) {
      return {
        ok: false,
        failedAt: step.name,
        error: result.error,
        databaseTouched: false,
      };
    }
  }

  for (const step of database) {
    let result: { error: unknown };
    try {
      result = await step.run();
    } catch (err) {
      return { ok: false, failedAt: step.name, error: err, databaseTouched: true };
    }
    if (result.error) {
      return { ok: false, failedAt: step.name, error: result.error, databaseTouched: true };
    }
  }

  return { ok: true };
}
