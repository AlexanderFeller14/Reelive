import { assertEquals } from 'jsr:@std/assert';
import { normalizeTripIds, pickCoverRow, MAX_TRIP_IDS } from './covers.ts';

Deno.test('covers: a valid list passes through unchanged', () => {
  assertEquals(normalizeTripIds(['a', 'b']), { ok: true, tripIds: ['a', 'b'] });
});

Deno.test('covers: duplicates collapse, the answer carries one entry per trip', () => {
  assertEquals(normalizeTripIds(['a', 'a', 'b']), { ok: true, tripIds: ['a', 'b'] });
});

Deno.test('covers: a missing or non-array field is rejected', () => {
  assertEquals(normalizeTripIds(undefined), { ok: false, message: 'trip_ids fehlt.', status: 400 });
  assertEquals(normalizeTripIds('a'), { ok: false, message: 'trip_ids fehlt.', status: 400 });
});

Deno.test('covers: an empty list is a valid, empty answer, not an error', () => {
  assertEquals(normalizeTripIds([]), { ok: true, tripIds: [] });
});

Deno.test('covers: more than the cap is rejected instead of silently truncated', () => {
  const many = Array.from({ length: MAX_TRIP_IDS + 1 }, (_, i) => `t${i}`);
  assertEquals(normalizeTripIds(many), {
    ok: false, message: 'Zu viele Reisen auf einmal.', status: 400,
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
