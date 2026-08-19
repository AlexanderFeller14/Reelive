import { Animated, Easing, StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { ProgressBar } from '../ProgressBar';

// jest-expo mocks the native Animated module, Animated.timing still runs as a
// real function, we only spy on its calls. That lets us prove THAT and WITH
// WHAT it was called, without letting the internal animation itself run (no
// `jest.useFakeTimers()` needed, unlike in ShutterButton.test.tsx, which
// checks via callbacks instead of call parameters).
let timingSpy: jest.SpiedFunction<typeof Animated.timing>;

beforeEach(() => {
  timingSpy = jest.spyOn(Animated, 'timing');
});

afterEach(() => {
  timingSpy.mockRestore();
});

test('renders exactly one segment per moment (count)', async () => {
  await render(<ProgressBar count={7} activeIndex={0} durationMs={5000} elapsedMs={0} paused={false} />);
  expect(screen.getAllByTestId(/^fortschritt-segment-/)).toHaveLength(7);
});

test('segments before the active index are full, the active one carries the animation, none after it', async () => {
  await render(<ProgressBar count={5} activeIndex={2} durationMs={5000} elapsedMs={0} paused={false} />);
  // Exactly segments 0 and 1 are "full", not 2 (that's "active"), not 3/4
  // (not their turn yet). A mutant that replaces `<` with `<=` would
  // wrongly mark segment 2 as "full" too.
  expect(screen.getByTestId('fortschritt-voll-0')).toBeTruthy();
  expect(screen.getByTestId('fortschritt-voll-1')).toBeTruthy();
  expect(screen.queryByTestId('fortschritt-voll-2')).toBeNull();
  expect(screen.queryByTestId('fortschritt-voll-3')).toBeNull();
  expect(screen.queryByTestId('fortschritt-voll-4')).toBeNull();
  expect(screen.getByTestId('fortschritt-aktiv')).toBeTruthy();
});

test('at the very first moment (index 0) no segment is "full"', async () => {
  await render(<ProgressBar count={3} activeIndex={0} durationMs={5000} elapsedMs={0} paused={false} />);
  expect(screen.queryByTestId(/^fortschritt-voll-/)).toBeNull();
  expect(screen.getByTestId('fortschritt-aktiv')).toBeTruthy();
});

test('animates the active segment with Easing.linear (DESIGN-LANGUAGE §5, the allowed exception)', async () => {
  await render(<ProgressBar count={3} activeIndex={1} durationMs={5000} elapsedMs={0} paused={false} />);
  expect(timingSpy).toHaveBeenCalledTimes(1);
  const [, config] = timingSpy.mock.calls[0];
  expect(config.easing).toBe(Easing.linear);
  expect(config.toValue).toBe(1);
  expect(config.useNativeDriver).toBe(true);
});

test("the animation's remaining duration is durationMs minus elapsedMs, not the full duration", async () => {
  await render(<ProgressBar count={2} activeIndex={0} durationMs={5000} elapsedMs={2000} paused={false} />);
  expect(timingSpy).toHaveBeenCalledTimes(1);
  const [, config] = timingSpy.mock.calls[0];
  expect(config.duration).toBe(3000);
});

test("paused: the animation doesn't start (the bar stays at the frozen state)", async () => {
  await render(<ProgressBar count={2} activeIndex={0} durationMs={5000} elapsedMs={2000} paused />);
  expect(timingSpy).not.toHaveBeenCalled();
});

test('already fully elapsed (elapsedMs >= durationMs): no animation needed anymore', async () => {
  await render(<ProgressBar count={2} activeIndex={0} durationMs={5000} elapsedMs={5000} paused={false} />);
  expect(timingSpy).not.toHaveBeenCalled();
});

test('a durationMs of 0 (defensive case) neither throws nor animates', async () => {
  await expect(
    render(<ProgressBar count={1} activeIndex={0} durationMs={0} elapsedMs={0} paused={false} />)
  ).resolves.toBeTruthy();
  expect(timingSpy).not.toHaveBeenCalled();
});

test('a change of the active index starts a new animation for the new segment', async () => {
  const { rerender } = await render(
    <ProgressBar count={3} activeIndex={0} durationMs={5000} elapsedMs={0} paused={false} />
  );
  expect(timingSpy).toHaveBeenCalledTimes(1);
  await rerender(<ProgressBar count={3} activeIndex={1} durationMs={5000} elapsedMs={0} paused={false} />);
  expect(timingSpy).toHaveBeenCalledTimes(2);
  // After the switch, segment 0 is "full", no longer active.
  expect(screen.getByTestId('fortschritt-voll-0')).toBeTruthy();
});

// M8 (review finding): neither the animation's starting value nor the fill
// direction had a test of its own, both could be deleted without breaking
// anything.
test("sets the animation's starting value to the correct share (elapsedMs/durationMs) before it starts", async () => {
  const setValueSpy = jest.spyOn(Animated.Value.prototype, 'setValue');
  await render(<ProgressBar count={2} activeIndex={0} durationMs={4000} elapsedMs={1000} paused={false} />);
  expect(setValueSpy).toHaveBeenCalledWith(0.25);
  setValueSpy.mockRestore();
});

test('a starting share outside [0,1] (defensive case) gets clamped', async () => {
  const setValueSpy = jest.spyOn(Animated.Value.prototype, 'setValue');
  await render(<ProgressBar count={2} activeIndex={0} durationMs={1000} elapsedMs={5000} paused={false} />);
  expect(setValueSpy).toHaveBeenCalledWith(1);
  setValueSpy.mockRestore();
});

test('the active segment fills from the left (transformOrigin: left), not centered or from the right', async () => {
  await render(<ProgressBar count={2} activeIndex={0} durationMs={4000} elapsedMs={0} paused={false} />);
  const style = StyleSheet.flatten(screen.getByTestId('fortschritt-aktiv').props.style);
  expect(style.transformOrigin).toBe('left');
});
