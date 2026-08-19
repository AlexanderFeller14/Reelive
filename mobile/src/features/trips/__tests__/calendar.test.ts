import {
  MONTHS_FORWARD, MONTHS_BACK, todayOrDefault, monthHeight, monthIndexFor,
  monthGrid, monthOffset, monthsInRange, nextSelection, dayLabel,
  rangeLabel, cellRole, ROW_HEIGHT, MONTH_HEADER_HEIGHT, MONTH_GAP,
  type Selection,
} from '../calendar';

const EMPTY = { start: null, end: null };

test('monthGrid fills August 2026 with Monday as the start of the week', () => {
  const m = monthGrid(2026, 8);
  expect(m.title).toBe('August 2026');
  // 1.8.2026 is a Saturday, so five empty cells before it.
  expect(m.weeks[0]).toEqual([null, null, null, null, null, '2026-08-01', '2026-08-02']);
  expect(m.weeks[1][0]).toBe('2026-08-03');
});

test('monthGrid pads the last week up to Sunday', () => {
  const m = monthGrid(2026, 8);
  const last = m.weeks[m.weeks.length - 1];
  expect(last).toHaveLength(7);
  expect(last.filter((t) => t === null).length).toBeGreaterThan(0);
});

test('monthGrid knows the leap-year February', () => {
  const days = monthGrid(2028, 2).weeks.flat().filter(Boolean);
  expect(days).toHaveLength(29);
  expect(days[28]).toBe('2028-02-29');
});

test('monthGrid knows the ordinary February', () => {
  expect(monthGrid(2027, 2).weeks.flat().filter(Boolean)).toHaveLength(28);
});

test('monthsInRange reaches one year back and two years forward', () => {
  const months = monthsInRange('2026-08-12');
  expect(months).toHaveLength(MONTHS_BACK + MONTHS_FORWARD + 1);
  expect(months[0].title).toBe('August 2025');
  expect(months[MONTHS_BACK].title).toBe('August 2026');
  expect(months[months.length - 1].title).toBe('August 2028');
});

test('monthsInRange crosses the year boundary cleanly', () => {
  const months = monthsInRange('2026-01-15');
  expect(months[0].title).toBe('Januar 2025');
  expect(months[MONTHS_BACK].title).toBe('Januar 2026');
});

test('nextSelection: the first tap sets the start', () => {
  expect(nextSelection(EMPTY, '2026-08-05')).toEqual({ start: '2026-08-05', end: null });
});

test('nextSelection: a later day becomes the end', () => {
  const before = { start: '2026-08-05', end: null };
  expect(nextSelection(before, '2026-08-14')).toEqual({ start: '2026-08-05', end: '2026-08-14' });
});

test('nextSelection: an earlier day resets the start', () => {
  const before = { start: '2026-08-05', end: null };
  expect(nextSelection(before, '2026-08-01')).toEqual({ start: '2026-08-01', end: null });
});

test('nextSelection: the same day yields a day trip', () => {
  const before = { start: '2026-08-05', end: null };
  expect(nextSelection(before, '2026-08-05')).toEqual({ start: '2026-08-05', end: '2026-08-05' });
});

test('nextSelection: a finished range starts over', () => {
  const before = { start: '2026-08-05', end: '2026-08-14' };
  expect(nextSelection(before, '2026-09-02')).toEqual({ start: '2026-09-02', end: null });
});

describe('cellRole', () => {
  const selection = { start: '2026-08-05', end: '2026-08-14' };
  const firstDay = '2025-08-01';
  const lastDay = '2028-08-31';
  // The type is spelled out on purpose: without it, the default value `a`
  // narrows to a selection with a set end, and the `end: null` cases would
  // no longer type-check.
  const role = (day: string, s: Selection = selection) => cellRole(day, s, firstDay, lastDay);

  test('recognizes start and end', () => {
    expect(role('2026-08-05')).toBe('beginn');
    expect(role('2026-08-14')).toBe('ende');
  });

  test('recognizes the days in between', () => {
    expect(role('2026-08-09')).toBe('dazwischen');
  });

  test('leaves days outside the range free', () => {
    expect(role('2026-08-04')).toBe('frei');
    expect(role('2026-08-15')).toBe('frei');
  });

  test('locks days outside the bounds', () => {
    expect(role('2025-07-31')).toBe('gesperrt');
    expect(role('2028-09-01')).toBe('gesperrt');
  });

  test('names the day trip single, not start', () => {
    const dayTrip = { start: '2026-08-05', end: '2026-08-05' };
    expect(role('2026-08-05', dayTrip)).toBe('einzeln');
  });

  test('marks only the start for a half-set selection', () => {
    const half = { start: '2026-08-05', end: null };
    expect(role('2026-08-05', half)).toBe('beginn');
    expect(role('2026-08-09', half)).toBe('frei');
  });
});

test('monthHeight adds up header, week rows and gap', () => {
  const m = monthGrid(2026, 8);
  expect(monthHeight(m)).toBe(MONTH_HEADER_HEIGHT + m.weeks.length * ROW_HEIGHT + MONTH_GAP);
});

test('monthOffset sums the heights of the months before it', () => {
  const months = monthsInRange('2026-08-12');
  expect(monthOffset(months, 0)).toBe(0);
  expect(monthOffset(months, 2)).toBe(monthHeight(months[0]) + monthHeight(months[1]));
});

test('monthIndexFor finds the month of a day', () => {
  const months = monthsInRange('2026-08-12');
  expect(monthIndexFor(months, '2026-08-05')).toBe(MONTHS_BACK);
  expect(monthIndexFor(months, '2026-09-02')).toBe(MONTHS_BACK + 1);
});

test('monthIndexFor falls back to the first month without a day', () => {
  const months = monthsInRange('2026-08-12');
  expect(monthIndexFor(months, null)).toBe(0);
});

test('dayLabel writes out the month', () => {
  expect(dayLabel('2026-08-14')).toBe('14. August 2026');
  expect(dayLabel('2026-01-01')).toBe('1. Januar 2026');
});

test('rangeLabel writes out both months and uses «bis» as a word', () => {
  expect(rangeLabel({ start: '2026-08-01', end: '2026-08-14' }))
    .toBe('Zeitraum, 1. August 2026 bis 14. August 2026');
});

test('rangeLabel says nothing is chosen yet for an empty selection', () => {
  expect(rangeLabel({ start: null, end: null })).toBe('Zeitraum, noch nichts gewählt');
  expect(rangeLabel({ start: '2026-08-01', end: null })).toBe('Zeitraum, noch nichts gewählt');
});

test('todayOrDefault passes a set value through', () => {
  expect(todayOrDefault('2026-08-12')).toBe('2026-08-12');
});
