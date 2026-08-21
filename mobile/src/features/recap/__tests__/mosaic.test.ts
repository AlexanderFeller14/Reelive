import { mosaicRows } from '../mosaic';
import type { RecapMoment } from '../types';

const moment = (id: string): RecapMoment => ({
  id, trip_id: 't1', author_id: 'u1', type: 'photo', duration_s: null, caption: null,
  captured_at: '2026-08-01T08:00:00Z', captured_tz: 'Europe/Zurich', place_name: null,
  lat: null, lng: null, upload_status: 'uploaded', authorName: 'Lea', authorAvatarKey: null,
});
const moments = (n: number) => Array.from({ length: n }, (_, i) => moment(`p${i + 1}`));

test('no moments, no rows', () => {
  expect(mosaicRows([])).toEqual([]);
});

test('a single moment stands full width instead of a lonely tile', () => {
  const rows = mosaicRows(moments(1));
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe('single');
  expect(rows[0].tiles.map((t) => t.shape)).toEqual(['wide']);
});

test('two moments stand side by side, not as a feature with a gap', () => {
  const rows = mosaicRows(moments(2));
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe('pair');
  expect(rows[0].tiles.map((t) => t.shape)).toEqual(['half', 'half']);
});

test('three moments make exactly one feature row', () => {
  const rows = mosaicRows(moments(3));
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe('feature');
  expect(rows[0].tiles.map((t) => t.shape)).toEqual(['lead', 'third', 'third']);
});

test('beyond the feature row the rest falls into rows of three', () => {
  const rows = mosaicRows(moments(9));
  expect(rows.map((r) => r.kind)).toEqual(['feature', 'triple', 'triple']);
  expect(rows[2].tiles).toHaveLength(3);
});

test('a last, shorter row is kept, never padded or dropped', () => {
  const rows = mosaicRows(moments(5));
  expect(rows.map((r) => r.kind)).toEqual(['feature', 'triple']);
  expect(rows[1].tiles.map((t) => t.moment.id)).toEqual(['p4', 'p5']);
});

test('the order of the moments survives the pattern untouched', () => {
  const ids = mosaicRows(moments(7)).flatMap((r) => r.tiles.map((t) => t.moment.id));
  expect(ids).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
});

test('the lead is the earliest moment of the day, never a chosen one', () => {
  const rows = mosaicRows(moments(4));
  expect(rows[0].tiles[0].shape).toBe('lead');
  expect(rows[0].tiles[0].moment.id).toBe('p1');
});
