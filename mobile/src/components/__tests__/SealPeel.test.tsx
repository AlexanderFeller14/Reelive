import { act, fireEvent, render } from '@testing-library/react-native';
import * as React from 'react';
import { SealPeel, peelCanvas } from '../SealPeel';
import {
  PEELED_AT_MS, DURATION_MS, GRID_RESOLUTION, STAGE, DISSOLVE_SPAN, dissolveEdge,
  FLIGHT_ROOM,
} from '@/features/recap/sealPeel';

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

test('stands as a «Siegel abziehen» button and draws the mesh, nothing else', async () => {
  const size = 300;
  const { getByRole, getByTestId, queryByTestId } = await render(
    <SealPeel size={size} onPeeled={() => {}} testID="seal" />
  );
  expect(getByRole('button', { name: 'Siegel abziehen' })).toBeTruthy();

  // The canvas reaches out of the component, up and to the left, exactly by
  // the room the flight needs.
  const canvas = peelCanvas(size);
  expect(getByTestId('seal-stage').props.style).toEqual({
    position: 'absolute',
    left: -canvas.stageLeft,
    top: -canvas.stageTop,
    width: canvas.width,
    height: canvas.height,
  });
  // The touch target stays the STAGE: the flight room lies over the card, and
  // a tap up there belongs to the card, not to the seal.
  expect(getByRole('button', { name: 'Siegel abziehen' }).props.style)
    .toEqual({ width: size, height: size });

  // Only the seal is on this stage. The prototype's floor shadow is gone: on
  // the letter's dark card it read as a dirty rim, not as a shadow.
  expect(queryByTestId('skia-oval')).toBeNull();
  expect(queryByTestId('skia-blur-mask')).toBeNull();

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

// Jest cannot see the animation, but it can see whether the dissolve is wired
// up at all: without this the seal would simply stand there whole and every
// test above would still pass.
test('the seal is dissolved by a gradient blended over it, not by a mask', async () => {
  const { getByTestId, queryByTestId, getAllByTestId } = await render(
    <SealPeel size={300} onPeeled={() => {}} />
  );

  // No mask: a mask lays a rectangle over the stage and relies on a blend
  // chain to take it away again, and a stray edge of it was visible on the
  // device. `dstIn` paints no colour of its own.
  expect(queryByTestId('skia-mask')).toBeNull();
  const rect = getByTestId('skia-rect');
  expect(rect.props.blendMode).toBe('dstIn');

  // It has to cover the whole flight room: dstIn only touches the pixels it
  // actually covers, so anything outside would stay fully opaque.
  expect(rect.props.x).toBe(-FLIGHT_ROOM.left);
  expect(rect.props.y).toBe(-FLIGHT_ROOM.top);
  expect(rect.props.width).toBe(STAGE + FLIGHT_ROOM.left);
  expect(rect.props.height).toBe(STAGE + FLIGHT_ROOM.top);

  // The gradient's two points come straight from the physics, so direction
  // and timing live in one place only.
  const gradient = getByTestId('skia-linear-gradient');
  expect(gradient.props.start.value).toEqual(dissolveEdge(0).start);
  expect(gradient.props.end.value).toEqual(dissolveEdge(0).end);
  // White with and without alpha, not `transparent`, which is black at zero
  // alpha and can bleed dark through the interpolation.
  expect(gradient.props.colors).toEqual(['#FFFFFF00', '#FFFFFFFF']);

  // The blend needs its own layer, otherwise it would reach past the seal.
  // Skia's Group takes no testID, so it is found by kind: the outer group
  // places the stage in the canvas, the inner one carries the layer.
  const groups = getAllByTestId('skia-group');
  expect(groups).toHaveLength(2);
  expect(groups[1].props.layer).toBe(true);

  // The peel plays for roughly a second before any of this starts; the exact
  // point lives in the physics module and is asserted there.
  expect(DISSOLVE_SPAN.from * DURATION_MS).toBeGreaterThan(800);
});

// Two moments matter to the letter around it, not one: the seal COMES OFF
// long before the last of it has dissolved, and the show may start behind it
// right then (Alex, 27.08.: "der übergang zum tag 1 sollte früher kommen noch
// während des abziehens").
test('the seal reports lifting off before it reports being gone', async () => {
  const onLiftOff = jest.fn();
  const onPeeled = jest.fn();
  const { getByRole } = await render(
    <SealPeel size={300} onLiftOff={onLiftOff} onPeeled={onPeeled} />
  );

  await act(async () => {
    fireEvent.press(getByRole('button', { name: 'Siegel abziehen' }));
  });
  expect(onLiftOff).not.toHaveBeenCalled();

  const liftOff = Math.round(DURATION_MS * DISSOLVE_SPAN.from);
  await act(async () => {
    jest.advanceTimersByTime(liftOff - 1);
  });
  expect(onLiftOff).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onLiftOff).toHaveBeenCalledTimes(1);
  // The seal itself is still there, breaking up.
  expect(onPeeled).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(PEELED_AT_MS - liftOff);
  });
  expect(onPeeled).toHaveBeenCalledTimes(1);
  expect(onLiftOff).toHaveBeenCalledTimes(1);
});

test('reduced motion: lift-off and gone collapse into the one short fade', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  const onLiftOff = jest.fn();
  const onPeeled = jest.fn();
  const { getByRole } = await render(
    <SealPeel size={300} onLiftOff={onLiftOff} onPeeled={onPeeled} />
  );

  await act(async () => {
    fireEvent.press(getByRole('button', { name: 'Siegel abziehen' }));
  });
  // Nothing is being watched here, so the show may start at once: the
  // callback rides the same timer as the full peel's, only with no delay.
  await act(async () => {
    jest.advanceTimersByTime(0);
  });
  expect(onLiftOff).toHaveBeenCalledTimes(1);
  expect(onPeeled).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(200);
  });
  expect(onPeeled).toHaveBeenCalledTimes(1);
});

test('an unmount before lift-off: neither callback arrives', async () => {
  const onLiftOff = jest.fn();
  const onPeeled = jest.fn();
  const { getByRole, unmount } = await render(
    <SealPeel size={300} onLiftOff={onLiftOff} onPeeled={onPeeled} />
  );
  await act(async () => {
    fireEvent.press(getByRole('button', { name: 'Siegel abziehen' }));
  });
  await unmount();
  await act(async () => {
    jest.advanceTimersByTime(DURATION_MS);
  });
  expect(onLiftOff).not.toHaveBeenCalled();
  expect(onPeeled).not.toHaveBeenCalled();
});
