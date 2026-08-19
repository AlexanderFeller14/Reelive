import { render } from '@testing-library/react-native';
import * as React from 'react';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { cinema } from '@/theme/tokens';

// Found on the device (2026-08-11): tapping the recap tab opened the player
// instead of the list. As soon as a stack has <Stack.Screen> children at all,
// their order decides which route gets registered first, and the first one is
// the stack's initial route. Here `[id]/player` stood alone, so the player
// became the initial route, and it did so without an `id` in the path
// (`/recap/player`). `useLocalSearchParams` returned `undefined`, fetchTrip
// asked the database for the UUID "undefined" and got Postgres 22P02, so the
// screen showed a load error instead of the empty list.
//
// The 1316 tests of this suite did not notice, because they render every
// screen on its own and never the navigation between them. This test checks
// exactly what a screen test cannot see: the order in which the layout
// registers its routes.
//
// `Stack` is mocked completely, as in (tabs)/__tests__/_layout.test.tsx.
// Rendering it for real would need the stack navigator from @react-navigation
// and would only add noise around the actual assertion (which route comes
// first).
let lastChildren: React.ReactNode;
jest.mock('expo-router', () => {
  function Stack(props: { children?: React.ReactNode }) {
    lastChildren = props.children;
    return null;
  }
  Stack.Screen = () => null;
  return { Stack };
});

import RecapStackLayout from '../_layout';

type ScreenProps = {
  name: string;
  options?: { animation?: string; contentStyle?: { backgroundColor?: string } };
};

// The comment nodes in the layout do not count, filtered is what actually
// registers a route: an element with a `name`.
function routeElements(): React.ReactElement<ScreenProps>[] {
  return React.Children.toArray(lastChildren).filter(
    (child): child is React.ReactElement<ScreenProps> =>
      React.isValidElement(child) && typeof (child.props as { name?: unknown }).name === 'string'
  );
}

function routeNames(): string[] {
  return routeElements().map((child) => child.props.name);
}

beforeEach(() => {
  lastChildren = undefined;
});

const renderLayout = async () => {
  await render(
    <ThemeProvider>
      <RecapStackLayout />
    </ThemeProvider>
  );
};

test('the recap stack registers the list as its first route, not the player', async () => {
  await renderLayout();
  expect(routeNames()[0]).toBe('index');
});

// The actual finding, phrased as an assertion: the player must never stand
// first. Without this test a later reordering of the children falls back into
// the same bug, and unnoticed until the next device test.
test('the player does not stand first', async () => {
  await renderLayout();
  expect(routeNames()[0]).not.toBe('[id]/player');
});

// The player needs options of its own (fade through black, cinema ground,
// DESIGN-LANGUAGE §5), so it has to STAY declared. Whoever "solves" the bug
// above by simply deleting the child takes the staging away from the switch
// into the auditorium.
test('the player stays declared with options of its own', async () => {
  await renderLayout();
  expect(routeNames()).toContain('[id]/player');
});

// And WHICH options those are. The test above only proves the child is still
// there, an options object emptied by accident would pass it just as well.
// The switch from a light screen into the auditorium is the one
// DESIGN-LANGUAGE §5 wants as a fade through black, and the ground underneath
// has to be the cinema one, otherwise the fade starts on white.
test('the player fades through black onto the cinema ground', async () => {
  await renderLayout();
  const player = routeElements().find((child) => child.props.name === '[id]/player');
  expect(player?.props.options?.animation).toBe('fade');
  expect(player?.props.options?.contentStyle?.backgroundColor).toBe(cinema['bg-0']);
});
