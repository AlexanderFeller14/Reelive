import { useCallback, useState } from 'react';

// State that belongs to ONE trip and ends with it.
//
// The bug this is meant to rule out entirely showed up four times in the
// same screen during Phase 7: a screen under `[id]` stays MOUNTED across a
// change of the trip id, expo-router only swaps the parameter. Whatever the
// screen holds in `useState` survives that change and then belongs to the
// wrong trip. That looks harmless and is not: a sheet left standing showed a
// moment from the previous trip, and its button sent the player into the new
// one with THAT trip's index, where the same number points at a completely
// different moment. No error, no blank screen, just the wrong moment, and
// nobody notices unless they count.
//
// Reset WHILE RENDERING, not in an effect. That is the documented React
// pattern for "discard state on a prop change": React discards this pass's
// output and re-renders immediately, so a foreign state is never visible at
// all. An effect would come too late, the previous trip's open sheet would
// be visible for one frame (including its entry animation), and a
// `setState` inside an effect body is also a lint violation
// (react-hooks/set-state-in-effect).
//
// State is DISCARDED, not kept per trip. At t1 → t2 → t1 it is back to the
// initial value, and that is the intent: there is no "the sheet I had open
// in t1 earlier", there is only "I currently haven't tapped anything here".
// A store per id would be a different thing and the wrong one for this kind
// of state, it would bring back exactly the sheets nobody opened.
//
// Not for LOADED data. The opposite holds there: at t1 → t2 → t1, t1's
// loaded state is the right one again, and discarding it would show a
// skeleton over data that has been correct all along, for the duration of a
// fresh load. States like that carry their own stamp along and get compared
// while deriving (see `visibleState` in recap/[id]/map.tsx).
export function useTripBound<T>(tripId: string, initial: T): [T, (value: T) => void] {
  const [state, setState] = useState<{ tripId: string; value: T }>({ tripId, value: initial });

  // Conditional, and the condition is made false by the setting itself: no
  // loop. Without the condition it would be one.
  if (state.tripId !== tripId) setState({ tripId, value: initial });

  const setValue = useCallback((value: T) => setState({ tripId, value }), [tripId]);

  // The initial value already in THIS pass, not only in the next one. The
  // output gets discarded either way, but a caller that processes `value`
  // while rendering (filters a list from it, looks up an index) would
  // otherwise run once with the wrong trip's data, and an exception in there
  // would become visible even though the output does not.
  return [state.tripId === tripId ? state.value : initial, setValue];
}
