import type { TripStatus } from './types';

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MS_PER_DAY = 86_400_000;

// Dates are pure calendar days without a timezone. That is why everything is
// calculated in UTC: Date.UTC avoids a daylight-saving change swallowing or
// double-counting a day.
function toUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function validateDateRange(startIso: string | null, endIso: string | null): string | null {
  if (!startIso || !endIso) return 'Trag Beginn und Ende ein, z.B. 01.08.2026.';
  if (toUtc(endIso) < toUtc(startIso)) return 'Das Ende darf nicht vor dem Beginn liegen.';
  return null;
}

// Today's calendar day at the device's location, as 'YYYY-MM-DD'.
//
// `new Date().toISOString().slice(0, 10)` returns the calendar day in UTC,
// which in Central Europe was a day too early every night between 00:00 and
// 02:00: the trip day counted too low and "finish trip" moved up a day too
// late. The other functions in this file deliberately calculate in UTC
// because they compare pure calendar days WITHOUT a timezone, whereas this
// value answers the question "what day does the user currently have", and
// only the local clock answers that.
export function todaysCalendarDay(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function tripDay(startIso: string, todayIso: string): number {
  const diff = Math.round((toUtc(todayIso) - toUtc(startIso)) / MS_PER_DAY);
  return diff < 0 ? 0 : diff + 1;
}

export function tripLength(startIso: string, endIso: string): number {
  return Math.round((toUtc(endIso) - toUtc(startIso)) / MS_PER_DAY) + 1;
}

export function formatRange(startIso: string, endIso: string): string {
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const [ey, em, ed] = endIso.split('-').map(Number);
  if (sy !== ey) return `${sd}. ${MONTHS[sm - 1]} ${sy} – ${ed}. ${MONTHS[em - 1]} ${ey}`;
  if (sm !== em) return `${sd}. ${MONTHS[sm - 1]} – ${ed}. ${MONTHS[em - 1]} ${ey}`;
  return `${sd}.–${ed}. ${MONTHS[sm - 1]} ${sy}`;
}

export function groupTrips<T extends { status: TripStatus }>(trips: T[]): { ongoing: T[]; recaps: T[] } {
  return {
    ongoing: trips.filter((t) => t.status === 'active'),
    recaps: trips.filter((t) => t.status !== 'active'),
  };
}
