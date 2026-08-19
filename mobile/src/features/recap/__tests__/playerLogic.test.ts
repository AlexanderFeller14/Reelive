import {
  durationFor,
  advance,
  goBack,
  dayChanges,
  withReason,
  withoutReason,
  withoutReasons,
  blocksAutoAdvance,
  PHOTO_DURATION_MS,
  VIDEO_DURATION_FALLBACK_MS,
  VIDEO_DURATION_MIN_MS,
  type PauseReason,
  type PlayerState,
} from '../playerLogic';
import * as days from '../days';
import type { RecapMoment } from '../types';

// Minimal moment with sensible defaults, each test overrides only what
// actually matters to it (same pattern as in days.test.ts).
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
    authorName: 'Lea',
    authorAvatarKey: null,
    ...overrides,
  };
}

describe('durationFor', () => {
  // Literal assertion instead of just "against itself" (review finding): a
  // test that only compares durationFor(...) against PHOTO_DURATION_MS
  // stays green even if the constant itself mutates (implementation checked
  // against implementation). Spec §8.2: photos run for 5 seconds, that's
  // the number that counts, independent of the constant's name.
  test('PHOTO_DURATION_MS is 5000 (Spec §8.2: photos run for 5 seconds)', () => {
    expect(PHOTO_DURATION_MS).toBe(5000);
  });

  test('a photo always lasts PHOTO_DURATION_MS (5000 ms)', () => {
    expect(durationFor(moment({ type: 'photo', duration_s: null }))).toBe(5000);
    // A duration_s on a photo (should never happen per the schema) must
    // still not change the duration, photos NEVER depend on duration_s.
    expect(durationFor(moment({ type: 'photo', duration_s: 42 }))).toBe(5000);
  });

  test('a video lasts duration_s * 1000', () => {
    expect(durationFor(moment({ type: 'video', duration_s: 12 }))).toBe(12_000);
  });

  // Phase-5 final review, point 8 (review finding): was missing until now,
  // the two floor tests below used to compare `durationFor(...)` against
  // `VIDEO_DURATION_MIN_MS` ITSELF, not against a literal. A mutant that
  // changes the constant from 1000 to e.g. 8000 would stay green on BOTH
  // (the implementation would then actually return 8000, and the test
  // still only compares against the same, now-mutated, constant). Two
  // lines further up, the suite already gets this right for
  // PHOTO_DURATION_MS (`expect(PHOTO_DURATION_MS).toBe(5000)`), the same
  // literal-pinning was missing here for the video floor.
  test('VIDEO_DURATION_MIN_MS is 1000 (comment at the export: "long enough to be genuinely visible")', () => {
    expect(VIDEO_DURATION_MIN_MS).toBe(1000);
  });

  // A floor prevents a very short/broken duration_s value (0 is technically
  // valid per the check constraint) from making the moment effectively
  // invisible, the progress bar would otherwise fill almost instantly. 0 is
  // at the same time a valid but FALSY value, an implementation checking
  // `duration_s ? … : fallback` instead of `=== null` would wrongly return
  // the (much longer) fallback instead of the floor here; this test
  // explicitly requires the floor, not 0 and not VIDEO_DURATION_FALLBACK_MS.
  // Literal `1000` instead of `VIDEO_DURATION_MIN_MS` (review finding, see
  // above): otherwise the test would stay green even if the constant (and
  // with it the actual display duration) changed.
  test('duration_s = 0 returns the floor of 1000 ms, not 0 and not the fallback', () => {
    expect(durationFor(moment({ type: 'video', duration_s: 0 }))).toBe(1000);
  });

  test('a very short, but real duration_s value is also raised to the floor of 1000 ms', () => {
    // 0.5s * 1000 = 500 ms, below the floor.
    expect(durationFor(moment({ type: 'video', duration_s: 0.5 }))).toBe(1000);
  });

  test('a video with a sufficient duration, above the floor, is left untouched (the floor only raises, never caps)', () => {
    expect(durationFor(moment({ type: 'video', duration_s: 12 }))).toBe(12_000);
    expect(12_000).toBeGreaterThan(VIDEO_DURATION_MIN_MS);
  });

  test('a video without duration_s (nullable column, defensive case) gets the named fallback value, not NaN', () => {
    const duration = durationFor(moment({ type: 'video', duration_s: null }));
    expect(Number.isNaN(duration)).toBe(false);
    expect(duration).toBe(VIDEO_DURATION_FALLBACK_MS);
  });

  // VIDEO_DURATION_FALLBACK_MS must cover at least the maximum video length
  // allowed by the check constraint (30s) (review finding), otherwise the
  // fallback cuts off a legal, but duration-less video mid-picture.
  test('VIDEO_DURATION_FALLBACK_MS is at least 30 seconds (the maximum video length allowed by the check constraint)', () => {
    expect(VIDEO_DURATION_FALLBACK_MS).toBeGreaterThanOrEqual(30_000);
  });
});

describe('advance', () => {
  // Phase-5 final review, point 1: `pausiert` is now a
  // `ReadonlySet<PauseReason>` instead of a boolean (see playerLogic.ts),
  // same fixtures as before, just with the new representation.
  const state = (overrides: Partial<PlayerState> = {}): PlayerState => ({
    index: 0,
    pausiert: new Set(),
    fortschritt: 0,
    ...overrides,
  });
  const HELD = new Set<PauseReason>(['halten']);

  test('increments the index by one and resets progress', () => {
    const result = advance(state({ index: 1, fortschritt: 3400 }), 5);
    expect(result).toEqual({ index: 2, pausiert: new Set(), fortschritt: 0 });
  });

  // "pausiert stays untouched" concretely means here: the same Set
  // REFERENCE passes through unchanged, advance() neither reads nor writes
  // it.
  test('leaves "pausiert" unchanged (the same reference), advance/goBack don\'t decide about pausing', () => {
    const result = advance(state({ index: 0, pausiert: HELD }), 5);
    expect(result).not.toBe('ende');
    if (result === 'ende') throw new Error('unreachable');
    expect(result.pausiert).toBe(HELD);
    expect(result).toEqual({ index: 1, pausiert: HELD, fortschritt: 0 });
  });

  // Brief: at the last moment, advance returns 'ende', NOT index `count`, an
  // off-by-one here would instead return { index: count, ... }.
  test('at the last moment, advance returns "ende", not index count', () => {
    const result = advance(state({ index: 4 }), 5);
    expect(result).toBe('ende');
  });

  test('an empty list: advance returns "ende" immediately', () => {
    expect(advance(state({ index: 0 }), 0)).toBe('ende');
  });

  test('exactly one moment (count 1): advance returns "ende" immediately', () => {
    expect(advance(state({ index: 0 }), 1)).toBe('ende');
  });
});

describe('goBack', () => {
  const state = (overrides: Partial<PlayerState> = {}): PlayerState => ({
    index: 0,
    pausiert: new Set(),
    fortschritt: 0,
    ...overrides,
  });
  const HELD = new Set<PauseReason>(['halten']);

  test('decrements the index by one and resets progress', () => {
    const result = goBack(state({ index: 2, fortschritt: 1200 }));
    expect(result).toEqual({ index: 1, pausiert: new Set(), fortschritt: 0 });
  });

  // Brief: goBack at the first moment stays at index 0 and resets progress,
  // it does NOT jump out of the day/roll of film (no negative index).
  test('at the first moment, the index stays at 0 instead of going negative', () => {
    const result = goBack(state({ index: 0, fortschritt: 800 }));
    expect(result).toEqual({ index: 0, pausiert: new Set(), fortschritt: 0 });
  });

  // Brief: goBack ALWAYS resets fortschritt to 0, even mid-video,
  // regardless of whether the index changes at all.
  test('always resets progress to 0, even when the index stays the same (index 0)', () => {
    const result = goBack(state({ index: 0, fortschritt: 3999 }));
    expect(result.fortschritt).toBe(0);
  });

  test('leaves "pausiert" unchanged (the same reference)', () => {
    const result = goBack(state({ index: 3, pausiert: HELD }));
    expect(result.pausiert).toBe(HELD);
    expect(result).toEqual({ index: 2, pausiert: HELD, fortschritt: 0 });
  });
});

describe('dayChanges', () => {
  const startDate = '2026-08-01';

  test('true at the very first moment overall (index 0)', () => {
    const moments = [moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z' })];
    expect(dayChanges(moments, startDate, 0)).toBe(true);
  });

  test('false as long as two consecutive moments sit on the same day', () => {
    const moments = [
      moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z' }),
      moment({ id: 'b', captured_at: '2026-08-01T15:00:00.000Z' }),
    ];
    expect(dayChanges(moments, startDate, 1)).toBe(false);
  });

  test('true exactly at the first moment of a new day', () => {
    const moments = [
      moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z' }),
      moment({ id: 'b', captured_at: '2026-08-01T15:00:00.000Z' }),
      moment({ id: 'c', captured_at: '2026-08-02T09:00:00.000Z' }),
    ];
    expect(dayChanges(moments, startDate, 0)).toBe(true); // very first moment
    expect(dayChanges(moments, startDate, 1)).toBe(false); // still day 1
    expect(dayChanges(moments, startDate, 2)).toBe(true); // day 2 begins
  });

  test('indices outside the list return false instead of throwing', () => {
    const moments = [moment({ id: 'a' })];
    expect(dayChanges(moments, startDate, -1)).toBe(false);
    expect(dayChanges(moments, startDate, 1)).toBe(false);
    expect(dayChanges([], startDate, 0)).toBe(false);
  });

  // Integration test for the brief's actual requirement: the day number
  // depends on the moments BEFORE it and can't be determined in isolation
  // per moment. Review finding from days.ts: on an eastward time jump
  // (Tokyo → Los Angeles), the later arrival's OWN local calendar day runs
  // behind the earlier departure's (Los Angeles: August 1st, Tokyo: August
  // 2nd), groupByDays still keeps the order chronological and assigns both
  // to the same (higher) day. An implementation that instead naively
  // compared the two moments' LOCAL calendar days would wrongly return true
  // here (August 1st ≠ August 2nd), this test explicitly requires false.
  test('follows the monotonically assigned day number from groupByDays, not the raw local calendar day', () => {
    const departureTokyo = moment({
      id: 'a',
      captured_at: '2026-08-01T23:30:00.000Z', // local: Aug 2nd, 08:30 (Asia/Tokyo)
      captured_tz: 'Asia/Tokyo',
    });
    const arrivalLosAngeles = moment({
      id: 'b',
      captured_at: '2026-08-02T01:00:00.000Z', // chronologically later, but local Aug 1st (America/Los_Angeles)
      captured_tz: 'America/Los_Angeles',
    });
    const moments = [departureTokyo, arrivalLosAngeles];
    expect(dayChanges(moments, startDate, 1)).toBe(false);
  });

  // A real local-day change (overnight flight) remains a day change though,
  // the counter-check to the test above, so "always false for differing
  // captured_tz" doesn't accidentally slip through as a rule.
  test('a real local-day change (overnight flight) remains a day change', () => {
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
    expect(dayChanges([departureOslo, arrivalTokyo], startDate, 1)).toBe(true);
  });

  // Review finding, Important 3/4: the original test here only checked
  // not.toThrow(), so the actual design decision (id-based mapping instead
  // of position in groupByDays' possibly shortened result) wasn't covered
  // by any return value at all. A mutant that instead indexes positionally
  // into a flattened output (`groupByDays(...).flatMap(t =>
  // t.momente.map(() => t.nummer))`, then `flat[index] !==
  // flat[index - 1]`) stayed green and unnoticed under plain not.toThrow().
  //
  // Case A: the dropped moment sits INSIDE a day (a, broken, b are all
  // really day 1). Review finding, Important 4: a missing map entry on
  // EITHER side counts as "no change" (false), not as a change, otherwise
  // the player announces the same day twice (at broken's position AND at
  // b's position right after it).
  test('a dropped moment INSIDE a day produces no false day interstitial (neither at its position nor after it)', () => {
    const a = moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const broken = moment({ id: 'broken', captured_at: '2026-08-01T10:00:00.000Z', captured_tz: 'Nicht/Existent' });
    const b = moment({ id: 'b', captured_at: '2026-08-01T11:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const moments = [a, broken, b];
    expect(() => dayChanges(moments, startDate, 1)).not.toThrow();
    expect(dayChanges(moments, startDate, 1)).toBe(false); // at broken's position
    expect(dayChanges(moments, startDate, 2)).toBe(false); // at b's position, right after
  });

  // Case B: the dropped moment sits EXACTLY AT a real day boundary (a is
  // day 1, b is day 2). The deliberate compromise from Important 4: here
  // too, dayChanges returns false at both neighbouring positions, the real
  // change isn't shown, because its only immediate witness would have been
  // the dropped moment. This is also the test that most sharply
  // distinguishes a positional reimplementation from the id-based one:
  // groupByDays returns only two days with one moment each for
  // [a, broken, b] (broken is missing), a flattened output would be `[1, 2]`
  // (length 2), `flat[2]` would be `undefined` there (an index from the
  // 3-element `moments` mirrored directly into the 2-element output) and
  // `undefined !== 2` would wrongly come out `true`.
  test('a dropped moment EXACTLY AT a day boundary shows a change at neither neighbouring position (documented compromise)', () => {
    const a = moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const broken = moment({ id: 'broken', captured_at: '2026-08-01T10:00:00.000Z', captured_tz: 'Nicht/Existent' });
    const b = moment({ id: 'b', captured_at: '2026-08-02T09:00:00.000Z', captured_tz: 'Europe/Zurich' });
    const moments = [a, broken, b];
    expect(dayChanges(moments, startDate, 1)).toBe(false);
    expect(dayChanges(moments, startDate, 2)).toBe(false);
  });

  // Review finding, Important 5: dayChanges memoises the day numbers by the
  // ARRAY REFERENCE of `moments` (WeakMap), so a player with hundreds of
  // moments doesn't rebuild groupByDays (and with it a fresh
  // Intl.DateTimeFormat per moment) on every single moment change. A cache
  // keyed by e.g. length or startDate alone (instead of the reference)
  // would confuse two different, equally long lists, this test calls both
  // interleaved and requires each to keep its own, correct result.
  test('two different moments arrays of equal length are cached independently, no mix-up', () => {
    const listA = [
      moment({ id: 'a1', captured_at: '2026-08-01T09:00:00.000Z' }),
      moment({ id: 'a2', captured_at: '2026-08-01T15:00:00.000Z' }), // same day as a1
    ];
    const listB = [
      moment({ id: 'b1', captured_at: '2026-08-01T09:00:00.000Z' }),
      moment({ id: 'b2', captured_at: '2026-08-02T09:00:00.000Z' }), // different day than b1
    ];
    expect(dayChanges(listA, startDate, 1)).toBe(false);
    expect(dayChanges(listB, startDate, 1)).toBe(true);
    // Again, interleaved in reverse order: a cache that confuses lists
    // would flip one of the two results at the latest here.
    expect(dayChanges(listB, startDate, 1)).toBe(true);
    expect(dayChanges(listA, startDate, 1)).toBe(false);
  });

  // Phase-5 final review, point 8 (review finding, "when it's cheap"): up to
  // here, not a single line checks the WeakMap cache's actual PURPOSE (see
  // the comment at `dayNumberCache` in playerLogic.ts), the tests above only
  // check CORRECT results, which an implementation WITHOUT any cache would
  // also produce (removing the WeakMap without replacement would leave all
  // tests so far green). This test spies on `groupByDays` directly: several
  // `dayChanges` calls for the SAME array reference may only call it ONCE.
  test('groupByDays is called only ONCE for the same moments reference (WeakMap cache)', () => {
    const spy = jest.spyOn(days, 'groupByDays');
    const moments = [
      moment({ id: 'a', captured_at: '2026-08-01T09:00:00.000Z' }),
      moment({ id: 'b', captured_at: '2026-08-01T15:00:00.000Z' }),
      moment({ id: 'c', captured_at: '2026-08-02T09:00:00.000Z' }),
    ];
    dayChanges(moments, startDate, 0);
    dayChanges(moments, startDate, 1);
    dayChanges(moments, startDate, 2);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('PauseReason: withReason/withoutReason/blocksAutoAdvance', () => {
  const empty = (): ReadonlySet<PauseReason> => new Set();

  test('withReason adds a new reason', () => {
    const result = withReason(empty(), 'halten');
    expect(result.has('halten')).toBe(true);
    expect(result.size).toBe(1);
  });

  // Review-finding principle (a test with teeth instead of a plain result
  // check): for an already-present reason, withReason returns the SAME
  // reference (no new set), a mutant that always returns
  // `new Set(paused).add(reason)` instead would not be caught by a plain
  // `.has()` check.
  test('withReason returns the SAME Set reference for an already-present reason (no unnecessary re-render)', () => {
    const state = withReason(empty(), 'halten');
    const again = withReason(state, 'halten');
    expect(again).toBe(state);
  });

  test('withoutReason takes back exactly its own reason, other reasons stay untouched', () => {
    let state = withReason(empty(), 'halten');
    state = withReason(state, 'kommentare');
    const result = withoutReason(state, 'halten');
    expect(result.has('halten')).toBe(false);
    expect(result.has('kommentare')).toBe(true);
  });

  // This is the module's actual point (final review point 1): a call with a
  // NOT-present reason, e.g. an orphaned timer whose own reason has long
  // been taken back elsewhere, is a safe no-op, even if a FOREIGN reason
  // has MEANWHILE been set. A naive `pausiert = false` replacement (the old
  // representation) would drag that foreign reason down with it, this test
  // explicitly requires it to remain.
  test('withoutReason for a not-present reason is a no-op, a FOREIGN, meanwhile-set reason stays untouched', () => {
    const state = withReason(empty(), 'kommentare');
    const result = withoutReason(state, 'zwischenkarte');
    expect(result.has('kommentare')).toBe(true);
    expect(result).toBe(state); // no-op: same reference, no new set.
  });

  // Final-review Phase-5 follow-up: withoutReasons takes back several
  // reasons at once, exactly what a genuine index change (tap navigation,
  // automatic advance) needs, so neither 'halten' nor 'neuversuch' carries
  // over from the LEFT moment to the NEW one (see player.tsx,
  // MOMENTWECHSEL_GRUENDE).
  test('withoutReasons takes back several reasons at once, other reasons stay untouched', () => {
    let state = withReason(empty(), 'halten');
    state = withReason(state, 'neuversuch');
    state = withReason(state, 'kommentare');
    const result = withoutReasons(state, ['halten', 'neuversuch']);
    expect(result.has('halten')).toBe(false);
    expect(result.has('neuversuch')).toBe(false);
    expect(result.has('kommentare')).toBe(true);
  });

  // The same no-op point as withoutReason, now for several reasons at once:
  // if ALL given reasons are already absent, withoutReasons returns the
  // same reference, no unnecessary re-render when e.g. weiterAutomatisch
  // gets called even though 'halten'/'neuversuch' are already empty anyway
  // (the normal case via the auto-advance timer).
  test('withoutReasons is a no-op (same reference) when NONE of the given reasons is present', () => {
    const state = withReason(empty(), 'kommentare');
    const result = withoutReasons(state, ['halten', 'neuversuch']);
    expect(result.has('kommentare')).toBe(true);
    expect(result).toBe(state);
  });

  // A regression test that reproduces the final-review finding exactly:
  // 'neuversuch' alone (without 'halten') must also be taken back, a
  // mutant that applies withoutReasons only to the FIRST reason of the list
  // would fail here.
  test('withoutReasons also takes back a reason that is only PARTIALLY present (only "neuversuch", no "halten")', () => {
    const state = withReason(empty(), 'neuversuch');
    const result = withoutReasons(state, ['halten', 'neuversuch']);
    expect(result.size).toBe(0);
  });

  test('blocksAutoAdvance is false when no reason is set', () => {
    expect(blocksAutoAdvance(empty())).toBe(false);
  });

  // Contract 4, core case (repro from the final review, point 1): a
  // playToEnd during a hold gesture MUST be let through.
  test('blocksAutoAdvance is false when ONLY "halten" is set', () => {
    expect(blocksAutoAdvance(withReason(empty(), 'halten'))).toBe(false);
  });

  test('blocksAutoAdvance is true while the interstitial card is showing', () => {
    expect(blocksAutoAdvance(withReason(empty(), 'zwischenkarte'))).toBe(true);
  });

  test('blocksAutoAdvance is true while the comment sheet is open', () => {
    expect(blocksAutoAdvance(withReason(empty(), 'kommentare'))).toBe(true);
  });

  test('blocksAutoAdvance is true while a silent retry is running', () => {
    expect(blocksAutoAdvance(withReason(empty(), 'neuversuch'))).toBe(true);
  });

  // Task 8, Phase 6: 'melden' blocks exactly like 'kommentare', an open
  // "report this moment" sheet must not let the player advance.
  test('blocksAutoAdvance is true while the report sheet is open', () => {
    expect(blocksAutoAdvance(withReason(empty(), 'melden'))).toBe(true);
  });

  // "halten" together with a blocking reason stays blocking, the exception
  // only applies when "halten" is the ONLY reason.
  test('blocksAutoAdvance stays true when "halten" AND another reason are set', () => {
    const state = withReason(withReason(empty(), 'halten'), 'kommentare');
    expect(blocksAutoAdvance(state)).toBe(true);
  });
});
