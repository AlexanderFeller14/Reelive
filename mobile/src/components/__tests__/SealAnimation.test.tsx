import { render, act } from '@testing-library/react-native';
import * as React from 'react';
import { SealAnimation } from '../SealAnimation';

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
// passes the props through (same pattern as preview.test.tsx).
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

// Timing scaffold of the sequence: 800 ms choreography (motion.duration.feature),
// the haptic fires on seal close at 55% of that (440 ms), then 500 ms of
// afterglow follow so the rolled-up counter stays readable, only then does
// onFinished arrive. With reduced motion: 200 ms fade + the same afterglow.
const DURATION = 800;
const SEAL_CLOSE = 440;
const AFTERGLOW = 500;
const REDUCED = 200;

test('invisible triggers neither the haptic nor onFinished', async () => {
  const onFinished = jest.fn();
  const { unmount } = await render(<SealAnimation visible={false} onFinished={onFinished} />);
  await act(async () => {
    jest.advanceTimersByTime(3_000);
  });
  expect(mockNotificationAsync).not.toHaveBeenCalled();
  expect(onFinished).not.toHaveBeenCalled();
  await unmount();
});

test('the success haptic fires exactly once, on seal close rather than at the start', async () => {
  const onFinished = jest.fn();
  const { rerender, unmount } = await render(<SealAnimation visible={true} onFinished={onFinished} />);

  // Nothing happens at the start yet: the seal isn't closed at all yet.
  expect(mockNotificationAsync).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(SEAL_CLOSE);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockNotificationAsync).toHaveBeenCalledWith('success');

  // Rerendering with visible=true unchanged must not trigger the haptic a
  // second time.
  await act(async () => {
    rerender(<SealAnimation visible={true} onFinished={onFinished} />);
    jest.advanceTimersByTime(DURATION + AFTERGLOW);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  await unmount();
});

// Fix round 1 (carried over from the old version): a change of
// prefers-reduced-motion while the sequence is already running reruns the
// effect (the duration depends on it). The ref guard must keep limiting the
// haptic to exactly once per seal, no matter when the change arrives.
test("a change of prefers-reduced-motion after seal close doesn't fire the haptic twice", async () => {
  const onFinished = jest.fn();
  const { rerender, unmount } = await render(<SealAnimation visible={true} onFinished={onFinished} />);
  await act(async () => {
    jest.advanceTimersByTime(SEAL_CLOSE);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);

  mockUseReducedMotion.mockReturnValue(true);
  await act(async () => {
    rerender(<SealAnimation visible={true} onFinished={onFinished} />);
    jest.advanceTimersByTime(REDUCED + AFTERGLOW);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  await unmount();
});

test('a switch to reduced motion before seal close fires the haptic once, not twice', async () => {
  const onFinished = jest.fn();
  const { rerender, unmount } = await render(<SealAnimation visible={true} onFinished={onFinished} />);
  await act(async () => {
    jest.advanceTimersByTime(100);
  });
  expect(mockNotificationAsync).not.toHaveBeenCalled();

  mockUseReducedMotion.mockReturnValue(true);
  await act(async () => {
    rerender(<SealAnimation visible={true} onFinished={onFinished} />);
    jest.advanceTimersByTime(REDUCED + AFTERGLOW);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  await unmount();
});

test('onFinished arrives only after the choreography plus the afterglow', async () => {
  const onFinished = jest.fn();
  const { unmount } = await render(<SealAnimation visible={true} onFinished={onFinished} />);

  await act(async () => {
    jest.advanceTimersByTime(DURATION + AFTERGLOW - 1);
  });
  expect(onFinished).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onFinished).toHaveBeenCalledTimes(1);

  await unmount();
});

test('with reduced motion it stays a short fade, the afterglow for reading remains', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  const onFinished = jest.fn();
  const { unmount } = await render(<SealAnimation visible={true} onFinished={onFinished} />);

  await act(async () => {
    jest.advanceTimersByTime(REDUCED + AFTERGLOW - 1);
  });
  expect(onFinished).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onFinished).toHaveBeenCalledTimes(1);

  await unmount();
});

test('an unmount during the sequence calls neither onFinished nor the haptic afterward', async () => {
  const onFinished = jest.fn();
  const { unmount } = await render(<SealAnimation visible={true} onFinished={onFinished} />);
  await act(async () => {
    jest.advanceTimersByTime(100);
  });
  await unmount();
  await act(async () => {
    jest.advanceTimersByTime(3_000);
  });
  expect(onFinished).not.toHaveBeenCalled();
  expect(mockNotificationAsync).not.toHaveBeenCalled();
});

test('shows the given moment image shrinking into the film reel', async () => {
  const { getByTestId, unmount } = await render(
    <SealAnimation visible={true} onFinished={jest.fn()} imageUri="file:///momente/m1.jpg" />
  );
  expect(getByTestId('seal-moment')).toBeTruthy();
  expect(getByTestId('seal-film-reel')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(DURATION + AFTERGLOW);
  });
  await unmount();
});

test('without an image the sequence still runs, just without a moment image', async () => {
  const { queryByTestId, getByTestId, unmount } = await render(
    <SealAnimation visible={true} onFinished={jest.fn()} />
  );
  expect(queryByTestId('seal-moment')).toBeNull();
  expect(getByTestId('seal-film-reel')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(DURATION + AFTERGLOW);
  });
  await unmount();
});

test('rolls the counter up one digit and shows the sealed line', async () => {
  const { getByTestId, getByText, unmount } = await render(
    <SealAnimation visible={true} onFinished={jest.fn()} counter={11} />
  );
  // 11 → 12: the tens digit stays fixed, the ones digit rolls 1 → 2.
  expect(getByTestId('counter-digit-fixed-0').props.children).toBe('1');
  expect(getByTestId('counter-digit-old-1').props.children).toBe('1');
  expect(getByTestId('counter-digit-new-1').props.children).toBe('2');
  expect(getByText('Bis zum Recap versiegelt.')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(DURATION + AFTERGLOW);
  });
  await unmount();
});

test('without a counter value the number is omitted, the sealed line remains', async () => {
  const { queryByTestId, getByText, unmount } = await render(
    <SealAnimation visible={true} onFinished={jest.fn()} counter={null} />
  );
  expect(queryByTestId('seal-counter')).toBeNull();
  expect(getByText('Bis zum Recap versiegelt.')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(DURATION + AFTERGLOW);
  });
  await unmount();
});
