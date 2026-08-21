// Pure layout logic for a day's moments in the recap overview: no network, no React.
// Maps moments already sorted by captured_at into rows of tiles with varying shapes,
// ensuring a full-width display with no padding or gaps. Layout decisions only
// (which tile size applies to which moment) live here, so they can be tested
// without a running screen.

import type { RecapMoment } from './types';

export type MosaicTile = { moment: RecapMoment; shape: 'lead' | 'wide' | 'half' | 'third' };
export type MosaicRow = { kind: 'feature' | 'triple' | 'single' | 'pair'; tiles: MosaicTile[] };

const tile = (moment: RecapMoment, shape: MosaicTile['shape']): MosaicTile => ({ moment, shape });

export function mosaicRows(moments: RecapMoment[]): MosaicRow[] {
  // Precondition: moments must arrive already sorted by captured_at, a project
  // cornerstone. This function trusts that and never re-sorts, so the lead
  // tile is always moments[0] (the earliest of the day), never a chosen or
  // filtered one. Layout operations must preserve order unconditionally.
  if (moments.length === 0) return [];
  if (moments.length === 1) {
    return [{ kind: 'single', tiles: [tile(moments[0], 'wide')] }];
  }
  if (moments.length === 2) {
    return [{ kind: 'pair', tiles: moments.map((m) => tile(m, 'half')) }];
  }

  const rows: MosaicRow[] = [
    {
      kind: 'feature',
      tiles: [tile(moments[0], 'lead'), tile(moments[1], 'third'), tile(moments[2], 'third')],
    },
  ];
  // Slice without padding or dropping: a row with fewer than three tiles is kept
  // as-is (a shorter row), the layout handles it via flex-start alignment, not a
  // backfill or discard rule. A last row with one or two moments is a complete,
  // valid row and must display as part of the day's mosaic.
  for (let i = 3; i < moments.length; i += 3) {
    rows.push({ kind: 'triple', tiles: moments.slice(i, i + 3).map((m) => tile(m, 'third')) });
  }
  return rows;
}
