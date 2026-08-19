import { todaysCalendarDay } from './tripDay';

// Month names written out in full. `tripDay.ts` carries its own short list
// for `formatRange` alongside this one; the two stay separate because they
// serve different purposes: the short form sits on the field, the long form
// gets read out loud.
const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

export const MONTHS_BACK = 12;
export const MONTHS_FORWARD = 24;

// Grid dimensions. They live here, not in the component, because
// `getItemLayout` needs to know the month height BEFORE anything renders.
export const ROW_HEIGHT = 48;
export const MONTH_HEADER_HEIGHT = 44;
export const MONTH_GAP = 24;

export type Selection = { start: string | null; end: string | null };

export type CellRole = 'frei' | 'beginn' | 'ende' | 'dazwischen' | 'einzeln' | 'gesperrt';

export type Month = {
  year: number;
  month: number; // 1 to 12
  title: string;
  // Seven entries per week, `null` for the empty cells before the first and
  // after the last day.
  weeks: (string | null)[][];
};

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Day 0 of the following month is the last day of this one, that spares a
// separate leap-year rule.
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// getUTCDay() counts from Sunday, the grid starts on Monday.
function offsetOfFirstDay(year: number, month: number): number {
  return (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
}

export function monthGrid(year: number, month: number): Month {
  const cells: (string | null)[] = Array(offsetOfFirstDay(year, month)).fill(null);
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    cells.push(toIso(year, month, day));
  }
  // Pad to full weeks so every row has seven cells and the columns line up
  // across all months.
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { year, month, title: `${MONTHS[month - 1]} ${year}`, weeks };
}

export function monthsInRange(today: string): Month[] {
  const [year, month] = today.split('-').map(Number);
  // Calculated in running months rather than with Date: that way there is no
  // special case at the year boundary.
  const firstRun = year * 12 + (month - 1) - MONTHS_BACK;
  const count = MONTHS_BACK + MONTHS_FORWARD + 1;
  return Array.from({ length: count }, (_, i) => {
    const run = firstRun + i;
    return monthGrid(Math.floor(run / 12), (run % 12) + 1);
  });
}

// The four rules from the spec: rule 1 (no start yet) and rule 4 (a finished
// range) coincide, both start over with the tapped day.
export function nextSelection(current: Selection, tapped: string): Selection {
  if (!current.start || current.end) return { start: tapped, end: null };
  if (tapped < current.start) return { start: tapped, end: null };
  return { start: current.start, end: tapped };
}

export function cellRole(
  day: string,
  selection: Selection,
  firstDay: string,
  lastDay: string
): CellRole {
  if (day < firstDay || day > lastDay) return 'gesperrt';
  const { start, end } = selection;
  // The day trip first: it is both start AND end, but doesn't get a
  // half-filled bar, otherwise the bar would jut out into nothing.
  if (start && start === end && day === start) return 'einzeln';
  if (day === start) return 'beginn';
  if (day === end) return 'ende';
  if (start && end && day > start && day < end) return 'dazwischen';
  return 'frei';
}

export function monthHeight(month: Month): number {
  return MONTH_HEADER_HEIGHT + month.weeks.length * ROW_HEIGHT + MONTH_GAP;
}

export function monthOffset(months: Month[], index: number): number {
  let total = 0;
  for (let i = 0; i < index; i++) total += monthHeight(months[i]);
  return total;
}

export function monthIndexFor(months: Month[], day: string | null): number {
  if (!day) return 0;
  const [year, month] = day.split('-').map(Number);
  const index = months.findIndex((m) => m.year === year && m.month === month);
  return index < 0 ? 0 : index;
}

export function dayLabel(day: string): string {
  const [year, month, dayNumber] = day.split('-').map(Number);
  return `${dayNumber}. ${MONTHS[month - 1]} ${year}`;
}

// Read-aloud caption of the field. Both months written out in full and «bis»
// as a word: the short form «Aug» doesn't reliably come out as «August» when
// read aloud, and DESIGN-LANGUAGE §6 allows the en dash for a range but
// doesn't require it.
export function rangeLabel(selection: Selection): string {
  if (!selection.start || !selection.end) return 'Zeitraum, noch nichts gewählt';
  return `Zeitraum, ${dayLabel(selection.start)} bis ${dayLabel(selection.end)}`;
}

// Lets tests pin the calendar to a fixed day. Without this hook every test
// would hang off the real system date and break in the following month
// (same pattern as todaysCalendarDay(now = new Date())).
export function todayOrDefault(today?: string): string {
  return today ?? todaysCalendarDay();
}
