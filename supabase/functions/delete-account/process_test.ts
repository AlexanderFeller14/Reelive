// Unit tests for the pure logic of delete-account, with no `supabase
// start`, no `functions serve`, no network, no permission:
//   cd supabase/functions/delete-account && npx deno test process_test.ts
//
// The most important test in this file is the second one: **should the
// storage step fail, the database is not touched at all.** That is promise
// W7 in its most concrete form, and it can only be checked by letting the
// storage step fail and then proving that the database step was NEVER
// called. Against the real stack this case would be hard to produce (the
// storage API would have to be deliberately broken), and a test that only
// exists in the integration run silently skips itself on any machine with
// no Docker.

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import {
  performDeletion,
  mediaKeys,
  pathBelongsToUs,
  type PostRow,
  collectAll,
  type Step,
} from './process.ts';
import { expectedKeys } from '../media-urls/keys.ts';

const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const USER = '11111111-1111-4111-8111-111111111111';

// A step that records whether and when it ran.
function step(name: string, result: { error: unknown } | 'throws', log: string[]): Step {
  return {
    name,
    run: () => {
      log.push(name);
      if (result === 'throws') throw new Error(`${name} ist geplatzt`);
      return Promise.resolve(result);
    },
  };
}

const OK = { error: null };

// ===========================================================================
// The order, promise W7
// ===========================================================================

Deno.test('order: storage first, then the database steps in exactly this sequence', async () => {
  const log: string[] = [];
  const result = await performDeletion(
    [step('storage', OK, log)],
    [
      step('leave-foreign-trips', OK, log),
      step('delete-own-trips', OK, log),
      step('delete-auth-user', OK, log),
    ],
  );
  assertEquals(result, { ok: true });
  assertEquals(log, [
    'storage',
    'leave-foreign-trips',
    'delete-own-trips',
    'delete-auth-user',
  ]);
});

Deno.test('W7: should the storage step fail, the database is NEVER touched', async () => {
  // The core of it. An object with no database row is garbage, nobody
  // knows its path anymore, since the row it could be derived from would
  // have just been cascaded away.
  const log: string[] = [];
  const result = await performDeletion(
    [step('storage', { error: { message: 'S3 nicht erreichbar' } }, log)],
    [
      step('leave-foreign-trips', OK, log),
      step('delete-own-trips', OK, log),
      step('delete-auth-user', OK, log),
    ],
  );

  assertFalse(result.ok);
  assertEquals(log, ['storage']);
  assertEquals(result, {
    ok: false,
    failedAt: 'storage',
    error: { message: 'S3 nicht erreichbar' },
    databaseTouched: false,
  });
});

Deno.test('W7: a thrown exception in the storage step holds the database back just the same', async () => {
  // Without try/catch, the error would pass the caller by on its way up,
  // which would happen to spare the database too, but only by accident.
  // Here it is guaranteed instead of merely assumed.
  const log: string[] = [];
  const result = await performDeletion(
    [step('storage', 'throws', log)],
    [step('delete-own-trips', OK, log)],
  );
  assertFalse(result.ok);
  assertEquals(log, ['storage']);
  assertFalse(result.ok && true);
  assertEquals((result as { databaseTouched: boolean }).databaseTouched, false);
});

Deno.test('a failing database step holds back the ones that follow', async () => {
  const log: string[] = [];
  const result = await performDeletion(
    [step('storage', OK, log)],
    [
      step('leave-foreign-trips', OK, log),
      step('delete-own-trips', { error: { code: '23503' } }, log),
      step('delete-auth-user', OK, log),
    ],
  );
  assertFalse(result.ok);
  // delete-auth-user must not have run: deleting the trips is its
  // precondition (trips.owner_id is on delete restrict).
  assertEquals(log, ['storage', 'leave-foreign-trips', 'delete-own-trips']);
  assertEquals((result as { failedAt: string }).failedAt, 'delete-own-trips');
  // The caller should be able to tell from the error whether a second
  // attempt starts on an untouched or a half-cleared state.
  assertEquals((result as { databaseTouched: boolean }).databaseTouched, true);
});

Deno.test('the steps run in sequence, not side by side', async () => {
  // A Promise.all over the same steps would be green in every test above,
  // the order in the log would even often stay the same by chance. Here
  // the second step demonstrably only starts once the first is DONE.
  const log: string[] = [];
  const slow: Step = {
    name: 'slow',
    run: async () => {
      log.push('slow:start');
      await new Promise((resolve) => setTimeout(resolve, 20));
      log.push('slow:end');
      return { error: null };
    },
  };
  const fast: Step = {
    name: 'fast',
    run: () => {
      log.push('fast:start');
      return Promise.resolve({ error: null });
    },
  };
  await performDeletion([step('storage', OK, log)], [slow, fast]);
  assertEquals(log, ['storage', 'slow:start', 'slow:end', 'fast:start']);
});

Deno.test('with no database steps, it stops at the storage step, and that one still runs', async () => {
  const log: string[] = [];
  const result = await performDeletion([step('storage', OK, log)], []);
  assertEquals(result, { ok: true });
  assertEquals(log, ['storage']);
});

// Since the profile picture feature there are two storage locations (R2 for
// moments, Supabase storage for avatars). The three tests below check
// exactly the property that justifies the signature change: both storage
// steps run before the database, in order, and a failure in EITHER of them
// leaves the database alone.

Deno.test('all storage steps run before the database', async () => {
  const order: string[] = [];
  const result = await performDeletion(
    [
      { name: 'media', run: async () => { order.push('media'); return { error: null }; } },
      { name: 'avatar', run: async () => { order.push('avatar'); return { error: null }; } },
    ],
    [{ name: 'db', run: async () => { order.push('db'); return { error: null }; } }],
  );
  assertEquals(result.ok, true);
  assertEquals(order, ['media', 'avatar', 'db']);
});

// The core of the guarantee: should ANY storage step fail, the database
// stays untouched. An account that still exists is better than one whose
// pictures sit orphaned in storage.
Deno.test('a failed second storage step leaves the database alone', async () => {
  let dbRan = false;
  const result = await performDeletion(
    [
      { name: 'media', run: async () => ({ error: null }) },
      { name: 'avatar', run: async () => ({ error: new Error('weg') }) },
    ],
    [{ name: 'db', run: async () => { dbRan = true; return { error: null }; } }],
  );
  assertEquals(result.ok, false);
  assertEquals(dbRan, false);
  if (!result.ok) {
    assertEquals(result.failedAt, 'avatar');
    assertEquals(result.databaseTouched, false);
  }
});

// After a failure no further storage step may run: the second one could
// delete something the first still needs, should someone later introduce a
// dependency between them.
Deno.test('the chain stops after a failed storage step', async () => {
  let secondRan = false;
  await performDeletion(
    [
      { name: 'media', run: async () => ({ error: new Error('weg') }) },
      { name: 'avatar', run: async () => { secondRan = true; return { error: null }; } },
    ],
    [],
  );
  assertEquals(secondRan, false);
});

// ===========================================================================
// Keys are derived, not taken as given
// ===========================================================================

Deno.test('mediaKeys: medium and thumbnail per moment, from the derivation', async () => {
  const posts: PostRow[] = [
    { id: 'p1', trip_id: TRIP, type: 'photo', media_ext: 'jpg' },
    { id: 'p2', trip_id: TRIP, type: 'video', media_ext: 'mov' },
  ];
  const keys = mediaKeys(posts);
  assertEquals(keys, [
    expectedKeys(TRIP, 'p1', 'photo', 'jpg').storage_key,
    expectedKeys(TRIP, 'p1', 'photo', 'jpg').thumb_key,
    expectedKeys(TRIP, 'p2', 'video', 'mov').storage_key,
    expectedKeys(TRIP, 'p2', 'video', 'mov').thumb_key,
  ]);
  // The video sits under .mov (iOS), not under the default .mp4, otherwise
  // the real file would stay behind and a non-existent one would get
  // "deleted".
  assert(keys[2].endsWith('.mov'), keys[2]);
  await Promise.resolve();
});

Deno.test('mediaKeys: a moment from a different trip produces THAT trip\'s path', () => {
  // trip_id comes from the posts row, not from a parameter, so a moment of
  // your own in a foreign trip gets deleted under the foreign trip's path,
  // and that is exactly where it sits too.
  const foreign = '00000000-0000-4000-8000-0000000000ff';
  assertEquals(
    mediaKeys([{ id: 'p9', trip_id: foreign, type: 'photo', media_ext: 'jpg' }])[0],
    `trips/${foreign}/p9.jpg`,
  );
});

Deno.test('mediaKeys: an empty list produces no keys', () => {
  assertEquals(mediaKeys([]), []);
});

// ===========================================================================
// The guard for client-written paths
// ===========================================================================

Deno.test('pathBelongsToUs: a foreign path in the own cover_key column is not deleted', () => {
  // The attack: whoever writes 'covers/lissabon.jpg', a FOREIGN trip's
  // cover image, into their own cover_key and then deletes their account
  // must not be able to take the foreign object down with it. An account
  // deletion must never become a tool against someone else's data.
  const allowed = [`trips/${TRIP}/`];
  assertFalse(pathBelongsToUs('covers/lissabon.jpg', allowed));
  assertFalse(pathBelongsToUs('trips/00000000-0000-4000-8000-0000000000ff/cover.jpg', allowed));
  assert(pathBelongsToUs(`trips/${TRIP}/cover.jpg`, allowed));
});

Deno.test('pathBelongsToUs: breakout attempts and nonsense are rejected', () => {
  const allowed = [`trips/${TRIP}/`, `profiles/${USER}/`];
  assertFalse(pathBelongsToUs(null, allowed));
  assertFalse(pathBelongsToUs(undefined, allowed));
  assertFalse(pathBelongsToUs('', allowed));
  assertFalse(pathBelongsToUs(`/trips/${TRIP}/cover.jpg`, allowed));
  assertFalse(pathBelongsToUs(`trips/${TRIP}/../${TRIP}x/cover.jpg`, allowed));
  // An empty prefix must not suddenly allow everything.
  assertFalse(pathBelongsToUs('irgendwas.jpg', ['']));
  assertFalse(pathBelongsToUs('irgendwas.jpg', []));
  assert(pathBelongsToUs(`profiles/${USER}/avatar.jpg`, allowed));
});

// ===========================================================================
// Collecting page by page
// ===========================================================================

function pageServer(count: number, pageSize: number) {
  const all = Array.from({ length: count }, (_, i) => ({ id: `p${String(i).padStart(4, '0')}` }));
  return {
    all,
    fetchPage: (from: number, withCount: boolean) =>
      Promise.resolve({
        rows: all.slice(from, from + pageSize),
        count: withCount ? count : null,
        error: null,
      }),
  };
}

Deno.test('collectAll: pages past the page boundary, otherwise two objects per overlooked moment would stay behind', async () => {
  const server = pageServer(1001, 1000);
  const { rows, lost, error } = await collectAll(server.fetchPage);
  assertEquals(error, null);
  assertEquals(rows.length, 1001);
  assertEquals(rows.map((r) => r.id), server.all.map((r) => r.id));
  assertEquals(lost, 0);
});

Deno.test('collectAll: a duplicate at the page boundary appears only once', async () => {
  const pages = [[{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }], []];
  let i = 0;
  const { rows, lost } = await collectAll((_from, withCount) =>
    Promise.resolve({ rows: pages[i++] ?? [], count: withCount ? 4 : null, error: null })
  );
  assertEquals(rows.map((r) => r.id), ['a', 'b', 'c']);
  assertEquals(lost, 1);
});

Deno.test('collectAll: a page made entirely of duplicates does not lead to an infinite loop', async () => {
  let fetches = 0;
  const { rows } = await collectAll((_from, withCount) => {
    fetches += 1;
    if (fetches > 5) return Promise.resolve({ rows: [], count: null, error: null });
    return Promise.resolve({ rows: [{ id: 'a' }, { id: 'a' }], count: withCount ? 99 : null, error: null });
  });
  assertEquals(rows.map((r) => r.id), ['a']);
  assert(fetches <= 6, `collectAll hat ${fetches} Abrufe gebraucht`);
});

Deno.test('collectAll: an error aborts and is passed through', async () => {
  const { error, rows } = await collectAll(() =>
    Promise.resolve({ rows: [] as Array<{ id: string }>, count: null, error: { message: 'kaputt' } })
  );
  assertEquals(error, { message: 'kaputt' });
  assertEquals(rows.length, 0);
});
