import { render, act, screen } from '@testing-library/react-native';
import * as React from 'react';
import { Animated } from 'react-native';
import { RevealSequence } from '../RevealSequence';
import { cinema, motion } from '@/theme/tokens';

const mockNotificationAsync = jest.fn(async (..._args: unknown[]) => {});
jest.mock('expo-haptics', () => ({
  notificationAsync: (...args: unknown[]) => mockNotificationAsync(...args),
  NotificationFeedbackType: { Success: 'success' },
}));

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/theme/useReducedMotion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

// Review Important 2: the original test suite checked only mechanics
// (haptics, timers, reduced motion), never WHETHER a seal, a break-open, or
// even a single spark actually lands in the tree. A local stand-in for the
// three icons makes exactly that checkable: identifiable placeholders with
// a `testID` that pass through the actually supplied `color`/`size` props,
// more robust than parsing lucide-react-native's internal SVG path
// structure, and it works despite the `moduleNameMapper` for
// `lucide-react-native` in the Jest config (jest.mock() wins for the exact
// module specifier).
jest.mock('lucide-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const stub = (name: string) => {
    const Component = ({ color, size }: { color?: string; size?: number }) =>
      React.createElement(View, { testID: `icon-${name}`, color, size });
    Component.displayName = name;
    return Component;
  };
  return { Lock: stub('Lock'), LockOpen: stub('LockOpen'), Sparkle: stub('Sparkle') };
});

jest.useFakeTimers();

beforeEach(() => {
  jest.clearAllMocks();
  mockUseReducedMotion.mockReturnValue(false);
});

test('invisible triggers neither the haptic nor onFinished', async () => {
  const onFinished = jest.fn();
  const { unmount } = await render(<RevealSequence visible={false} onFinished={onFinished} />);
  await act(async () => {
    jest.advanceTimersByTime(2_000);
  });
  expect(mockNotificationAsync).not.toHaveBeenCalled();
  expect(onFinished).not.toHaveBeenCalled();
  await unmount();
});

test('visible triggers the success haptic exactly once', async () => {
  const onFinished = jest.fn();
  const { rerender, unmount } = await render(<RevealSequence visible={true} onFinished={onFinished} />);
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockNotificationAsync).toHaveBeenCalledWith('success');

  // Rendering again with visible=true unchanged must not fire the haptic a
  // second time.
  await act(async () => {
    rerender(<RevealSequence visible={true} onFinished={onFinished} />);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);

  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  await unmount();
});

test('a change of prefers-reduced-motion during the sequence does not fire the haptic twice', async () => {
  const onFinished = jest.fn();
  const { rerender, unmount } = await render(<RevealSequence visible={true} onFinished={onFinished} />);
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);

  mockUseReducedMotion.mockReturnValue(true);
  await act(async () => {
    rerender(<RevealSequence visible={true} onFinished={onFinished} />);
  });

  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);

  await act(async () => {
    jest.advanceTimersByTime(200);
  });
  await unmount();
});

test('onFinished arrives after the full sequence duration (700-900 ms)', async () => {
  const onFinished = jest.fn();
  const { unmount } = await render(<RevealSequence visible={true} onFinished={onFinished} />);

  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  expect(onFinished).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(onFinished).toHaveBeenCalledTimes(1);

  await unmount();
});

test('with reduced motion the duration is a short 200 ms fade', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  const onFinished = jest.fn();
  const { unmount } = await render(<RevealSequence visible={true} onFinished={onFinished} />);

  await act(async () => {
    jest.advanceTimersByTime(199);
  });
  expect(onFinished).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onFinished).toHaveBeenCalledTimes(1);

  await unmount();
});

test('an unmount during the sequence no longer calls onFinished', async () => {
  const onFinished = jest.fn();
  const { unmount } = await render(<RevealSequence visible={true} onFinished={onFinished} />);
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  await unmount();
  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  expect(onFinished).not.toHaveBeenCalled();
});

test('invisible renders nothing (no overlay in the tree)', async () => {
  const onFinished = jest.fn();
  const { queryByTestId, unmount } = await render(
    <RevealSequence visible={false} onFinished={onFinished} />
  );
  expect(queryByTestId('reveal-inszenierung')).toBeNull();
  await unmount();
});

test('visible renders the sequence overlay', async () => {
  const onFinished = jest.fn();
  const { queryByTestId, unmount } = await render(
    <RevealSequence visible={true} onFinished={onFinished} />
  );
  expect(queryByTestId('reveal-inszenierung')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  await unmount();
});

// === Review Important 2: the actual §5 requirement ("the seal breaks
// open, gold sparks ✦ rise, no confetti") is now actually checked, not just
// the mechanics around it. ===

test('shows both the closed seal (Lock) and the open seal (LockOpen), both in the cinema-gold color', async () => {
  const onFinished = jest.fn();
  const { unmount } = await render(<RevealSequence visible={true} onFinished={onFinished} />);

  const lock = screen.getByTestId('icon-Lock');
  const lockOpen = screen.getByTestId('icon-LockOpen');
  // §1: `seal-glow`, never `accent` or a foreign hex literal.
  expect(lock.props.color).toBe(cinema['seal-glow']);
  expect(lockOpen.props.color).toBe(cinema['seal-glow']);

  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  await unmount();
});

test('exactly five gold sparks rise, no confetti, all in the cinema-gold color', async () => {
  const onFinished = jest.fn();
  const { unmount } = await render(<RevealSequence visible={true} onFinished={onFinished} />);

  const sparks = screen.getAllByTestId('icon-Sparkle');
  // Neither more (a confetti-like amount) nor fewer, and none of them in
  // any color other than seal-glow (colorful squares would have slipped
  // through here).
  expect(sparks).toHaveLength(5);
  sparks.forEach((spark) => expect(spark.props.color).toBe(cinema['seal-glow']));

  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  await unmount();
});

// Review Major 1: the sparks sat in the top-left corner of the screen
// instead of spread around the seal because of set `left`/`top` insets on a
// `position: absolute` child, a set inset in Yoga ALWAYS outranks the
// parent's `alignItems`/`justifyContent: center` alignment. This test
// checks the condition structurally: no `left`/`top`, only `transform` with
// five DIFFERENT `translateX` values (the scatter).
test('the sparks are positioned exclusively via transform, no left/top that would outrank the parent centering', async () => {
  const onFinished = jest.fn();
  const { unmount } = await render(<RevealSequence visible={true} onFinished={onFinished} />);

  const sparkWrappers = screen.root!.queryAll(
    (i) =>
      i.type === 'View' &&
      Array.isArray((i.props.style as { transform?: unknown[] } | undefined)?.transform) &&
      (i.props.style as { transform: Record<string, unknown>[] }).transform.some(
        (t) => 'translateX' in t
      )
  );
  expect(sparkWrappers).toHaveLength(5);

  sparkWrappers.forEach((wrapper) => {
    const style = wrapper.props.style as { left?: unknown; top?: unknown };
    expect(style.left).toBeUndefined();
    expect(style.top).toBeUndefined();
  });

  const offsetsX = sparkWrappers.map(
    (h) => (h.props.style as { transform: { translateX: number }[] }).transform[0].translateX
  );
  expect(new Set(offsetsX).size).toBe(5);

  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  await unmount();
});

// Review Important 2, mutations 4+5: catches both the removal of
// `useNativeDriver: true` and a subsequently added `easing: Easing.linear`
// (§5: "linear is forbidden") in a single exact match of the config, a spy
// on `Animated.timing` itself, regardless of whether the animation ever
// progresses in the test run.
test('starts the timing animation exclusively with useNativeDriver, without a custom easing function', async () => {
  const timingSpy = jest.spyOn(Animated, 'timing');
  const onFinished = jest.fn();
  const { unmount } = await render(<RevealSequence visible={true} onFinished={onFinished} />);

  expect(timingSpy).toHaveBeenCalledWith(expect.anything(), {
    toValue: 1,
    duration: motion.duration.feature,
    useNativeDriver: true,
  });

  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  await unmount();
  timingSpy.mockRestore();
});

// Review Important 2, mutation 7: an outputRange frozen to a single value
// would NOT be observable via the rendered end state, in the test run
// `progress._value` (useNativeDriver: true, no native Animated module
// connected) never moves past 0 anyway, so every interpolation shows only
// its leftmost value either way. That's why the actually supplied config of
// every `interpolate()` call is checked here, not a render snapshot.
test('every interpolation actually moves, no outputRange is frozen to a single value', async () => {
  const interpolateSpy = jest.spyOn(Animated.Value.prototype, 'interpolate');
  const onFinished = jest.fn();
  const { unmount } = await render(<RevealSequence visible={true} onFinished={onFinished} />);

  // scrim, seal-closed (opacity+scale), seal-open (opacity+scale), and five
  // sparks (each opacity+translateY), 1 + 2 + 2 + 5*2 = 15 calls.
  expect(interpolateSpy.mock.calls.length).toBe(15);
  interpolateSpy.mock.calls.forEach(([config]) => {
    const outputRange = (config as { outputRange: number[] }).outputRange;
    expect(new Set(outputRange).size).toBeGreaterThan(1);
  });

  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  await unmount();
  interpolateSpy.mockRestore();
});

// Review Minor: unlike SealAnimation.tsx, here tappable, partly destructive
// actions sit underneath the overlay (delete/edit trip, remove member),
// `pointerEvents="none"` would let taps through unhindered for the whole
// sequence.
test('blocks taps on underlying surfaces while it is running (pointerEvents)', async () => {
  const onFinished = jest.fn();
  const { unmount } = await render(<RevealSequence visible={true} onFinished={onFinished} />);

  expect(screen.getByTestId('reveal-inszenierung').props.pointerEvents).toBe('auto');

  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  await unmount();
});
