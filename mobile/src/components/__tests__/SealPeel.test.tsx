import { act, fireEvent, render } from '@testing-library/react-native';
import * as React from 'react';
import { SealPeel } from '../SealPeel';
import { PEELED_AT_MS, DURATION_MS, GRID_RESOLUTION } from '@/features/recap/sealPeel';

// Skia is mocked globally in jest.setup.ts (native drawing backend, the same
// blind spot as react-native-maps). Reanimated drives progress on the UI
// thread; in the test only the mechanics matter (tap, timer, haptic, a11y),
// so the same hand-written mock as in MomentSubmissionAnimation.test.tsx
// (the official mock pulls in the native worklets module and crashes under
// Jest).
jest.mock('react-native-reanimated', () => {
  const ReactActual = require('react');
  return {
    __esModule: true,
    useSharedValue: (initial: unknown) => ReactActual.useRef({ value: initial }).current,
    useDerivedValue: (factory: () => unknown) => ReactActual.useRef({ value: factory() }).current,
    withTiming: (target: unknown) => target,
    cancelAnimation: () => {},
    Easing: { bezier: () => ({}), linear: () => 0 },
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

jest.useFakeTimers();

beforeEach(() => {
  jest.clearAllMocks();
  mockUseReducedMotion.mockReturnValue(false);
});

test('stands as a «Siegel abziehen» button and draws the shadow and mesh at stage size', async () => {
  const { getByRole, getByTestId } = await render(
    <SealPeel size={300} onPeeled={() => {}} testID="seal" />
  );
  expect(getByRole('button', { name: 'Siegel abziehen' })).toBeTruthy();
  expect(getByTestId('seal-stage').props.style).toEqual({ width: 300, height: 300 });
  // The shadow sits there as an ellipse, the mesh carries two triangles per
  // cell and a texture coordinate for every node.
  expect(getByTestId('skia-oval')).toBeTruthy();
  const mesh = getByTestId('skia-vertices');
  expect(mesh.props.indices).toHaveLength(GRID_RESOLUTION * GRID_RESOLUTION * 6);
  expect(mesh.props.textures).toHaveLength((GRID_RESOLUTION + 1) * (GRID_RESOLUTION + 1));
  expect(mesh.props.vertices.value).toHaveLength((GRID_RESOLUTION + 1) * (GRID_RESOLUTION + 1));
});

test('a tap triggers the success haptic exactly once and reports onPeeled only once the stage is empty', async () => {
  const onPeeled = jest.fn();
  const { getByRole } = await render(<SealPeel size={300} onPeeled={onPeeled} />);
  const button = getByRole('button', { name: 'Siegel abziehen' });

  await act(async () => {
    fireEvent.press(button);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockNotificationAsync).toHaveBeenCalledWith('success');
  expect(onPeeled).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(PEELED_AT_MS - 1);
  });
  expect(onPeeled).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onPeeled).toHaveBeenCalledTimes(1);

  // Nothing follows after that, not even at the end of the full duration.
  await act(async () => {
    jest.advanceTimersByTime(DURATION_MS);
  });
  expect(onPeeled).toHaveBeenCalledTimes(1);
});

test('while peeling is running the button is locked: a second tap does nothing', async () => {
  const onPeeled = jest.fn();
  const { getByRole } = await render(<SealPeel size={300} onPeeled={onPeeled} />);
  const button = getByRole('button', { name: 'Siegel abziehen' });

  await act(async () => {
    fireEvent.press(button);
  });
  expect(button.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  await act(async () => {
    fireEvent.press(button);
    jest.advanceTimersByTime(500);
    fireEvent.press(button);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);

  await act(async () => {
    jest.advanceTimersByTime(DURATION_MS);
  });
  expect(onPeeled).toHaveBeenCalledTimes(1);
});

test('reduced motion: no peel, a 200 ms fade, then onPeeled', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  const onPeeled = jest.fn();
  const { getByRole } = await render(<SealPeel size={300} onPeeled={onPeeled} />);

  await act(async () => {
    fireEvent.press(getByRole('button', { name: 'Siegel abziehen' }));
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(199);
  });
  expect(onPeeled).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onPeeled).toHaveBeenCalledTimes(1);
});

test('an unmount during the peel: onPeeled no longer arrives', async () => {
  const onPeeled = jest.fn();
  const { getByRole, unmount } = await render(<SealPeel size={300} onPeeled={onPeeled} />);
  await act(async () => {
    fireEvent.press(getByRole('button', { name: 'Siegel abziehen' }));
  });
  await unmount();
  await act(async () => {
    jest.advanceTimersByTime(DURATION_MS);
  });
  expect(onPeeled).not.toHaveBeenCalled();
});
