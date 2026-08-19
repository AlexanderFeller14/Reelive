// Pure core logic of the recap: sorting, grouping by local day, determining
// a day's place. No network, no React, fully testable without a running
// stack (Task-5 brief).

import type { RecapMoment, RecapDay } from './types';

const MS_PER_DAY = 86_400_000;

function timeValue(capturedAt: string): number {
  const value = Date.parse(capturedAt);
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

export function sortMoments(moments: RecapMoment[]): RecapMoment[] {
  return [...moments].sort((a, b) => {
    const av = timeValue(a.captured_at);
    const bv = timeValue(b.captured_at);
    if (av !== bv) return av < bv ? -1 : 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

function toUtcDay(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d);
}

function parseIsoDate(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
}

// Read via formatToParts() rather than format() + parsing a locale string on
// purpose (review finding, Important 3): the previous version relied on the
// locale 'en-CA' returning exactly "YYYY-MM-DD" under every Intl
// implementation. That holds under Node/Jest (full ICU data), but was never
// verified for the app itself: Hermes builds its Intl.DateTimeFormat on iOS
// from Foundation, not necessarily from the same ICU data as Node.
// formatToParts() with a targeted read of the 'year'/'month'/'day' field
// types is independent of the chosen locale (here 'en-US' is just a
// neutral, arbitrary choice with Western digits) and closes that silent
// path.
function localDate(capturedAt: string, capturedTz: string): [number, number, number] {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: capturedTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(capturedAt));
  const field = (type: string) => Number(parts.find((t) => t.type === type)?.value);
  return [field('year'), field('month'), field('day')];
}

// captured_tz has no CHECK constraint (just `text not null`) and the INSERT
// column grant lets the client set the value freely; a foreign or older
// client, or simply differing tzdata between two devices of the same
// recap, is not an edge case here but an everyday one.
function calculateRawDayNumber(moment: RecapMoment, startDate: string): number | null {
  try {
    const [ly, lm, ld] = localDate(moment.captured_at, moment.captured_tz);
    const [sy, sm, sd] = parseIsoDate(startDate);
    const diffDays = Math.round((toUtcDay(ly, lm, ld) - toUtcDay(sy, sm, sd)) / MS_PER_DAY);
    // formatToParts() returns 'year'/'month'/'day' not as separate parts but
    // as a single 'literal' part on some Intl partial implementations
    // (historically Hermes/iOS, see the comment in mobile/src/app/preview.tsx,
    // which avoids Intl for exactly this reason).
    if (!Number.isFinite(diffDays)) {
      throw new RangeError('Tagesnummer liess sich nicht berechnen (kein auswertbares Kalenderdatum).');
    }
    return diffDays + 1;
  } catch (error) {
    console.error('[days] Moment ohne verwertbaren Zeitpunkt/Zeitzone übersprungen', moment.id, error);
    return null;
  }
}

function dateForDay(startDate: string, number: number): string {
  const [sy, sm, sd] = parseIsoDate(startDate);
  const date = new Date(toUtcDay(sy, sm, sd) + (number - 1) * MS_PER_DAY);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function groupByDays(moments: RecapMoment[], startDate: string): RecapDay[] {
  const sorted = sortMoments(moments);
  const groups = new Map<number, RecapMoment[]>();
  let runningNumber = 1;
  for (const moment of sorted) {
    const raw = calculateRawDayNumber(moment, startDate);
    if (raw === null) continue;
    const number = Math.max(raw, runningNumber);
    runningNumber = number;
    const existing = groups.get(number);
    if (existing) {
      existing.push(moment);
    } else {
      groups.set(number, [moment]);
    }
  }
  return [...groups.entries()].map(([dayNumber, momentsOfDay]) => ({
    number: dayNumber,
    date: dateForDay(startDate, dayNumber),
    place: placeOfTheDay(momentsOfDay),
    moments: momentsOfDay,
  }));
}

export function placeOfTheDay(moments: RecapMoment[]): string | null {
  const places = moments.map((m) => m.place_name).filter((place): place is string => !!place);
  if (places.length === 0) return null;

  const frequency = new Map<string, number>();
  for (const place of places) {
    frequency.set(place, (frequency.get(place) ?? 0) + 1);
  }
  const maxFrequency = Math.max(...frequency.values());
  const candidates = new Set(
    [...frequency.entries()].filter(([, count]) => count === maxFrequency).map(([place]) => place)
  );

  for (const moment of sortMoments(moments)) {
    if (moment.place_name && candidates.has(moment.place_name)) {
      return moment.place_name;
    }
  }
  // Unreachable: places.length > 0 guarantees at least one match above.
  return null;
}
