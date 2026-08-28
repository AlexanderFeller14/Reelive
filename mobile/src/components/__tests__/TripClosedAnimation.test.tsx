import { render, act } from '@testing-library/react-native';
import * as React from 'react';
import { TripClosedAnimation } from '../TripClosedAnimation';

// Reanimated drives the visuals on the UI thread; in the test only the
// mechanics matter (timers, reset, a11y, haptic). Same hand-written mock as
// MomentSubmissionAnimation.test.tsx, for the same reason: the official mock
// pulls in the native worklets module, which doesn't exist in Jest.
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
// just passes the props through.
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

// Timeline (prototype C, chosen 2026-08-28): the polaroids fly in and
// gather behind the ticket that rises at 900 ms, the wax lands on the
// perforation at 1750 ms (and with it the haptic), the sparks rise, the
// title follows at 2100 ms, the rest is reading time. 3000 ms in total.
// Reduced motion: fades only, 900 ms.
const TOTAL = 3_000;
const SEAL_LANDS = 1_750;
const REDUCED_TOTAL = 900;

function subject(props: Partial<React.ComponentProps<typeof TripClosedAnimation>> = {}) {
  return (
    <TripClosedAnimation
      visible={true}
      onFinished={jest.fn()}
      title="Sardinien"
      range="3.–6. Sep 2026"
      {...props}
    />
  );
}

test('invisible renders nothing and onFinished is never called', async () => {
  const onFinished = jest.fn();
  const { queryByTestId, unmount } = await render(subject({ visible: false, onFinished }));
  expect(queryByTestId('trip-closed-animation')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  expect(onFinished).not.toHaveBeenCalled();
  expect(mockNotificationAsync).not.toHaveBeenCalled();
  await unmount();
});

test('onFinished arrives exactly once, after the full total duration', async () => {
  const onFinished = jest.fn();
  const { unmount } = await render(subject({ onFinished }));

  await act(async () => {
    jest.advanceTimersByTime(TOTAL - 1);
  });
  expect(onFinished).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onFinished).toHaveBeenCalledTimes(1);

  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  expect(onFinished).toHaveBeenCalledTimes(1);
  await unmount();
});

test("a rerender with visible unchanged doesn't fire onFinished twice", async () => {
  const onFinished = jest.fn();
  const { rerender, unmount } = await render(subject({ onFinished }));
  await act(async () => {
    jest.advanceTimersByTime(1_000);
  });
  // The rerender gets its own act: nested inside the timer block React
  // warns about an un-awaited act and the scopes interleave.
  await act(async () => {
    rerender(subject({ onFinished }));
  });
  await act(async () => {
    jest.advanceTimersByTime(TOTAL);
  });
  expect(onFinished).toHaveBeenCalledTimes(1);
  await unmount();
});

test('visible off and back on restarts the animation fully from the start', async () => {
  const onFinished = jest.fn();
  const { rerender, queryByTestId, unmount } = await render(subject({ onFinished }));
  await act(async () => {
    jest.advanceTimersByTime(1_000);
    rerender(subject({ visible: false, onFinished }));
  });
  expect(queryByTestId('trip-closed-animation')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  expect(onFinished).not.toHaveBeenCalled();

  await act(async () => {
    rerender(subject({ onFinished }));
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
  const { unmount } = await render(subject({ onFinished }));
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
  const { unmount } = await render(subject({ onFinished }));
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

test('the success haptic fires exactly once, when the wax lands', async () => {
  const { unmount } = await render(subject());
  await act(async () => {
    jest.advanceTimersByTime(SEAL_LANDS - 1);
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

test('shows title and subtitle, the ticket with the trip on it, the wax and three decorative polaroids', async () => {
  const { getByText, getAllByTestId, getByTestId, unmount } = await render(subject());
  expect(getByText('Reise abgeschlossen')).toBeTruthy();
  expect(getByText('Alle Momente sind drin. Euer Recap ist bereit.')).toBeTruthy();

  // The ticket carries the same lines as the recap letter it turns into.
  expect(getByText('Dein Recap')).toBeTruthy();
  expect(getByText('Sardinien')).toBeTruthy();
  expect(getByText('3.–6. Sep 2026')).toBeTruthy();
  expect(getByTestId('trip-closed-seal', { includeHiddenElements: true })).toBeTruthy();

  const polaroids = getAllByTestId('trip-closed-polaroid', { includeHiddenElements: true });
  expect(polaroids).toHaveLength(3);
  for (const polaroid of polaroids) {
    expect(polaroid.props.accessibilityElementsHidden).toBe(true);
  }

  // The whole interstitial announces itself as ONE element.
  expect(getByTestId('trip-closed-animation').props.accessibilityLabel).toBe(
    'Reise abgeschlossen, euer Recap ist bereit'
  );
  await act(async () => {
    jest.advanceTimersByTime(TOTAL);
  });
  await unmount();
});

test('without a date range the ticket keeps only chapter and title', async () => {
  const { queryByTestId, getByText, unmount } = await render(subject({ range: null }));
  expect(getByText('Sardinien')).toBeTruthy();
  expect(queryByTestId('trip-closed-range')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(TOTAL);
  });
  await unmount();
});
