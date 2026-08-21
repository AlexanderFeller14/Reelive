import { assertEquals } from 'jsr:@std/assert';
import { normalizeTripIds, pickCoverRow, decideCover, MAX_TRIP_IDS } from './covers.ts';
import type { ReadCheckTrip } from './readAccess.ts';

// Real uuids, not 'a'/'b': trips.id is `uuid`, and normalizeTripIds now
// rejects anything not shaped like one (Finding 2 fix), so a fixture has to
// look like a real id or it gets filtered before the assertion is even
// interesting.
const TRIP_A = '11111111-1111-4111-8111-111111111111';
const TRIP_B = '22222222-2222-4222-8222-222222222222';

Deno.test('covers: a valid list of trip ids passes through unchanged', () => {
  assertEquals(normalizeTripIds([TRIP_A, TRIP_B]), { ok: true, tripIds: [TRIP_A, TRIP_B] });
});

Deno.test('covers: duplicates collapse, the answer carries one entry per trip', () => {
  assertEquals(normalizeTripIds([TRIP_A, TRIP_A, TRIP_B]), { ok: true, tripIds: [TRIP_A, TRIP_B] });
});

Deno.test('covers: a missing or non-array field is rejected', () => {
  assertEquals(normalizeTripIds(undefined), {
    ok: false, message: 'trip_ids fehlt oder ist ungültig.', status: 400,
  });
  assertEquals(normalizeTripIds('a'), {
    ok: false, message: 'trip_ids fehlt oder ist ungültig.', status: 400,
  });
});

Deno.test('covers: an empty list is a valid, empty answer, not an error', () => {
  assertEquals(normalizeTripIds([]), { ok: true, tripIds: [] });
});

Deno.test('covers: more than the cap is rejected instead of silently truncated', () => {
  const many = Array.from(
    { length: MAX_TRIP_IDS + 1 },
    (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
  );
  assertEquals(normalizeTripIds(many), {
    ok: false, message: 'Zu viele Reisen auf einmal.', status: 400,
  });
});

// Finding 2: trips.id is `uuid`, so a non-uuid string sent to Postgres via
// .eq('id', ...) used to raise 22P02 and route into the per-trip
// error-reporting path in index.ts, up to MAX_TRIP_IDS times per request,
// fully attacker-triggered by sending garbage strings. Such a string can
// never match a trip anyway, dropping it here removes the trigger.
Deno.test('covers: entries that are not uuid-shaped are dropped, they can never match a trip', () => {
  assertEquals(normalizeTripIds(['not-a-uuid', TRIP_A, '', null, 123]), {
    ok: true,
    tripIds: [TRIP_A],
  });
});

Deno.test('covers: the earliest moment with a thumbnail becomes the cover', () => {
  const rows = [
    { id: 'p1', type: 'photo' as const, media_ext: 'jpg', storage_key: 'k1', thumb_key: null },
    { id: 'p2', type: 'photo' as const, media_ext: 'jpg', storage_key: 'k2', thumb_key: 't2' },
  ];
  assertEquals(pickCoverRow(rows)?.id, 'p2');
});

Deno.test('covers: without a single thumbnail there is no cover', () => {
  const rows = [
    { id: 'p1', type: 'photo' as const, media_ext: 'jpg', storage_key: 'k1', thumb_key: null },
  ];
  assertEquals(pickCoverRow(rows), null);
});

// --- decideCover: the tripwire for Finding 1 --------------------------------
// These three exercise the exact same access chain read_access_test.ts
// exercises for `read`, but through decideCover, because that is now the
// single place index.ts calls. Drop the verdict check inside decideCover
// (or reintroduce the old inline composition in index.ts) and the first two
// of these fail: a sealed or non-member trip would start handing out a
// signed thumbnail.

const MEMBER = { user_id: '11111111-1111-4111-8111-111111111111' };
const REVEALED: ReadCheckTrip = { status: 'revealed' };
const SEALED: ReadCheckTrip = { status: 'active' };
const ROWS_WITH_THUMBNAIL = [
  { id: 'p1', type: 'photo' as const, media_ext: 'jpg', storage_key: 'trips/t/p1.jpg', thumb_key: null },
  { id: 'p2', type: 'photo' as const, media_ext: 'jpg', storage_key: 'trips/t/p2.jpg', thumb_key: 'trips/t/p2_t.jpg' },
];

Deno.test('covers: a revealed trip with thumbnails yields no cover for a non-member', () => {
  assertEquals(decideCover(REVEALED, null, ROWS_WITH_THUMBNAIL), null);
});

Deno.test('covers: a sealed trip yields no cover for a member', () => {
  assertEquals(decideCover(SEALED, MEMBER, ROWS_WITH_THUMBNAIL), null);
});

Deno.test('covers: a revealed trip with thumbnails yields the earliest thumbnail-bearing row for a member', () => {
  assertEquals(decideCover(REVEALED, MEMBER, ROWS_WITH_THUMBNAIL)?.id, 'p2');
});

// Archive stays readable, same rule as `read` ("put away is not locked
// away"): decideCover must not treat 'archived' as sealed.
Deno.test('covers: an archived trip with thumbnails still yields a cover for a member', () => {
  assertEquals(decideCover({ status: 'archived' }, MEMBER, ROWS_WITH_THUMBNAIL)?.id, 'p2');
});
