import type { RecapMoment } from './types';

export type MosaicTile = { moment: RecapMoment; shape: 'lead' | 'wide' | 'half' | 'third' };
export type MosaicRow = { kind: 'feature' | 'triple' | 'single' | 'pair'; tiles: MosaicTile[] };

const tile = (moment: RecapMoment, shape: MosaicTile['shape']): MosaicTile => ({ moment, shape });

export function mosaicRows(moments: RecapMoment[]): MosaicRow[] {
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
  for (let i = 3; i < moments.length; i += 3) {
    rows.push({ kind: 'triple', tiles: moments.slice(i, i + 3).map((m) => tile(m, 'third')) });
  }
  return rows;
}
