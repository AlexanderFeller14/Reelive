import { setImport, takeImport, type ImportHandoff } from '../importHandoff';

const handoff = (): ImportHandoff => ({
  tripId: 't1',
  tripName: 'Norwegen mit dem Camper',
  authorId: 'u1',
  period: { start_date: '2026-08-01', end_date: '2026-08-14' },
  maxVideoSeconds: 90,
  accepted: [],
  refused: [],
  counterBefore: 4,
});

test('hands over exactly once', () => {
  const h = handoff();
  setImport(h);
  expect(takeImport()).toBe(h);
  expect(takeImport()).toBeNull();
});

test('a newer handoff replaces an older one that nobody took', () => {
  setImport(handoff());
  const newer = { ...handoff(), tripId: 't2' };
  setImport(newer);
  expect(takeImport()).toBe(newer);
});
