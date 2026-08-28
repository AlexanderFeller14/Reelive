import { render, screen, fireEvent } from '@testing-library/react-native';
import { Animated, StyleSheet } from 'react-native';
import * as React from 'react';
import { TabBar } from '../TabBar';
import { ThemeProvider } from '@/theme/ThemeProvider';
import * as captureLock from '@/features/camera/captureLock';
import * as cinemaStage from '@/features/camera/cinemaStage';
import * as warmup from '@/features/camera/warmup';

// The navigator hands the bar its state, the descriptors and the pager's live
// position. Only what the bar actually reads is rebuilt here: a real
// navigator would drag the pager, the scene layout and the safe area into a
// test that asks about labels, taps and colours.
const ROUTE_NAMES = ['capture', 'trip', 'recap', 'profile'];

function routes() {
  return ROUTE_NAMES.map((name) => ({ key: `${name}-key`, name }));
}

// The mocks stay visible in the type (jest.Mock instead of the plain
// signature), so the assertions below can ask them what they were called with.
type BarProps = React.ComponentProps<typeof TabBar> & {
  navigation: { emit: jest.Mock };
  jumpTo: jest.Mock;
};

function barProps(overrides: Partial<BarProps> = {}): BarProps {
  return {
    state: { index: 0, routes: routes() },
    navigation: { emit: jest.fn(() => ({ defaultPrevented: false })) },
    position: new Animated.Value(0),
    jumpTo: jest.fn(),
    segments: ['(tabs)', 'capture'],
    ...overrides,
  };
}

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

beforeEach(() => {
  captureLock.lock(false);
  cinemaStage.set(false);
  warmup.set(false);
});

test('it shows all four tabs with their german labels', async () => {
  await wrap(<TabBar {...barProps()} />);
  for (const label of ['Aufnehmen', 'Reise', 'Recap', 'Profil']) {
    expect(screen.getByText(label)).toBeTruthy();
  }
});

test('a tap jumps to that tab', async () => {
  const props = barProps();
  await wrap(<TabBar {...props} />);
  fireEvent.press(screen.getByText('Recap'));
  expect(props.jumpTo).toHaveBeenCalledWith('recap-key');
});

// During a running capture (photo cycle or video) a tab switch would fire the
// focus cleanup right into the live session and navigate away from a capture
// on its way to the preview. The gesture is blocked through `swipeEnabled`
// up in the layout, the tap needs its own guard here.
test('during a running capture a tap runs into nothing', async () => {
  const props = barProps();
  await wrap(<TabBar {...props} />);
  captureLock.lock(true);
  fireEvent.press(screen.getByText('Recap'));
  expect(props.jumpTo).not.toHaveBeenCalled();
});

test('without a running capture the tap switches as it always did', async () => {
  const props = barProps();
  await wrap(<TabBar {...props} />);
  fireEvent.press(screen.getByText('Reise'));
  expect(props.jumpTo).toHaveBeenCalledWith('trip-key');
});

test('a tap that a listener prevents jumps nowhere', async () => {
  const props = barProps({ navigation: { emit: jest.fn(() => ({ defaultPrevented: true })) } });
  await wrap(<TabBar {...props} />);
  fireEvent.press(screen.getByText('Recap'));
  expect(props.jumpTo).not.toHaveBeenCalled();
});

// Spec 8.2: the recap player is full screen, with no bar underneath it.
test('on the player route the bar disappears entirely', async () => {
  await wrap(<TabBar {...barProps({ segments: ['(tabs)', 'recap', '[id]', 'player'] })} />);
  expect(screen.queryByText('Recap')).toBeNull();
});

// DESIGN-LANGUAGE §1: over the camera image the bar lies as a translucent
// surface ON the picture instead of taking height away from it, so viewfinder
// and preview show the same area (device finding 2026-08-18).
test('over the viewfinder the bar becomes the translucent cinema one', async () => {
  cinemaStage.set(true);
  await wrap(<TabBar {...barProps()} />);
  expect(screen.getByTestId('tab-bar-cinema')).toBeTruthy();
});

test('without the viewfinder there is no translucent surface', async () => {
  await wrap(<TabBar {...barProps()} />);
  expect(screen.queryByTestId('tab-bar-cinema')).toBeNull();
});

// The bar lies over the pager in EVERY shape, not only over the viewfinder:
// its shape follows the COMMITTED tab, and a plain bar that took layout
// height made every scene a bar height shorter until a swipe settled. The
// dragged-in camera scene then stood visibly too high and dropped into place
// at the end of the gesture (device finding 2026-08-28, "der Sucher ist beim
// Swipen höher"). The scenes keep their distance through scene padding
// instead (barShape.paddedScene).
test('the plain bar lies over the scenes instead of taking their height', async () => {
  await wrap(<TabBar {...barProps({ state: { index: 1, routes: routes() }, segments: ['(tabs)', 'trip'] })} />);
  const style = StyleSheet.flatten(screen.getByTestId('tab-bar').props.style);
  expect(style.position).toBe('absolute');
  expect(style.bottom).toBe(0);
});

test('the cinema bar stays the overlay it always was', async () => {
  cinemaStage.set(true);
  await wrap(<TabBar {...barProps()} />);
  const style = StyleSheet.flatten(screen.getByTestId('tab-bar').props.style);
  expect(style.position).toBe('absolute');
  expect(style.bottom).toBe(0);
});

test('on another chosen tab the viewfinder flag changes nothing', async () => {
  cinemaStage.set(true);
  await wrap(
    <TabBar {...barProps({ state: { index: 1, routes: routes() }, segments: ['(tabs)', 'trip'] })} />
  );
  expect(screen.queryByTestId('tab-bar-cinema')).toBeNull();
});

// The session needs a moment to build up, so it starts WITH the gesture
// rather than when it ends: otherwise the whole swipe drags a black surface
// into view (features/camera/warmup.ts).
test('the pager position drives the camera warm-up', async () => {
  const position = new Animated.Value(1);
  await wrap(
    <TabBar
      {...barProps({ position, state: { index: 1, routes: routes() }, segments: ['(tabs)', 'trip'] })}
    />
  );
  expect(warmup.get()).toBe(false);

  // The finger drags from the trip tab (1) towards the camera (0).
  position.setValue(0.85);
  expect(warmup.get()).toBe(true);

  // Turning back: the flag lets go only near the end of the way, so a swipe
  // taken back halfway never kills a session that is already running.
  position.setValue(0.95);
  expect(warmup.get()).toBe(false);
});

test('leaving the bar takes the warm-up back', async () => {
  const position = new Animated.Value(1);
  const view = await wrap(
    <TabBar
      {...barProps({ position, state: { index: 1, routes: routes() }, segments: ['(tabs)', 'trip'] })}
    />
  );
  position.setValue(0.5);
  expect(warmup.get()).toBe(true);
  await view.unmount();
  expect(warmup.get()).toBe(false);
});
