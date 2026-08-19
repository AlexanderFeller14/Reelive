import { render, act } from '@testing-library/react-native';
import * as React from 'react';
import { MomentSubmissionAnimation } from '../MomentSubmissionAnimation';

// Reanimated drives the visuals on the UI thread; in the test only the
// mechanics matter (timers, reset, a11y, haptic). The OFFICIAL mock of the
// library is unusable here: it imports react-native-reanimated/src and
// with it the native react-native-worklets module, which doesn't exist in
// Jest (loadUnpackers crash). Hence a hand-written mock following the
// pattern of the other native gaps (expo-video, react-native-maps in
// jest.setup.ts): the with*-helpers simply return their target value,
// useAnimatedStyle evaluates the style factory once, statically.
jest.mock('react-native-reanimated', () => {
  const ReactActual = require('react');
  const { View, Text, Image } = require('react-native');
  const passthrough = (props: Record<string, unknown>) =>
    ReactActual.createElement(View, props, props.children);
  return {
    __esModule: true,
    default: {
      View: passthrough,
      Text: (props: Record<string, unknown>) => ReactActual.createElement(Text, props, props.children),
      Image: (props: Record<string, unknown>) => ReactActual.createElement(Image, props),
      createAnimatedComponent: (Component: unknown) => Component,
    },
    useSharedValue: (start: unknown) => ReactActual.useRef({ value: start }).current,
    useAnimatedStyle: (factory: () => object) => factory(),
    withTiming: (target: unknown) => target,
    withSpring: (target: unknown) => target,
    withDelay: (_ms: number, animation: unknown) => animation,
    withSequence: (...steps: unknown[]) => steps[steps.length - 1],
    cancelAnimation: () => {},
    Easing: { bezier: () => ({}) },
  };
});

const mockNotificationAsync = jest.fn(async (..._args: unknown[]) => {});
jest.mock('expo-haptics', () => ({
  notificationAsync: (...args: unknown[]) => mockNotificationAsync(...args),
  NotificationFeedbackType: { Success: 'success' },
}));

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/theme/useReducedMotion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

// expo-image is a native view and can't be loaded in Jest; the placeholder
// just passes the props through (same pattern as vorschau.test.tsx).
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

jest.useFakeTimers();

beforeEach(() => {
  jest.clearAllMocks();
  mockUseReducedMotion.mockReturnValue(false);
});

// Timeline: 3600 ms total duration, strictly sequential (device acceptance:
// "polaroids, then the checkmark, then the count, nice and clean"): the
// polaroids are completely gone by 1700 ms, the pin (and with it the
// haptic) doesn't arrive until 1800 ms, the counter appears starting at
// 2300 ms standing still and rolls exactly once, the rest is reading time.
// Reduced motion: fades only, 900 ms.
const TOTAL = 3_600;
const PIN_START = 1_800;
const REDUCED_TOTAL = 900;

test('invisible renders nothing and onFinished is never called', async () => {
  const onFinished = jest.fn();
  const { queryByTestId, unmount } = await render(
    <MomentSubmissionAnimation visible={false} onFinished={onFinished} />
  );
  expect(queryByTestId('memory-animation')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  expect(onFinished).not.toHaveBeenCalled();
  expect(mockNotificationAsync).not.toHaveBeenCalled();
  await unmount();
});

test('onFinished arrives exactly once, after the full total duration', async () => {
  const onFinished = jest.fn();
  const { unmount } = await render(
    <MomentSubmissionAnimation visible={true} onFinished={onFinished} />
  );

  await act(async () => {
    jest.advanceTimersByTime(TOTAL - 1);
  });
  expect(onFinished).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onFinished).toHaveBeenCalledTimes(1);

  // Even long after, it stays at exactly one call.
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  expect(onFinished).toHaveBeenCalledTimes(1);
  await unmount();
});

test("a rerender with visible unchanged doesn't fire onFinished twice", async () => {
  const onFinished = jest.fn();
  const { rerender, unmount } = await render(
    <MomentSubmissionAnimation visible={true} onFinished={onFinished} />
  );
  await act(async () => {
    jest.advanceTimersByTime(1_000);
    rerender(<MomentSubmissionAnimation visible={true} onFinished={onFinished} />);
    jest.advanceTimersByTime(TOTAL);
  });
  expect(onFinished).toHaveBeenCalledTimes(1);
  await unmount();
});

test('visible off and back on restarts the animation fully from the start', async () => {
  const onFinished = jest.fn();
  const { rerender, queryByTestId, unmount } = await render(
    <MomentSubmissionAnimation visible={true} onFinished={onFinished} />
  );
  await act(async () => {
    jest.advanceTimersByTime(1_000);
    rerender(<MomentSubmissionAnimation visible={false} onFinished={onFinished} />);
  });
  // Aborted: nothing left in the tree, no late onFinished.
  expect(queryByTestId('memory-animation')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  expect(onFinished).not.toHaveBeenCalled();

  // Restart: the FULL duration again, not the remainder of the first
  // round. Rerender and timer advance kept separate: the completion timer
  // is only created in the effect, and that only runs at the end of the
  // act block.
  await act(async () => {
    rerender(<MomentSubmissionAnimation visible={true} onFinished={onFinished} />);
  });
  await act(async () => {
    jest.advanceTimersByTime(TOTAL - 1);
  });
  expect(onFinished).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onFinished).toHaveBeenCalledTimes(1);
  await unmount();
});

test('with reduced motion, the shortened version reliably ends after 900 ms', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  const onFinished = jest.fn();
  const { unmount } = await render(
    <MomentSubmissionAnimation visible={true} onFinished={onFinished} />
  );
  await act(async () => {
    jest.advanceTimersByTime(REDUCED_TOTAL - 1);
  });
  expect(onFinished).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onFinished).toHaveBeenCalledTimes(1);
  await unmount();
});

test("an unmount during the animation doesn't call onFinished or the haptic afterward", async () => {
  const onFinished = jest.fn();
  const { unmount } = await render(
    <MomentSubmissionAnimation visible={true} onFinished={onFinished} />
  );
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  await unmount();
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  expect(onFinished).not.toHaveBeenCalled();
  expect(mockNotificationAsync).not.toHaveBeenCalled();
});

test('the success haptic fires exactly once, when the pin appears', async () => {
  const onFinished = jest.fn();
  const { unmount } = await render(
    <MomentSubmissionAnimation visible={true} onFinished={onFinished} />
  );
  await act(async () => {
    jest.advanceTimersByTime(PIN_START - 1);
  });
  expect(mockNotificationAsync).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockNotificationAsync).toHaveBeenCalledWith('success');
  await act(async () => {
    jest.advanceTimersByTime(TOTAL);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  await unmount();
});

test("rolls the counter up one digit when the trip's count is available", async () => {
  const { getByTestId, unmount } = await render(
    <MomentSubmissionAnimation visible={true} onFinished={jest.fn()} counter={11} />
  );
  // 11 → 12: the tens digit stays fixed, the ones digit rolls 1 → 2
  // (digit roll from CounterRoll.tsx, tested in detail there).
  expect(getByTestId('memory-zaehler')).toBeTruthy();
  expect(getByTestId('zaehler-ziffer-fest-0').props.children).toBe('1');
  expect(getByTestId('zaehler-ziffer-alt-1').props.children).toBe('1');
  expect(getByTestId('zaehler-ziffer-neu-1').props.children).toBe('2');
  await act(async () => {
    jest.advanceTimersByTime(TOTAL);
  });
  await unmount();
});

test('without a counter value, the animation runs without a number', async () => {
  const { queryByTestId, unmount } = await render(
    <MomentSubmissionAnimation visible={true} onFinished={jest.fn()} counter={null} />
  );
  expect(queryByTestId('memory-zaehler')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(TOTAL);
  });
  await unmount();
});

test('with reduced motion, the new count stands still, without a roll', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  const { getByText, queryByTestId, unmount } = await render(
    <MomentSubmissionAnimation visible={true} onFinished={jest.fn()} counter={11} />
  );
  expect(getByText('12')).toBeTruthy();
  expect(queryByTestId('zaehler-ziffer-neu-1')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(REDUCED_TOTAL);
  });
  await unmount();
});

test('shows the title, subtitle, three decorative polaroids, and the confirmation pin', async () => {
  const { getByText, getAllByTestId, getByTestId, unmount } = await render(
    <MomentSubmissionAnimation visible={true} onFinished={jest.fn()} />
  );
  expect(getByText('Moment eingesendet')).toBeTruthy();
  expect(getByText('Dein Moment ist unterwegs und bleibt bis zum Recap versiegelt.')).toBeTruthy();

  // includeHiddenElements: the polaroids are deliberately hidden from
  // accessibility, standard queries filter out exactly such elements, here
  // they should still be counted.
  const polaroids = getAllByTestId('memory-polaroid', { includeHiddenElements: true });
  expect(polaroids).toHaveLength(3);
  // Decorative: no polaroid gets read out individually by the screen
  // reader.
  for (const polaroid of polaroids) {
    expect(polaroid.props.accessibilityElementsHidden).toBe(true);
  }

  expect(getByTestId('memory-pin')).toBeTruthy();
  // The whole interstitial screen announces itself as ONE element with a
  // clear statement.
  expect(getByTestId('memory-animation').props.accessibilityLabel).toBe(
    'Moment erfolgreich eingesendet'
  );
  await act(async () => {
    jest.advanceTimersByTime(TOTAL);
  });
  await unmount();
});
