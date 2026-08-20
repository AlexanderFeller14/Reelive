import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';
import { cinema, palette } from '@/theme/tokens';
import { ShutterButton } from '../ShutterButton';

jest.useFakeTimers();

test('a tap fires a photo, not a video', async () => {
  const onPhoto = jest.fn();
  const onVideoStart = jest.fn();
  await render(<ShutterButton onPhoto={onPhoto} onVideoStart={onVideoStart} onVideoStop={jest.fn()} maxSeconds={30} />);
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(onPhoto).toHaveBeenCalledTimes(1);
  expect(onVideoStart).not.toHaveBeenCalled();
});

test('holding starts a video and stops it on release', async () => {
  const onPhoto = jest.fn();
  const onVideoStart = jest.fn();
  const onVideoStop = jest.fn();
  await render(
    <ShutterButton onPhoto={onPhoto} onVideoStart={onVideoStart} onVideoStop={onVideoStop} maxSeconds={30} />
  );
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(() => {
    jest.advanceTimersByTime(600);
  });
  expect(onVideoStart).toHaveBeenCalledTimes(1);
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(onVideoStop).toHaveBeenCalledTimes(1);
  expect(onPhoto).not.toHaveBeenCalled();
});

test('the video stops itself after the max duration', async () => {
  const onVideoStop = jest.fn();
  await render(
    <ShutterButton onPhoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSeconds={30} />
  );
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(() => {
    jest.advanceTimersByTime(31_000);
  });
  expect(onVideoStop).toHaveBeenCalledTimes(1);
});

// Not required by the brief, but explicitly demanded by the task:
// "both timers must be cleaned up both on release AND on unmount." Without
// this test, a dangling timer (still firing onVideoStart/onVideoStop after
// leaving the screen) would have gone unnoticed.
test('an unmount during the hold cleans up the threshold timer', async () => {
  const onPhoto = jest.fn();
  const onVideoStart = jest.fn();
  const onVideoStop = jest.fn();
  const { unmount } = await render(
    <ShutterButton onPhoto={onPhoto} onVideoStart={onVideoStart} onVideoStop={onVideoStop} maxSeconds={30} />
  );
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await unmount();
  await act(() => {
    jest.advanceTimersByTime(31_000);
  });
  expect(onVideoStart).not.toHaveBeenCalled();
  expect(onVideoStop).not.toHaveBeenCalled();
  expect(onPhoto).not.toHaveBeenCalled();
});

test('an unmount during recording also cleans up the max-duration timer', async () => {
  const onVideoStop = jest.fn();
  const { unmount } = await render(
    <ShutterButton onPhoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSeconds={30} />
  );
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(() => {
    jest.advanceTimersByTime(600);
  });
  await unmount();
  await act(() => {
    jest.advanceTimersByTime(31_000);
  });
  expect(onVideoStop).not.toHaveBeenCalled();
});

// From the fix-round-1 review: without this test, the "phase === 'idle'"
// guard in onPressOut (a late release AFTER the automatic stop triggers
// nothing more) could be mutated away without breaking a test, the finger
// often really does still rest on the shutter for a moment after the ring
// has already stopped itself at maxSeconds.
test("a release after the automatic stop fires neither a second onVideoStop nor onPhoto", async () => {
  const onPhoto = jest.fn();
  const onVideoStop = jest.fn();
  await render(
    <ShutterButton onPhoto={onPhoto} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSeconds={30} />
  );
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(() => {
    jest.advanceTimersByTime(31_000);
  });
  expect(onVideoStop).toHaveBeenCalledTimes(1);

  // The finger is really still on the button and is only lifted now.
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  expect(onVideoStop).toHaveBeenCalledTimes(1);
  expect(onPhoto).not.toHaveBeenCalled();
});

// === Lock (spec 2026-08-12-aufnahme-sperren-design.md) ===
//
// Thirty seconds of sustained pressure is uncomfortable, and every movement
// of the device goes through the exact finger that's supposed to hold the
// shot steady. So the thumb swipes right, locks in, and is free.
//
// The threshold sits at 48 px, measured from the point the press started:
// +60 is past it, +30 is short of it.
const HOLD = { nativeEvent: { pageX: 100 } };
const BEYOND = { nativeEvent: { pageX: 160 } };
const SHORT_OF = { nativeEvent: { pageX: 130 } };

const button = () => screen.getByLabelText('Auslöser');

// Brings the shutter into a running recording, the state before every swipe.
async function videoIsRunning() {
  await fireEvent(button(), 'pressIn', HOLD);
  await act(() => {
    jest.advanceTimersByTime(600);
  });
}

test("a swipe past the threshold locks: releasing doesn't end the recording", async () => {
  const onVideoStop = jest.fn();
  await render(
    <ShutterButton onPhoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSeconds={30} />
  );
  await videoIsRunning();

  await fireEvent(button(), 'touchMove', BEYOND);
  await fireEvent(button(), 'pressOut');

  expect(onVideoStop).not.toHaveBeenCalled();
});

// Counter-proof: without it, the test above would only show that some swipe
// suppresses the stop, even a tiny one. Then every slip would be an
// unintended lock.
test("a swipe short of the threshold doesn't lock, releasing ends the recording", async () => {
  const onVideoStop = jest.fn();
  await render(
    <ShutterButton onPhoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSeconds={30} />
  );
  await videoIsRunning();

  await fireEvent(button(), 'touchMove', SHORT_OF);
  await fireEvent(button(), 'pressOut');

  expect(onVideoStop).toHaveBeenCalledTimes(1);
});

test("a thumb that comes back doesn't lock", async () => {
  const onVideoStop = jest.fn();
  await render(
    <ShutterButton onPhoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSeconds={30} />
  );
  await videoIsRunning();

  await fireEvent(button(), 'touchMove', BEYOND);
  await fireEvent(button(), 'touchMove', SHORT_OF);
  await fireEvent(button(), 'pressOut');

  expect(onVideoStop).toHaveBeenCalledTimes(1);
});

test('while locked, a tap ends the recording', async () => {
  const onPhoto = jest.fn();
  const onVideoStop = jest.fn();
  await render(
    <ShutterButton onPhoto={onPhoto} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSeconds={30} />
  );
  await videoIsRunning();
  await fireEvent(button(), 'touchMove', BEYOND);
  await fireEvent(button(), 'pressOut');

  await fireEvent(screen.getByLabelText('Aufnahme beenden'), 'pressIn');

  expect(onVideoStop).toHaveBeenCalledTimes(1);
  // The tap ends it, it doesn't take a photo.
  expect(onPhoto).not.toHaveBeenCalled();
});

test('the max duration also ends a locked recording', async () => {
  const onVideoStop = jest.fn();
  await render(
    <ShutterButton onPhoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSeconds={30} />
  );
  await videoIsRunning();
  await fireEvent(button(), 'touchMove', BEYOND);
  await fireEvent(button(), 'pressOut');

  await act(() => {
    jest.advanceTimersByTime(31_000);
  });

  expect(onVideoStop).toHaveBeenCalledTimes(1);
});

// VoiceOver shouldn't announce a shutter where a stop button stands.
test('the accessibility label switches while locked', async () => {
  await render(
    <ShutterButton onPhoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={jest.fn()} maxSeconds={30} />
  );
  await videoIsRunning();
  await fireEvent(button(), 'touchMove', BEYOND);
  await fireEvent(button(), 'pressOut');

  expect(screen.getByLabelText('Aufnahme beenden')).toBeTruthy();
  expect(screen.queryByLabelText('Auslöser')).toBeNull();
});

// The gesture's target has to be visible, otherwise you're guessing at it.
test("the lock pill only shows while a video runs and isn't locked yet", async () => {
  await render(
    <ShutterButton onPhoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={jest.fn()} maxSeconds={30} />
  );
  expect(screen.queryByLabelText('Aufnahme sperren')).toBeNull();

  await videoIsRunning();
  expect(screen.getByLabelText('Aufnahme sperren')).toBeTruthy();

  // Once engaged, it's done its job.
  await fireEvent(button(), 'touchMove', BEYOND);
  await fireEvent(button(), 'pressOut');
  expect(screen.queryByLabelText('Aufnahme sperren')).toBeNull();
});

// The core shows what's going on: round means "recording", square means
// "ends the recording". Without this the locked state would be invisible,
// since the lock pill is gone by then.
test('while locked, the round core becomes a square', async () => {
  await render(
    <ShutterButton onPhoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={jest.fn()} maxSeconds={30} />
  );
  await videoIsRunning();
  const round = StyleSheet.flatten(screen.getByTestId('shutter-core').props.style) as ViewStyle;

  await fireEvent(button(), 'touchMove', BEYOND);
  await fireEvent(button(), 'pressOut');
  const square = StyleSheet.flatten(screen.getByTestId('shutter-core').props.style) as ViewStyle;

  expect(round.borderRadius).toBeGreaterThan(square.borderRadius as number);
});

// Before video start there's nothing to lock yet, and the pill isn't shown.
// A swipe during that time must not swallow the tap.
test('a swipe before video start stays a photo', async () => {
  const onPhoto = jest.fn();
  const onVideoStart = jest.fn();
  await render(
    <ShutterButton onPhoto={onPhoto} onVideoStart={onVideoStart} onVideoStop={jest.fn()} maxSeconds={30} />
  );
  await fireEvent(button(), 'pressIn', HOLD);

  await fireEvent(button(), 'touchMove', BEYOND);
  await fireEvent(button(), 'pressOut');

  expect(onPhoto).toHaveBeenCalledTimes(1);
  expect(onVideoStart).not.toHaveBeenCalled();
});

// === Color of a running recording ===
//
// DESIGN-LANGUAGE §1: "accent = interaction, seal = seal symbolism. Never
// mix." A running recording is interaction; gold belongs to the seal and the
// reveal, the only place the phase-4 spec names it too. Up to here, the ring
// and core carried the seal color.
function colorsInTree(): string[] {
  const hits: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const { props, children } = node as {
      props?: Record<string, unknown>;
      children?: unknown[] | null;
    };
    const style = StyleSheet.flatten(props?.style as ViewStyle) as ViewStyle | undefined;
    for (const value of [props?.stroke, props?.color, style?.backgroundColor]) {
      if (typeof value === 'string') hits.push(value);
    }
    (children ?? []).forEach(walk);
  };
  walk(screen.toJSON());
  return hits;
}

test('a running recording carries the accent color, not the seal color', async () => {
  await render(
    <ShutterButton onPhoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={jest.fn()} maxSeconds={30} />
  );
  await videoIsRunning();

  const colors = colorsInTree();
  expect(colors).toContain(palette.accent);
  expect(colors).not.toContain(cinema['seal-glow']);
});

// === Reporting the lock (spec 2026-08-12-kamera-zoom-design.md) ===
//
// Only while locked is the hand free, and only then can anything else next
// to the running recording be operated. A second finger on another control
// would otherwise take the touch away from the holding press (React Native
// knows exactly one responder), the release would arrive, and the
// recording would end mid-zoom. The viewfinder shows the zoom row precisely
// when this callback says `true`.
test('reports the lock engaging', async () => {
  const onLockChange = jest.fn();
  await render(
    <ShutterButton
      onPhoto={jest.fn()}
      onVideoStart={jest.fn()}
      onVideoStop={jest.fn()}
      maxSeconds={30}
      onLockChange={onLockChange}
    />
  );
  await videoIsRunning();
  expect(onLockChange).not.toHaveBeenCalledWith(true);

  await fireEvent(button(), 'touchMove', BEYOND);
  await fireEvent(button(), 'pressOut');

  expect(onLockChange).toHaveBeenLastCalledWith(true);
});

test('reports the lock ending when the recording ends', async () => {
  const onLockChange = jest.fn();
  await render(
    <ShutterButton
      onPhoto={jest.fn()}
      onVideoStart={jest.fn()}
      onVideoStop={jest.fn()}
      maxSeconds={30}
      onLockChange={onLockChange}
    />
  );
  await videoIsRunning();
  await fireEvent(button(), 'touchMove', BEYOND);
  await fireEvent(button(), 'pressOut');

  await fireEvent(screen.getByLabelText('Aufnahme beenden'), 'pressIn');

  expect(onLockChange).toHaveBeenLastCalledWith(false);
});

// === Drag-zoom (spec 2026-08-13-aufnahme-tempo-design.md §7) ===
//
// The shutter only reports the movement; what it does to the zoom is
// decided by the screen (dragFactor in zoom.ts). Measured against the
// touch-down point, same as for the lock gesture, a thumb rarely lands
// dead center.
test('during recording the shutter reports upward drag amount', async () => {
  const onZoomDrag = jest.fn();
  await render(
    <ShutterButton
      onPhoto={jest.fn()}
      onVideoStart={jest.fn()}
      onVideoStop={jest.fn()}
      maxSeconds={30}
      onZoomDrag={onZoomDrag}
    />
  );
  await fireEvent(button(), 'pressIn', { nativeEvent: { pageX: 100, pageY: 500 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  await fireEvent(button(), 'touchMove', { nativeEvent: { pageX: 100, pageY: 300 } });
  expect(onZoomDrag).toHaveBeenLastCalledWith(200);

  // Dragged below the touch-down point: negative, the screen zooms out then.
  await fireEvent(button(), 'touchMove', { nativeEvent: { pageX: 100, pageY: 560 } });
  expect(onZoomDrag).toHaveBeenLastCalledWith(-60);
});

// Device finding from 2026-08-14: on the way to the lock (right), the thumb
// inevitably drifts a bit vertically too, and the recording zoomed along.
// The drag-zoom therefore only engages once the movement CLEARLY dominates
// vertically; a sideways movement stays what it is: the path to the lock.
test("a movement toward the lock doesn't zoom, even with a slight vertical drift", async () => {
  const onZoomDrag = jest.fn();
  await render(
    <ShutterButton
      onPhoto={jest.fn()}
      onVideoStart={jest.fn()}
      onVideoStop={jest.fn()}
      maxSeconds={30}
      onZoomDrag={onZoomDrag}
    />
  );
  await fireEvent(button(), 'pressIn', { nativeEvent: { pageX: 100, pageY: 500 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  // Clearly to the right, slightly up: the hand on the way to the lock.
  await fireEvent(button(), 'touchMove', { nativeEvent: { pageX: 160, pageY: 492 } });
  expect(onZoomDrag).not.toHaveBeenCalled();
});

test('the drag-zoom engages on clearly vertical movement and then follows sideways too', async () => {
  const onZoomDrag = jest.fn();
  await render(
    <ShutterButton
      onPhoto={jest.fn()}
      onVideoStart={jest.fn()}
      onVideoStop={jest.fn()}
      maxSeconds={30}
      onZoomDrag={onZoomDrag}
    />
  );
  await fireEvent(button(), 'pressIn', { nativeEvent: { pageX: 100, pageY: 500 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  // Clearly vertical: the drag-zoom takes over.
  await fireEvent(button(), 'touchMove', { nativeEvent: { pageX: 104, pageY: 470 } });
  expect(onZoomDrag).toHaveBeenLastCalledWith(30);

  // Once taken over, it follows the finger through sideways drift too,
  // mid-zoom the hand shouldn't suddenly grab at nothing.
  await fireEvent(button(), 'touchMove', { nativeEvent: { pageX: 150, pageY: 460 } });
  expect(onZoomDrag).toHaveBeenLastCalledWith(40);
});

test('before the hold threshold the shutter reports no drag amount', async () => {
  const onZoomDrag = jest.fn();
  await render(
    <ShutterButton
      onPhoto={jest.fn()}
      onVideoStart={jest.fn()}
      onVideoStop={jest.fn()}
      maxSeconds={30}
      onZoomDrag={onZoomDrag}
    />
  );
  await fireEvent(button(), 'pressIn', { nativeEvent: { pageX: 100, pageY: 500 } });
  // Threshold (500 ms) deliberately NOT reached: this becomes a photo tap.
  await fireEvent(button(), 'touchMove', { nativeEvent: { pageX: 100, pageY: 300 } });
  expect(onZoomDrag).not.toHaveBeenCalled();
});

test('the lock gesture also works with a simultaneous drag amount', async () => {
  const onZoomDrag = jest.fn();
  const onVideoStop = jest.fn();
  const onLockChange = jest.fn();
  await render(
    <ShutterButton
      onPhoto={jest.fn()}
      onVideoStart={jest.fn()}
      onVideoStop={onVideoStop}
      maxSeconds={30}
      onLockChange={onLockChange}
      onZoomDrag={onZoomDrag}
    />
  );
  await fireEvent(button(), 'pressIn', { nativeEvent: { pageX: 100, pageY: 500 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  // Diagonal: 60 pt to the right (past the 48 lock threshold) and 100 pt up;
  // both axes report, neither crowds out the other.
  await fireEvent(button(), 'touchMove', { nativeEvent: { pageX: 160, pageY: 400 } });
  expect(onZoomDrag).toHaveBeenLastCalledWith(100);

  await fireEvent(button(), 'pressOut');
  expect(onLockChange).toHaveBeenCalledWith(true);
  expect(onVideoStop).not.toHaveBeenCalled();
});

// Device finding from 2026-08-13: the drag-zoom leads the thumb well beyond
// the shutter (up to ~40% of screen height upward, all the way to the edge
// downward). Pressable gives up the press as soon as the touch leaves the
// hold area, the release arrived and stopped the recording mid-zoom. The
// gesture tests above fire pressIn/touchMove synthetically and don't see
// the native geometry, so this test pins down the area itself: it must
// cover every iPhone dimension (Pro Max: 956 pt logical height).
test('the press hold area covers the whole screen, not just the path to the lock', async () => {
  await render(
    <ShutterButton onPhoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={jest.fn()} maxSeconds={30} />
  );
  // Pressable CONSUMES the hold area (it goes into the Pressability
  // configuration, not onto the host view), so it's invisible in the
  // Testing Library's host tree. The only window is the fiber path upward,
  // searched by the prop itself rather than a component identity, so the
  // test survives React upgrades.
  let fiber = screen.getByLabelText('Auslöser').unstable_fiber;
  while (fiber && fiber.memoizedProps?.pressRetentionOffset === undefined) {
    fiber = fiber.return;
  }
  const area = fiber?.memoizedProps?.pressRetentionOffset;
  expect(area).toBeDefined();
  expect(area.top).toBeGreaterThanOrEqual(1000);
  expect(area.bottom).toBeGreaterThanOrEqual(1000);
  expect(area.left).toBeGreaterThanOrEqual(1000);
  expect(area.right).toBeGreaterThanOrEqual(1000);
});

// Device finding from 2026-08-13: a tap anywhere else broke off filming.
// React Native knows exactly one responder; any other touchable (a tab bar
// button is enough) requests it on tap, and Pressable gives it up by
// default (`cancelable ?? true`, Pressability.js). Giving it up fires
// onPressOut, which stops the video. `cancelable: false` declines the
// request: the press survives, the foreign touchable doesn't fire at all.
// Like the hold area, the prop is only visible through the fiber path.
test("the holding press doesn't give up the responder (cancelable: false)", async () => {
  await render(
    <ShutterButton onPhoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={jest.fn()} maxSeconds={30} />
  );
  let fiber = screen.getByLabelText('Auslöser').unstable_fiber;
  while (fiber && fiber.memoizedProps?.cancelable === undefined) {
    fiber = fiber.return;
  }
  expect(fiber?.memoizedProps?.cancelable).toBe(false);
});

// === Finger guard ===
//
// Because the press keeps the responder (cancelable: false), events from
// ALL fingers land on the shutter. onTouchMove must only follow the finger
// that started the press, otherwise a second tap elsewhere on screen would
// shift the lock threshold or tear the drag-zoom around.
test("a second finger past the threshold doesn't lock", async () => {
  const onVideoStop = jest.fn();
  await render(
    <ShutterButton onPhoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSeconds={30} />
  );
  await fireEvent(button(), 'pressIn', { nativeEvent: { pageX: 100, identifier: 1 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  // The foreign finger taps far to the right, for the holding finger that
  // would be past the lock threshold.
  await fireEvent(button(), 'touchMove', { nativeEvent: { pageX: 300, identifier: 2 } });
  await fireEvent(button(), 'pressOut');

  // Not locked: releasing ends the recording as always.
  expect(onVideoStop).toHaveBeenCalledTimes(1);
});

// Device finding from 2026-08-14, the actual abort mechanism: because the
// press keeps the responder, React Native fires onPressOut as soon as ANY
// finger ends, including the second, tapping one. The end of the press must
// therefore be finger-aware: foreign pressOuts say nothing, the real end of
// the holding finger reliably arrives via the raw touchEnd (even after a
// premature responder release).
test("releasing a second finger doesn't end the recording, releasing the holding finger does", async () => {
  const onVideoStop = jest.fn();
  const onPhoto = jest.fn();
  await render(
    <ShutterButton onPhoto={onPhoto} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSeconds={30} />
  );
  await fireEvent(button(), 'pressIn', { nativeEvent: { pageX: 100, identifier: 1 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  // The second finger taps somewhere and lifts: its pressOut isn't one.
  await fireEvent(button(), 'pressOut', { nativeEvent: { identifier: 2, touches: [{ identifier: 1 }] } });
  expect(onVideoStop).not.toHaveBeenCalled();

  // The holding finger lifts: the real end, as a raw touchEnd.
  await fireEvent(button(), 'touchEnd', { nativeEvent: { identifier: 1, touches: [] } });
  expect(onVideoStop).toHaveBeenCalledTimes(1);
  expect(onPhoto).not.toHaveBeenCalled();
});

// After the premature responder release, another finger can hit the
// shutter: the press stops the recording (stop area, test further below),
// and it must not throw the state machine back to 'holding', or releasing
// the holding finger would take a photo.
test("after a press mid-recording, releasing the holding finger doesn't take a photo", async () => {
  const onVideoStop = jest.fn();
  const onPhoto = jest.fn();
  await render(
    <ShutterButton onPhoto={onPhoto} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSeconds={30} />
  );
  await fireEvent(button(), 'pressIn', { nativeEvent: { pageX: 100, identifier: 1 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  await fireEvent(button(), 'pressIn', { nativeEvent: { pageX: 120, identifier: 2 } });
  await fireEvent(button(), 'touchEnd', { nativeEvent: { identifier: 1, touches: [] } });

  expect(onVideoStop).toHaveBeenCalledTimes(1);
  expect(onPhoto).not.toHaveBeenCalled();
});

// Device finding from 2026-08-14, second round: after a foreign finger ends,
// iOS CANCELS the touch of the holding finger, it never delivers another
// event, so the release never arrives. Stopping would be the old
// regression, ignoring it would leave the recording unstoppable (both
// observed on device). The way out: the recording locks itself, keeps
// running hands-free, and the shutter becomes the stop button.
test('a touchCancel of the holding finger locks the recording instead of ending it', async () => {
  const onVideoStop = jest.fn();
  const onLockChange = jest.fn();
  await render(
    <ShutterButton
      onPhoto={jest.fn()}
      onVideoStart={jest.fn()}
      onVideoStop={onVideoStop}
      maxSeconds={30}
      onLockChange={onLockChange}
    />
  );
  await fireEvent(button(), 'pressIn', { nativeEvent: { pageX: 100, identifier: 1 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  await fireEvent(button(), 'touchCancel', { nativeEvent: { identifier: 1 } });

  expect(onVideoStop).not.toHaveBeenCalled();
  expect(onLockChange).toHaveBeenCalledWith(true);

  // Locked means: the shutter ends the recording with a tap.
  await fireEvent(screen.getByLabelText('Aufnahme beenden'), 'pressIn');
  expect(onVideoStop).toHaveBeenCalledTimes(1);
});

// The counterpart to locking via cancel: the recording must stay endable in
// EVERY state. A pressIn firing while it's running (only possible once
// Pressability has re-armed after a foreign end) is a deliberate tap on the
// shutter, and that's the stop area.
test('a press on the shutter mid-recording ends it', async () => {
  const onVideoStop = jest.fn();
  const onPhoto = jest.fn();
  await render(
    <ShutterButton onPhoto={onPhoto} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSeconds={30} />
  );
  await fireEvent(button(), 'pressIn', { nativeEvent: { pageX: 100, identifier: 1 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  await fireEvent(button(), 'pressIn', { nativeEvent: { pageX: 100, identifier: 2 } });

  expect(onVideoStop).toHaveBeenCalledTimes(1);
  expect(onPhoto).not.toHaveBeenCalled();
});

test("a second finger doesn't move the drag-zoom", async () => {
  const onZoomDrag = jest.fn();
  await render(
    <ShutterButton
      onPhoto={jest.fn()}
      onVideoStart={jest.fn()}
      onVideoStop={jest.fn()}
      maxSeconds={30}
      onZoomDrag={onZoomDrag}
    />
  );
  await fireEvent(button(), 'pressIn', { nativeEvent: { pageX: 100, pageY: 500, identifier: 1 } });
  await act(() => {
    jest.advanceTimersByTime(600);
  });

  await fireEvent(button(), 'touchMove', { nativeEvent: { pageX: 100, pageY: 100, identifier: 2 } });
  expect(onZoomDrag).not.toHaveBeenCalled();

  // The own finger keeps reporting: the guard filters, it doesn't go silent.
  await fireEvent(button(), 'touchMove', { nativeEvent: { pageX: 100, pageY: 300, identifier: 1 } });
  expect(onZoomDrag).toHaveBeenLastCalledWith(200);
});
