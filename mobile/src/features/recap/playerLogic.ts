// Pure state machine of the story player: pure, network-free, no React
// (Task-7 brief). The screen from Task 11 only ever calls these functions,
// every decision (which moment comes next, when a day starts, how long a
// moment stays on screen) lives here and is therefore testable without a
// running stack.
import type { RecapMoment } from './types';
import { groupByDays } from './days';

// Phase-5 final review, point 1: `paused` used to be a single `boolean`,
// every one of the (by now four) places that LIFT a pause had to rely on
// "something paused, so I may unpause", without knowing WHETHER it had set
// the pause itself. The interstitial-card timer (player.tsx) silently
// unpaused an open comment sheet over exactly this, even though it was
// never the reason for that pause, the same class of bug that had already
// shown up three times before in this phase (see the report). A
// `Set<PauseReason>` makes the question "may I unpause?" meaningless: each
// place only takes back the reason it set itself (withReason/withoutReason
// below), taking back a reason some other place has already removed itself
// is a safe no-op, not an error. The player runs once the set is empty.
// Task 8, Phase 6: 'melden' was added, the same principle as 'kommentare',
// its own, independently retractable reason for the "report this moment"
// sheet, not a second, separately tracked boolean next to it (see
// player.tsx, oeffneMelden/schliesseMelden).
export type PauseReason = 'halten' | 'kommentare' | 'zwischenkarte' | 'neuversuch' | 'melden';

export type PlayerState = { index: number; paused: ReadonlySet<PauseReason>; progress: number };

// No unnecessary re-render/effect rerun (same bail-out principle as a
// `setState` given the same value again): a consumer that carries `paused`
// in an effect dependency array needs a new reference to notice the change
// at all.
export function withReason(paused: ReadonlySet<PauseReason>, reason: PauseReason): ReadonlySet<PauseReason> {
  if (paused.has(reason)) return paused;
  return new Set(paused).add(reason);
}

export function withoutReason(paused: ReadonlySet<PauseReason>, reason: PauseReason): ReadonlySet<PauseReason> {
  if (!paused.has(reason)) return paused;
  const next = new Set(paused);
  next.delete(reason);
  return next;
}

// Final-review Phase-5 follow-up: `beiLadefehler` (player.tsx) sets
// `'neuversuch'` on the FAILING moment and only takes it back if, by the
// time the response arrives, the SAME moment is still active (stale guard,
// same principle as `videoZuEnde`). If the person keeps tapping in the
// meantime and leaves that branch, `'neuversuch'` stayed UNREMOVABLE until
// this fix (no other caller ever took back exactly that reason, unlike
// `'halten'`, which `beendeBeruehrung`/`weiterAutomatisch` already took
// back). Used wherever the index ACTUALLY changes (tap navigation,
// automatic advance): both `'halten'` and `'neuversuch'` belong to the
// LEFT moment, neither may block the NEW one.
export function withoutReasons(
  paused: ReadonlySet<PauseReason>,
  reasons: readonly PauseReason[]
): ReadonlySet<PauseReason> {
  let result = paused;
  for (const reason of reasons) result = withoutReason(result, reason);
  return result;
}

// Contract 4 (playerLogic contract, see player.tsx): a hold gesture MUST
// still let a video-end event that arrives during it through, it only
// freezes the DISPLAY, not the native player-end event. Every other reason
// (interstitial card showing, comment sheet open, a silent retry after a
// load error running) keeps blocking though. A guard that only checks "is
// any reason set" couldn't tell these two cases apart, which is exactly why
// PauseReason exists as a named set instead of a single flag.
export function blocksAutoAdvance(paused: ReadonlySet<PauseReason>): boolean {
  for (const reason of paused) {
    if (reason !== 'halten') return true;
  }
  return false;
}

// Display duration of a photo before the player automatically advances.
export const PHOTO_DURATION_MS = 5000;

// The check constraint posts_duration_s_check (migration
// 20260803090600_role_hardening.sql) has, since it was tightened, required
// `duration_s is not null and duration_s between 0 and 30` for every video
// row, so a video without a duration can no longer be created for new rows
// in this database at all. The fallback here is still not dead code
// though, it's pure defence against data this guarantee can't rely on: an
// older row from before the migration, a foreign client, direct DB access
// outside the app. RecapMoment.duration_s stays `number | null` (the
// column itself remains nullable, only additionally constrained for
// `type = 'video'`), so durationFor still has to handle the case in a
// type-safe way.
//
// Review finding: 30s instead of the original 15s, because the constraint
// allows videos up to 30s, a fallback shorter than the allowed maximum
// would cut off a legal, but (in this defensive case) duration-less video
// mid-picture too early. 30s is the only value that never does that.
export const VIDEO_DURATION_FALLBACK_MS = 30_000;

// One second is short enough to not noticeably lengthen a real video, but
// long enough to be genuinely visible.
export const VIDEO_DURATION_MIN_MS = 1000;

export function durationFor(m: RecapMoment): number {
  if (m.type === 'photo') return PHOTO_DURATION_MS;
  if (m.duration_s === null) return VIDEO_DURATION_FALLBACK_MS;
  return Math.max(VIDEO_DURATION_MIN_MS, m.duration_s * 1000);
}

// Contract for Task 11 (review finding): "paused stays untouched" only
// holds for a GESTURE (the screen calls advance()/goBack() in reaction to a
// tap, while the state of `paused` lives on unchanged). For a
// PROGRAMMATIC transition, video ended, URL renewal after a 403 (V10), a
// skipped day interstitial, a lingering `paused: true` from a COMPLETELY
// DIFFERENT reason (e.g. because the previous moment was paused via hold)
// means a player that silently stops advancing. For those calls, Task 11
// itself must set `paused: false` in the returned state, advance() does
// not do that automatically.
export function advance(state: PlayerState, count: number): PlayerState | 'ende' {
  const nextIndex = state.index + 1;
  if (nextIndex >= count) return 'ende';
  return { ...state, index: nextIndex, progress: 0 };
}

export function goBack(state: PlayerState): PlayerState {
  return { ...state, index: Math.max(0, state.index - 1), progress: 0 };
}

// Day numbers for a `moments` list, cached by the array's REFERENCE (not
// its content). Review finding, Important 5: dayChanges gets called by the
// player once per moment change, without a cache every single call would
// rebuild a fresh Intl.DateTimeFormat via groupByDays for EVERY moment
// (days.ts, localDate), making the whole recap pass O(n²) on exactly the
// thread that animates the transition; on Hermes, constructing an Intl
// object is among the most expensive operations available.
//
// A WeakMap instead of a single "last call" slot: multiple recaps open at
// once (or switching between two `moments` lists) would constantly
// invalidate a single cache slot and defeat the benefit; the WeakMap holds
// its own entry per list actually used and frees it automatically once the
// list itself is no longer referenced anywhere (no manual cleanup needed).
// The cache hits assume `moments` is treated as immutable (the same call
// with the same objects returns the same reference), exactly the pattern
// this codebase follows anyway (sortMoments/groupByDays themselves never
// mutate in place, they return new arrays). If the roll of film changes
// (a straggler upload, a different trip), it's necessarily a NEW array
// reference, the cache then correctly misses and recomputes, never with
// stale day numbers.
const dayNumberCache = new WeakMap<RecapMoment[], Map<string, Map<string, number>>>();

function dayNumbersById(moments: RecapMoment[], startDate: string): Map<string, number> {
  let byStartDate = dayNumberCache.get(moments);
  if (!byStartDate) {
    byStartDate = new Map();
    dayNumberCache.set(moments, byStartDate);
  }
  let dayNumbers = byStartDate.get(startDate);
  if (!dayNumbers) {
    dayNumbers = new Map<string, number>();
    for (const day of groupByDays(moments, startDate)) {
      for (const moment of day.moments) dayNumbers.set(moment.id, day.number);
    }
    byStartDate.set(startDate, dayNumbers);
  }
  return dayNumbers;
}

export function dayChanges(moments: RecapMoment[], startDate: string, index: number): boolean {
  if (index < 0 || index >= moments.length) return false;
  if (index === 0) return true;

  const dayNumbers = dayNumbersById(moments, startDate);
  const current = dayNumbers.get(moments[index].id);
  const previous = dayNumbers.get(moments[index - 1].id);
  if (current === undefined || previous === undefined) return false;
  return current !== previous;
}
