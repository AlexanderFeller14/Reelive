import { todaysCalendarDay, validateDateRange,
  tripDay, tripLength, formatRange, groupTrips,
} from '../tripDay';

test.each([
  ['2026-08-01', '2026-08-14', null],
  ['2026-08-01', '2026-08-01', null],
  ['2026-08-14', '2026-08-01', 'Das Ende darf nicht vor dem Beginn liegen.'],
  [null, '2026-08-14', 'Trag Beginn und Ende ein, z.B. 01.08.2026.'],
  ['2026-08-01', null, 'Trag Beginn und Ende ein, z.B. 01.08.2026.'],
])('validateDateRange(%s, %s) → %s', (start, end, expected) => {
  expect(validateDateRange(start, end)).toBe(expected);
});

test.each([
  ['2026-08-01', '2026-08-06', 6],
  ['2026-08-01', '2026-08-01', 1],
  ['2026-08-01', '2026-07-30', 0], // trip has not started yet
])('tripDay(%s, %s) → %s', (start, today, expected) => {
  expect(tripDay(start, today)).toBe(expected);
});

test('tripDay counts correctly across a month change', () => {
  expect(tripDay('2026-07-30', '2026-08-02')).toBe(4);
});

test('tripLength counts both boundary days', () => {
  expect(tripLength('2026-08-01', '2026-08-14')).toBe(14);
});

test.each([
  ['2026-08-01', '2026-08-14', '1.–14. Aug 2026'],
  ['2026-07-30', '2026-08-02', '30. Jul – 2. Aug 2026'],
  ['2025-12-28', '2026-01-03', '28. Dez 2025 – 3. Jan 2026'],
])('formatRange(%s, %s) → %s', (start, end, expected) => {
  expect(formatRange(start, end)).toBe(expected);
});

test('groupTrips splits running, planned and recaps', () => {
  const trips = [
    { id: 'future', status: 'active' as const, start_date: '2026-09-01' },
    { id: 'running', status: 'active' as const, start_date: '2026-08-01' },
    { id: 'revealed', status: 'revealed' as const, start_date: '2026-07-01' },
    { id: 'archived', status: 'archived' as const, start_date: '2026-06-01' },
  ];
  const { running, planned, recaps } = groupTrips(trips, '2026-08-10');
  expect(running.map((t) => t.id)).toEqual(['running']);
  expect(planned.map((t) => t.id)).toEqual(['future']);
  expect(recaps.map((t) => t.id)).toEqual(['revealed', 'archived']);
});

// Start = today is day 1, not a plan: whoever departs this morning is
// travelling. Only tomorrow's start still counts as planned.
test('groupTrips counts a trip starting today as running', () => {
  const trips = [
    { id: 'today', status: 'active' as const, start_date: '2026-08-10' },
    { id: 'tomorrow', status: 'active' as const, start_date: '2026-08-11' },
  ];
  const { running, planned } = groupTrips(trips, '2026-08-10');
  expect(running.map((t) => t.id)).toEqual(['today']);
  expect(planned.map((t) => t.id)).toEqual(['tomorrow']);
});

// The API delivers start_date descending (farthest future first). Within
// «Geplant» the NEXT trip belongs on top, so the group re-sorts ascending;
// `running` keeps the delivered order (most recently started on top).
test('groupTrips sorts planned trips soonest first', () => {
  const trips = [
    { id: 'far', status: 'active' as const, start_date: '2026-10-01' },
    { id: 'soon', status: 'active' as const, start_date: '2026-09-01' },
    { id: 'second', status: 'active' as const, start_date: '2026-08-05' },
    { id: 'first', status: 'active' as const, start_date: '2026-08-01' },
  ];
  const { running, planned } = groupTrips(trips, '2026-08-10');
  expect(planned.map((t) => t.id)).toEqual(['soon', 'far']);
  expect(running.map((t) => t.id)).toEqual(['second', 'first']);
});

// `new Date().toISOString().slice(0, 10)` returned the calendar day in UTC,
// which in Central Europe was a day too early every night between 00:00 and
// 02:00. The trip day then counted too low and "finish trip" moved up a day
// too late.
test('todaysCalendarDay takes the local clock, not UTC', () => {
  // 00:30 local time, whatever zone the suite runs in.
  const atNight = new Date(2026, 7, 9, 0, 30, 0);
  expect(todaysCalendarDay(atNight)).toBe('2026-08-09');
  // The actual difference only shows east of Greenwich (where
  // getTimezoneOffset is negative), exactly where the old UTC calculation was
  // off. If the suite runs in UTC or west of it, there is nothing to tell
  // apart at 00:30, and this line has nothing to say.
  if (atNight.getTimezoneOffset() < 0) {
    expect(atNight.toISOString().slice(0, 10)).toBe('2026-08-08');
  }
});

test('todaysCalendarDay pads month and day to two digits', () => {
  expect(todaysCalendarDay(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
});
