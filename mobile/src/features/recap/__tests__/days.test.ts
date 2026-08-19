import { sortMoments, groupByDays, placeOfTheDay } from '../days';
import type { RecapMoment } from '../types';

// Minimal moment with sensible defaults, each test overrides only what
// actually matters to it (same pattern as `job` in momentsApi.test.ts).
function moment(overrides: Partial<RecapMoment>): RecapMoment {
  return {
    id: 'm0',
    trip_id: 't1',
    author_id: 'u1',
    type: 'photo',
    duration_s: null,
    caption: null,
    captured_at: '2026-08-01T10:00:00.000Z',
    captured_tz: 'Europe/Zurich',
    place_name: null,
    lat: null,
    lng: null,
    upload_status: 'uploaded',
    autor_name: 'Lea',
    autor_avatar_key: null,
    ...overrides,
  };
}

describe('sortMoments', () => {
  test('sorts by captured_at ascending', () => {
    const a = moment({ id: 'a', captured_at: '2026-08-01T12:00:00.000Z' });
    const b = moment({ id: 'b', captured_at: '2026-08-01T09:00:00.000Z' });
    const c = moment({ id: 'c', captured_at: '2026-08-01T15:00:00.000Z' });
    expect(sortMoments([a, b, c]).map((m) => m.id)).toEqual(['b', 'a', 'c']);
  });

  test('id decides at an identical captured_at', () => {
    const same = '2026-08-01T12:00:00.000Z';
    const z = moment({ id: 'z', captured_at: same });
    const a = moment({ id: 'a', captured_at: same });
    const m = moment({ id: 'm', captured_at: same });
    expect(sortMoments([z, a, m]).map((x) => x.id)).toEqual(['a', 'm', 'z']);
  });

  test('the result is identical on repeated sorting (stable, not just accidentally correct)', () => {
    const same = '2026-08-01T12:00:00.000Z';
    const moments = [
      moment({ id: 'c', captured_at: same }),
      moment({ id: 'a', captured_at: same }),
      moment({ id: 'b', captured_at: '2026-08-01T09:00:00.000Z' }),
    ];
    const once = sortMoments(moments);
    const twice = sortMoments(once);
    expect(twice.map((m) => m.id)).toEqual(once.map((m) => m.id));
    expect(twice.map((m) => m.id)).toEqual(['b', 'a', 'c']);
  });

  test('leaves the input unchanged (returns a new list)', () => {
    const b = moment({ id: 'b', captured_at: '2026-08-01T09:00:00.000Z' });
    const a = moment({ id: 'a', captured_at: '2026-08-01T12:00:00.000Z' });
    const input = [a, b];
    sortMoments(input);
    expect(input.map((m) => m.id)).toEqual(['a', 'b']);
  });

  test('an empty input returns an empty list, no error', () => {
    expect(sortMoments([])).toEqual([]);
  });

  // A plain text comparison of the ISO strings would be wrong here: "22" <
  // "23" reads as lexicographically smaller, even though a (21:00 UTC) is
  // actually BEFORE b (22:00 UTC); captured_at can arrive from the database
  // with a different offset format (comment in the code), and that's
  // exactly what this test checks for.
  test('compares captured_at as a real point in time, not as text (different offset formats)', () => {
    const a = moment({ id: 'a', captured_at: '2026-08-01T23:00:00+02:00' }); // = 21:00 UTC
    const b = moment({ id: 'b', captured_at: '2026-08-01T22:00:00Z' }); // = 22:00 UTC
    expect(sortMoments([b, a]).map((m) => m.id)).toEqual(['a', 'b']);
  });
});

describe('groupByDays', () => {
  const startDate = '2026-08-01';

  test('an empty input returns an empty list, no error', () => {
    expect(groupByDays([], startDate)).toEqual([]);
  });

  test('counts from start_date as day 1', () => {
    const day1 = moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const day2 = moment({ id: 'b', captured_at: '2026-08-02T09:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const days = groupByDays([day1, day2], startDate);
    expect(days.map((t) => ({ nummer: t.nummer, datum: t.datum }))).toEqual([
      { nummer: 1, datum: '2026-08-01' },
      { nummer: 2, datum: '2026-08-02' },
    ]);
  });

  // Its own day arithmetic (not the same implementation as tripDay.ts), a
  // month change is therefore checked separately here, analogous to
  // tripDay.test.ts.
  test('counts days correctly across a month change', () => {
    const beforeMonthChange = moment({ id: 'a', captured_at: '2026-07-30T09:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const afterMonthChange = moment({ id: 'b', captured_at: '2026-08-02T09:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const days = groupByDays([beforeMonthChange, afterMonthChange], '2026-07-30');
    expect(days.map((t) => ({ nummer: t.nummer, datum: t.datum }))).toEqual([
      { nummer: 1, datum: '2026-07-30' },
      { nummer: 4, datum: '2026-08-02' },
    ]);
  });

  test('a moment before the start date gets day 1 instead of being dropped', () => {
    const beforeDeparture = moment({
      id: 'a',
      captured_at: '2026-07-30T18:00:00.000Z',
      captured_tz: 'Europe/Zurich',
    });
    const days = groupByDays([beforeDeparture], startDate);
    expect(days).toHaveLength(1);
    expect(days[0].nummer).toBe(1);
    expect(days[0].datum).toBe('2026-08-01');
    expect(days[0].momente.map((m) => m.id)).toEqual(['a']);
  });

  // The day boundary follows captured_tz of the moment, not the UTC date of
  // captured_at. Los Angeles (UTC-7 in summer) trails UTC time here far
  // enough that the moment is still locally the previous day, even though
  // captured_at already shows the next UTC calendar day.
  test('the day boundary follows captured_tz, not the UTC date of captured_at', () => {
    const lateEveningLocal = moment({
      id: 'a',
      captured_at: '2026-08-02T01:00:00.000Z', // UTC: already August 2nd
      captured_tz: 'America/Los_Angeles', // local: August 1st, 18:00
    });
    const days = groupByDays([lateEveningLocal], startDate);
    expect(days).toHaveLength(1);
    expect(days[0].nummer).toBe(1);
  });

  // Reverse case: locally already the next day, even though captured_at's
  // UTC date still points at the previous day (Tokyo, UTC+9).
  test('a moment shortly before midnight UTC already belongs to the next local day', () => {
    const shortlyBeforeMidnightUtc = moment({
      id: 'a',
      captured_at: '2026-08-01T23:30:00.000Z', // UTC: still August 1st
      captured_tz: 'Asia/Tokyo', // local: August 2nd, 08:30
    });
    const days = groupByDays([shortlyBeforeMidnightUtc], startDate);
    expect(days).toHaveLength(1);
    expect(days[0].nummer).toBe(2);
  });

  // The group crosses a timezone boundary (e.g. Eurotunnel Paris→London),
  // both moments sit on the same local day in their own respective zone.
  // They must NOT fall apart just because captured_tz differs, only the day
  // number derived from it matters.
  test('two moments on the same local day in different timezones stay in one day', () => {
    const paris = moment({
      id: 'a',
      captured_at: '2026-08-01T09:00:00.000Z', // 11:00 CEST (Europe/Paris)
      captured_tz: 'Europe/Paris',
    });
    const london = moment({
      id: 'b',
      captured_at: '2026-08-01T21:30:00.000Z', // 22:30 BST (Europe/London), still the same local day
      captured_tz: 'Europe/London',
    });
    const days = groupByDays([london, paris], startDate);
    expect(days).toHaveLength(1);
    expect(days[0].nummer).toBe(1);
    // stays sorted by captured_at: Paris (09:00 UTC) before London (21:30 UTC).
    expect(days[0].momente.map((m) => m.id)).toEqual(['a', 'b']);
  });

  // A real, locally felt day change (overnight flight) remains a day
  // change though, that's not a bug, it's the real local time at the
  // destination.
  test('a real local-day change (overnight flight) produces two days', () => {
    const departureOslo = moment({
      id: 'a',
      captured_at: '2026-08-01T21:00:00.000Z', // 23:00 CEST (Europe/Oslo)
      captured_tz: 'Europe/Oslo',
    });
    const arrivalTokyo = moment({
      id: 'b',
      captured_at: '2026-08-02T08:00:00.000Z', // 17:00 JST (Asia/Tokyo), next local day
      captured_tz: 'Asia/Tokyo',
    });
    const days = groupByDays([departureOslo, arrivalTokyo], startDate);
    expect(days.map((t) => t.nummer)).toEqual([1, 2]);
  });

  // A genuine gap westward is harmless: no moment falls in it, so no day
  // card is created for it and the day numbers simply jump (Los Angeles
  // evening on day 1 → Tokyo two days later lands on day 3, day 2 never
  // appears because it genuinely has no moments; purely cosmetic, a day
  // without moments never shows up in the list anyway).
  test('a real gap westward just skips ahead, day numbers are not filled in', () => {
    const losAngelesEvening = moment({
      id: 'a',
      captured_at: '2026-08-01T20:00:00.000Z', // local: August 1st, 13:00 (America/Los_Angeles)
      captured_tz: 'America/Los_Angeles',
    });
    const tokyoTwoDaysLater = moment({
      id: 'b',
      captured_at: '2026-08-02T20:00:00.000Z', // local: August 3rd, 05:00 (Asia/Tokyo)
      captured_tz: 'Asia/Tokyo',
    });
    const days = groupByDays([losAngelesEvening, tokyoTwoDaysLater], startDate);
    expect(days.map((t) => t.nummer)).toEqual([1, 3]);
  });

  test('the date of a day is independent of which captured_tz its moments carry', () => {
    const paris = moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z', captured_tz: 'Europe/Paris' });
    const london = moment({ id: 'b', captured_at: '2026-08-01T21:30:00.000Z', captured_tz: 'Europe/London' });
    const days = groupByDays([london, paris], startDate);
    expect(days[0].datum).toBe('2026-08-01');
  });

  test('sets the place via placeOfTheDay per day', () => {
    const a = moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z', place_name: 'Oslo' });
    const b = moment({ id: 'b', captured_at: '2026-08-01T10:00:00.000Z', place_name: 'Oslo' });
    const c = moment({ id: 'c', captured_at: '2026-08-01T11:00:00.000Z', place_name: 'Bergen' });
    const days = groupByDays([a, b, c], startDate);
    expect(days[0].ort).toBe('Oslo');
  });

  test('days come out sorted ascending, regardless of input order', () => {
    const day3 = moment({ id: 'c', captured_at: '2026-08-03T09:00:00.000Z' });
    const day1 = moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z' });
    const day2 = moment({ id: 'b', captured_at: '2026-08-02T09:00:00.000Z' });
    const days = groupByDays([day3, day1, day2], startDate);
    expect(days.map((t) => t.nummer)).toEqual([1, 2, 3]);
  });

  // Review finding, Important 1: an eastward time jump (Tokyo → Los Angeles)
  // lets a later moment's OWN local calendar day fall behind an earlier
  // one's. Without a correction, the chronologically later arrival would
  // appear under a SMALLER day number than the earlier departure;
  // chronology is this project's cornerstone.
  test('the day order stays chronological even when the local calendar day runs backwards', () => {
    const departureTokyo = moment({
      id: 'a',
      captured_at: '2026-08-01T23:30:00.000Z', // local: Aug 2nd, 08:30 (Asia/Tokyo)
      captured_tz: 'Asia/Tokyo',
    });
    const arrivalLosAngeles = moment({
      id: 'b',
      captured_at: '2026-08-02T01:00:00.000Z', // chronologically LATER, but local: Aug 1st, 18:00 (America/Los_Angeles)
      captured_tz: 'America/Los_Angeles',
    });
    const days = groupByDays([departureTokyo, arrivalLosAngeles], startDate);
    // Both moments land in the same, higher day, the arrival does NOT slip
    // back before the departure.
    expect(days).toHaveLength(1);
    expect(days[0].nummer).toBe(2);
    expect(days[0].momente.map((m) => m.id)).toEqual(['a', 'b']);
  });

  // Re-review finding: with only TWO moments, the mutation
  // "runningNumber = number" → "runningNumber = raw" doesn't show up (that
  // was exactly the case above). A THIRD, chronologically even later moment
  // with the same (lower) own local day as the second one exposes it: with
  // the mutation, the running number would wrongly fall back to the second
  // moment's RAW value (1) instead of staying at the number already reached
  // (2), the third moment would then reopen a (smaller, "closed") day, and
  // the day list would again come out descending (exactly Important 1
  // again).
  test('the monotonic assignment stays stable across more than two moments (no falling back into a closed day)', () => {
    const departureTokyo = moment({
      id: 'a',
      captured_at: '2026-08-01T23:30:00.000Z', // local: Aug 2nd (Asia/Tokyo)
      captured_tz: 'Asia/Tokyo',
    });
    const arrivalLosAngeles = moment({
      id: 'b',
      captured_at: '2026-08-02T01:00:00.000Z', // local: Aug 1st, evening (America/Los_Angeles)
      captured_tz: 'America/Los_Angeles',
    });
    const laterLosAngeles = moment({
      id: 'c',
      captured_at: '2026-08-02T03:00:00.000Z', // chronologically EVEN LATER, local still Aug 1st
      captured_tz: 'America/Los_Angeles',
    });
    const days = groupByDays([departureTokyo, arrivalLosAngeles, laterLosAngeles], startDate);
    expect(days).toHaveLength(1);
    expect(days[0].nummer).toBe(2);
    expect(days[0].momente.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  // The side effect of the monotonic assignment isn't just a skipped
  // number, it can also make RecapDay.datum diverge from a single moment's
  // OWN local date, once that moment's calendar day is swallowed by a
  // preceding, still-"running" day. Accepted deliberately (see file header),
  // recorded here as a contract so Task 10/11 don't rely on the opposite.
  test('a swallowed local day can make RecapDay.datum diverge from a moment\'s own local date', () => {
    const departureTokyo = moment({
      id: 'a',
      captured_at: '2026-08-01T23:30:00.000Z', // local: Aug 2nd (Asia/Tokyo)
      captured_tz: 'Asia/Tokyo',
    });
    const arrivalLosAngeles = moment({
      id: 'b',
      captured_at: '2026-08-02T01:00:00.000Z', // own local date: Aug 1st (America/Los_Angeles)
      captured_tz: 'America/Los_Angeles',
    });
    const days = groupByDays([departureTokyo, arrivalLosAngeles], startDate);
    expect(days).toHaveLength(1);
    // b's own local date would be 2026-08-01, but the group carries a's
    // (higher, running) day's date.
    expect(days[0].datum).toBe('2026-08-02');
    expect(days[0].momente.map((m) => m.id)).toEqual(['a', 'b']);
  });

  // Review finding: a single moment whose raw day value turns into NaN must
  // NOT poison the running number for ALL subsequent moments via
  // Math.max(NaN, runningNumber), otherwise it costs not just itself but
  // drags valid moments down with it.
  test('a single broken moment does not poison the day numbers of subsequent, valid moments', () => {
    const validBefore = moment({ id: 'a', captured_at: '2026-08-01T08:00:00.000Z' });
    const broken = moment({ id: 'b', captured_at: 'kein-datum' });
    const validAfter = moment({ id: 'c', captured_at: '2026-08-02T08:00:00.000Z' });
    const days = groupByDays([validBefore, broken, validAfter], startDate);
    expect(days.map((t) => ({ nummer: t.nummer, momente: t.momente.map((m) => m.id) }))).toEqual([
      { nummer: 1, momente: ['a'] },
      { nummer: 2, momente: ['c'] },
    ]);
  });

  // Review finding: formatToParts() returns 'year'/'month'/'day' not as
  // separate parts on some Intl partial implementations (historically
  // Hermes/iOS, see the comment in mobile/src/app/vorschau.tsx, which
  // avoids Intl for exactly this reason), but as a single 'literal' part.
  // Reproduced via a spy on Intl.DateTimeFormat.prototype.formatToParts.
  test('an Intl partial implementation without year/month/day parts does not throw, costs only the affected moment', () => {
    const spy = jest
      .spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
      .mockReturnValueOnce([{ type: 'literal', value: 'unbrauchbar' }] as unknown as Intl.DateTimeFormatPart[]);
    // broken first (chronologically earlier), so the ONE intercepted
    // formatToParts call reliably hits it, not the valid moment.
    const broken = moment({ id: 'b', captured_at: '2026-08-01T08:00:00.000Z' });
    const valid = moment({ id: 'a', captured_at: '2026-08-01T10:00:00.000Z' });
    const days = groupByDays([broken, valid], startDate);
    spy.mockRestore();
    expect(days).toHaveLength(1);
    expect(days[0].momente.map((m) => m.id)).toEqual(['a']);
  });

  // Second, independent NaN source: a broken/empty startDate itself (not a
  // moment's captured_at/captured_tz), the same Number.isFinite guard
  // catches that too, instead of producing NaN day numbers for EVERY
  // moment.
  test('a broken startDate does not throw and returns an empty list instead of NaN day numbers', () => {
    const a = moment({ id: 'a' });
    expect(() => groupByDays([a], 'kaputtes-startdatum')).not.toThrow();
    expect(groupByDays([a], 'kaputtes-startdatum')).toEqual([]);
  });

  // Review finding, Important 2: captured_tz has no CHECK constraint and can
  // be set freely by the client, an invalid identifier (foreign/older
  // client, differing tzdata between two devices of the same recap) makes
  // Intl.DateTimeFormat throw already at construction. That must cost at
  // most the affected moment, never the whole recap.
  test('an invalid captured_tz does not throw, costs only the affected moment', () => {
    const valid = moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const broken = moment({ id: 'b', captured_at: '2026-08-01T10:00:00.000Z', captured_tz: 'Nicht/Existent' });
    expect(() => groupByDays([valid, broken], startDate)).not.toThrow();
    const days = groupByDays([valid, broken], startDate);
    expect(days).toHaveLength(1);
    expect(days[0].momente.map((m) => m.id)).toEqual(['a']);
  });

  // Same underlying cause as above, different trigger: an unparsable
  // captured_at makes Intl.DateTimeFormat throw while FORMATTING (Invalid
  // Date), not while constructing.
  test('an unparsable captured_at does not throw, costs only the affected moment', () => {
    const valid = moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z' });
    const broken = moment({ id: 'b', captured_at: 'kein-datum' });
    expect(() => groupByDays([valid, broken], startDate)).not.toThrow();
    const days = groupByDays([valid, broken], startDate);
    expect(days).toHaveLength(1);
    expect(days[0].momente.map((m) => m.id)).toEqual(['a']);
  });
});

describe('placeOfTheDay', () => {
  test('returns the most frequent place_name', () => {
    const moments = [
      moment({ id: 'a', place_name: 'Oslo' }),
      moment({ id: 'b', place_name: 'Bergen' }),
      moment({ id: 'c', place_name: 'Oslo' }),
    ];
    expect(placeOfTheDay(moments)).toBe('Oslo');
  });

  test('a tie is decided by the place of the earliest moment', () => {
    const moments = [
      moment({ id: 'a', captured_at: '2026-08-01T11:00:00.000Z', place_name: 'Bergen' }),
      moment({ id: 'b', captured_at: '2026-08-01T09:00:00.000Z', place_name: 'Oslo' }),
    ];
    expect(placeOfTheDay(moments)).toBe('Oslo');
  });

  test('a null place_name does not count, not even in a tie', () => {
    const moments = [
      moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z', place_name: null }),
      moment({ id: 'b', captured_at: '2026-08-01T10:00:00.000Z', place_name: 'Oslo' }),
    ];
    expect(placeOfTheDay(moments)).toBe('Oslo');
  });

  test('null when every moment is without a place_name', () => {
    const moments = [moment({ id: 'a', place_name: null }), moment({ id: 'b', place_name: null })];
    expect(placeOfTheDay(moments)).toBeNull();
  });

  // An empty string counts as "no place" just like null (`!!place` filters
  // both out equally), own test so this doesn't drift unnoticed.
  test('an empty place_name does not count, like null', () => {
    const moments = [
      moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z', place_name: '' }),
      moment({ id: 'b', captured_at: '2026-08-01T10:00:00.000Z', place_name: 'Oslo' }),
    ];
    expect(placeOfTheDay(moments)).toBe('Oslo');
  });

  test('an empty input returns null, no error', () => {
    expect(placeOfTheDay([])).toBeNull();
  });
});
