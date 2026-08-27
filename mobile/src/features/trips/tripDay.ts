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

// How many calendar days remain until the trip's end: 0 on the end day
// itself, negative once it lies in the past. The hero card turns this into
// its "Noch X Tage" badge.
export function daysUntilEnd(endIso: string, todayIso: string): number {
  return Math.round((toUtc(endIso) - toUtc(todayIso)) / MS_PER_DAY);
}

export function formatRange(startIso: string, endIso: string): string {
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const [ey, em, ed] = endIso.split('-').map(Number);
  if (sy !== ey) return `${sd}. ${MONTHS[sm - 1]} ${sy} – ${ed}. ${MONTHS[em - 1]} ${ey}`;
  if (sm !== em) return `${sd}. ${MONTHS[sm - 1]} – ${ed}. ${MONTHS[em - 1]} ${ey}`;
  return `${sd}.–${ed}. ${MONTHS[sm - 1]} ${sy}`;
}

// `running` vs `planned` is derived purely from `start_date`, the DB status
// stays a lifecycle state: a trip past its end but not yet revealed is still
// `active` and therefore running. Start = today counts as running (day 1).
// `running` keeps the delivered order (start_date descending, most recently
// started on top); `planned` re-sorts ascending so the next trip stands first.
export function groupTrips<T extends { status: TripStatus; start_date: string }>(
  trips: T[],
  todayIso: string
): { running: T[]; planned: T[]; recaps: T[] } {
  const active = trips.filter((t) => t.status === 'active');
  return {
    running: active.filter((t) => t.start_date <= todayIso),
    planned: active
      .filter((t) => t.start_date > todayIso)
      .sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0)),
    recaps: trips.filter((t) => t.status !== 'active'),
  };
}
