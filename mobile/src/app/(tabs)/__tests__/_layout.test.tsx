import { render } from '@testing-library/react-native';
import * as React from 'react';
import * as captureLock from '@/features/camera/captureLock';

// TopTabs is mocked completely: the goal here is solely WHICH options the
// layout hands the navigator. A real render would drag the pager, the scene
// layout and the safe area in, and would only add noise to assertions about
// a boolean. What the bar itself does with those routes is checked in
// features/navigation/__tests__/TabBar.test.tsx, and which route wears which
// shape in barShape.test.ts.
let lastProps: Record<string, unknown> | undefined;
const mockUseSegments = jest.fn(() => ['(tabs)', 'capture'] as string[]);

jest.mock('expo-router/js-top-tabs', () => {
  function TopTabs(props: Record<string, unknown>) {
    lastProps = props;
    return null;
  }
  TopTabs.Screen = () => null;
  return { __esModule: true, TopTabs, default: TopTabs };
});

jest.mock('expo-router', () => ({ useSegments: () => mockUseSegments() }));

import TabsLayout from '../_layout';

type Options = { swipeEnabled?: boolean; lazy?: boolean; sceneStyle?: { backgroundColor?: string } };

// The options are resolved for both shapes, object and function: the
// navigator accepts either, and the tests stay independent of which one is
// in use.
function optionsFor(routeName: string): Options {
  const screenOptions = lastProps?.screenOptions;
  if (typeof screenOptions === 'function') {
    return (screenOptions as (ctx: { route: { name: string } }) => Options)({
      route: { name: routeName },
    });
  }
  return (screenOptions ?? {}) as Options;
}

beforeEach(() => {
  lastProps = undefined;
  mockUseSegments.mockReturnValue(['(tabs)', 'capture']);
  captureLock.lock(false);
});

test('the bar sits at the bottom, where it always sat', async () => {
  await render(<TabsLayout />);
  expect(lastProps?.tabBarPosition).toBe('bottom');
});

test('the navigator renders our own bar, not the material one', async () => {
  await render(<TabsLayout />);
  expect(typeof lastProps?.tabBar).toBe('function');
});

test('the four tabs keep their order: camera, trip, recap, profile', async () => {
  await render(<TabsLayout />);
  const names = React.Children.toArray(lastProps?.children as React.ReactNode).map(
    (child) => (child as React.ReactElement<{ name: string }>).props.name
  );
  expect(names).toEqual(['capture', 'trip', 'recap', 'profile']);
});

test('on a root screen the tabs may be swiped', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'trip']);
  await render(<TabsLayout />);
  expect(optionsFor('trip').swipeEnabled).toBe(true);
});

// One level deeper the iOS back swipe owns the same movement. Two gestures
// fighting over one finger is what makes navigation feel broken.
test('inside a nested stack swiping is off', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'trip', '[id]']);
  await render(<TabsLayout />);
  expect(optionsFor('trip').swipeEnabled).toBe(false);
});

test('on the player route swiping is off', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'recap', '[id]', 'player']);
  await render(<TabsLayout />);
  expect(optionsFor('recap').swipeEnabled).toBe(false);
});

// The counterpart to the tap guard in the bar: a swipe during a running
// capture would fire the focus cleanup into the live session.
test('during a running capture swiping is off', async () => {
  captureLock.lock(true);
  mockUseSegments.mockReturnValue(['(tabs)', 'capture']);
  await render(<TabsLayout />);
  expect(optionsFor('capture').swipeEnabled).toBe(false);
});

// Every screen stays mounted, so the neighbour is already there while the
// finger drags instead of appearing empty. The screens hang their loading on
// useFocusEffect, which still fires for the focused one only.
test('the screens stay mounted, so the neighbour is there while dragging', async () => {
  await render(<TabsLayout />);
  expect(optionsFor('trip').lazy).not.toBe(true);
});
