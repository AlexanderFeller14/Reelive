// Pure logic to determine how the recap player opens: no network, no React.
// Distinguishes between a full recap show (with seal sequence) and a direct
// jump to a specific moment. Called by the player screen itself, once, to
// derive its own mode from the route's `start` param.

export type PlayerMode = 'show' | 'jump';

export function playerMode(startParam: string | undefined): PlayerMode {
  // Empty string or missing parameter means the player was entered from the
  // recap tab (no start index in route), so it opens as a show with the seal.
  if (startParam === undefined || startParam === '') return 'show';

  const n = Number(startParam);
  // The validity rule must match parseStartIndex in player.tsx, so one function
  // falling back on a value never causes the other to treat it as a jump.
  // start=0 is a valid jump (overview repeat-moment), not a missing parameter,
  // so we must not rely on truthiness to detect "no parameter": a truthiness
  // check would read the zero as "missing" and put a seal in front of someone
  // repeating the recap from the overview.
  //
  // Length bounds (array.length check) are not applied here because they are
  // unavailable at this call site. Consequence: an out-of-range start such as
  // '999' on a 5-moment recap classifies as 'jump' here, while parseStartIndex
  // clamps it to index 0. That combination is intended (no seal, first moment),
  // but only obvious once written down.
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return 'show';
  return 'jump';
}
