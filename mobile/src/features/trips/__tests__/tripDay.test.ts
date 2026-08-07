import {
  parseGermanDate, formatGermanDate, validateDateRange,
  tripDay, tripLength, formatRange, groupTrips,
} from '../tripDay';

test.each([
  ['06.08.2026', '2026-08-06'],
  ['1.1.2026', '2026-01-01'],
  ['31.12.2025', '2025-12-31'],
  ['32.01.2026', null],
  ['06.13.2026', null],
  ['29.02.2025', null], // 2025 ist kein Schaltjahr
  ['6.8.26', null],
  ['', null],
])('parseGermanDate(%s) → %s', (input, expected) => {
  expect(parseGermanDate(input)).toBe(expected);
});

test('formatGermanDate kehrt parseGermanDate um', () => {
  expect(formatGermanDate('2026-08-06')).toBe('06.08.2026');
});

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
  ['2026-08-01', '2026-07-30', 0], // Reise hat noch nicht begonnen
])('tripDay(%s, %s) → %s', (start, today, expected) => {
  expect(tripDay(start, today)).toBe(expected);
});

test('tripDay zählt über einen Monatswechsel korrekt', () => {
  expect(tripDay('2026-07-30', '2026-08-02')).toBe(4);
});

test('tripLength zählt beide Randtage mit', () => {
  expect(tripLength('2026-08-01', '2026-08-14')).toBe(14);
});

test.each([
  ['2026-08-01', '2026-08-14', '1.–14. Aug 2026'],
  ['2026-07-30', '2026-08-02', '30. Jul – 2. Aug 2026'],
  ['2025-12-28', '2026-01-03', '28. Dez 2025 – 3. Jan 2026'],
])('formatRange(%s, %s) → %s', (start, end, expected) => {
  expect(formatRange(start, end)).toBe(expected);
});

test('groupTrips trennt laufende Reisen von Recaps', () => {
  const trips = [
    { id: 'a', status: 'active' as const },
    { id: 'b', status: 'revealed' as const },
    { id: 'c', status: 'archived' as const },
  ];
  const { laufend, recaps } = groupTrips(trips);
  expect(laufend.map((t) => t.id)).toEqual(['a']);
  expect(recaps.map((t) => t.id)).toEqual(['b', 'c']);
});
