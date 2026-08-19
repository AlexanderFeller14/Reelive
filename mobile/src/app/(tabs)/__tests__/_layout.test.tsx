import { render } from '@testing-library/react-native';
import * as React from 'react';

// Final review phase 5, point 5 (minor): the segment comparison that switches
// the tab bar off on the player route was the only assertion on that branch
// without a (mutation) test of its own. `Tabs` (expo-router) is mocked
// completely here, the goal is solely which `tabBarStyle` `TabsLayout` hands
// to `screenOptions`. A real rendering of the tab navigator would need
// @react-navigation internals (bottom tabs renderer, icon layout, safe area)
// and would only add noise here without sharpening the actual assertion
// (which `display` value for which route).
let lastScreenOptions: unknown;
let lastScreenListeners: { tabPress?: (e: { preventDefault: () => void }) => void } | undefined;
const mockUseSegments = jest.fn(() => ['(tabs)'] as string[]);
jest.mock('expo-router', () => {
  function Tabs(props: { screenOptions: unknown; screenListeners?: unknown; children: React.ReactNode }) {
    lastScreenOptions = props.screenOptions;
    lastScreenListeners = props.screenListeners as typeof lastScreenListeners;
    return null;
  }
  Tabs.Screen = () => null;
  return {
    Tabs,
    useSegments: () => mockUseSegments(),
  };
});

// Ever since the cinema bar hangs off the CHOSEN tab, the screenOptions are a
// function of the route (the renderer takes the options of the focused tab).
// This helper resolves both shapes, object and function, and keeps the tests
// independent of which one is in use.
type ResolvedOptions = {
  tabBarStyle?: { display?: string; position?: string; backgroundColor?: string; borderTopWidth?: number };
  tabBarBackground?: unknown;
};
function optionsFor(routeName: string): ResolvedOptions | undefined {
  if (typeof lastScreenOptions === 'function') {
    return (lastScreenOptions as (ctx: { route: { name: string } }) => ResolvedOptions)({
      route: { name: routeName },
    });
  }
  return lastScreenOptions as ResolvedOptions | undefined;
}

import TabsLayout from '../_layout';
import * as captureLock from '@/features/camera/captureLock';
import * as cinemaStage from '@/features/camera/cinemaStage';

beforeEach(() => {
  lastScreenOptions = undefined;
  lastScreenListeners = undefined;
  mockUseSegments.mockReturnValue(['(tabs)']);
  captureLock.lock(false);
  cinemaStage.set(false);
});

test('on any route that is not the player, the tab bar stays visible', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'recap']);
  await render(<TabsLayout />);
  expect(optionsFor('recap')?.tabBarStyle?.display).not.toBe('none');
});

// The actual final review finding: per spec §8.2 the recap player is
// "Vollbild", with no tab bar underneath it.
test('on the player route (recap/[id]/player) the tab bar is switched off', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'recap', '[id]', 'player']);
  await render(<TabsLayout />);
  expect(optionsFor('recap')?.tabBarStyle?.display).toBe('none');
});

// Mutation guard: a comparison that is too generous (only segments[1] ===
// 'recap', say, without checking the deeper segments) would hide EVERY route
// inside the recap tab, not just the player. This test demands that another,
// frequently visited screen in the same tab (the day overview) keeps its bar.
test('another route in the same tab (recap/[id]/overview) keeps the tab bar', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'recap', '[id]', 'overview']);
  await render(<TabsLayout />);
  expect(optionsFor('recap')?.tabBarStyle?.display).not.toBe('none');
});

// Task 11 (phase 7): the map explicitly does NOT get the player's exception.
// Spec §5.3 "Die Karte füllt den Screen" means the missing header of its own
// ("Darüber liegen genau drei Dinge"), not the navigation of the app; the
// same paragraph places the map expressly next to the player: "Der Screen ist
// hell, nicht Kino: er zeigt keine Medien im Vollbild, sondern ist ein
// Werkzeug zum Finden." And spec §5.1 calls it "eine Sicht auf DIESEN Recap,
// kein eigener Bereich der App", exactly what the standing tab bar shows.
//
// The concrete part: map.tsx puts its bottom bar ("N Momente ohne Ort") at
// `bottom: spacing.screen` and justifies that value there by saying the tab
// bar is NOT part of that surface, the screen ends above it. So the pill's
// clearance from the home indicator comes from the tab bar standing. A
// `useBottomInset` does exist in the project today (src/theme/useTopInset.ts,
// used by the player and DateRangeField), so turning this decision around
// stays possible, but it is not free: map.tsx would have to switch its bottom
// edge over to it in the same move.
//
// This test pins the decision down instead of leaving it unsaid: whoever
// reverses it has to come past here and take the map's bottom edge along.
test('the map (recap/[id]/map) keeps the tab bar, it is no full-screen media screen', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'recap', '[id]', 'map']);
  await render(<TabsLayout />);
  expect(optionsFor('recap')?.tabBarStyle?.display).not.toBe('none');
});

// The counter-check in the other direction: a "player" segment outside
// recap/[id]/ (if a segment of the same name happened to sit in another tab)
// must NOT switch the tab bar off, the comparison checks all three segments
// together, not just the last one.
test('a "player" segment outside recap/[id]/ does NOT switch the tab bar off', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'capture', 'player']);
  await render(<TabsLayout />);
  expect(optionsFor('capture')?.tabBarStyle?.display).not.toBe('none');
});

// The camera screen keeps its bar: it is the tab from which one switches to
// the others.
//
// The capture preview deliberately needs NO exception here, even though it is
// a full-screen media screen too. It no longer lives inside the tab navigator
// but next to it (app/preview.tsx). An exception at this spot only takes
// effect once the navigator rerenders after the route change, and the bar
// therefore stayed visible after the shutter while the preview was already
// there. The reasoning behind the move is in guard.ts at isAreaForSignedIn().
test('the camera screen (capture) keeps the tab bar', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'capture']);
  await render(<TabsLayout />);
  expect(optionsFor('capture')?.tabBarStyle?.display).not.toBe('none');
});

// === Cinema bar over the viewfinder (device finding 2026-08-18) ===
// Viewfinder and preview both draw with `cover`, but into surfaces of
// different heights: the preview (full screen) showed about 10 % less image
// width than the viewfinder (full screen minus bar), "more cropped than
// before I hit the shutter". While the camera screen shows the viewfinder
// (cinemaStage), the bar therefore lies AS a translucent surface OVER the
// camera image (position absolute) instead of taking space away from it:
// both surfaces are then equally large, what you see is what you get.
test('with the viewfinder up (cinemaStage), the bar lies translucent over the image', async () => {
  cinemaStage.set(true);
  mockUseSegments.mockReturnValue(['(tabs)', 'capture']);
  await render(<TabsLayout />);
  const options = optionsFor('capture');
  expect(options?.tabBarStyle?.position).toBe('absolute');
  expect(options?.tabBarStyle?.backgroundColor).toBe('transparent');
  expect(options?.tabBarStyle?.borderTopWidth).toBe(0);
  // The tint and blur arrive as a background of their own (pill recipe, §1).
  expect(options?.tabBarBackground).toBeDefined();
});

test('without the viewfinder (the bright states of the tab) the bar stays the normal bright one', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'capture']);
  await render(<TabsLayout />);
  const options = optionsFor('capture');
  expect(options?.tabBarStyle?.position).not.toBe('absolute');
  expect(options?.tabBarBackground).toBeUndefined();
});

// The instant way back out of the preview (user decision 2026-08-18): the
// preview covers the tab, and its blur cleanup used to withdraw the
// viewfinder flag earlier, so the bar fell invisibly into the bright shape
// and visibly jumped on the first frame when coming back. The cinema shape
// therefore hangs off the CHOSEN tab (route.name), not off focus: as long as
// capture is the chosen tab it stays put, preview on top of it or not.
test('with the viewfinder flag up the cinema bar stays as long as capture is the chosen tab', async () => {
  cinemaStage.set(true);
  // Focus lies on the preview (root stack), not inside the tab navigator.
  mockUseSegments.mockReturnValue(['preview']);
  await render(<TabsLayout />);
  expect(optionsFor('capture')?.tabBarStyle?.position).toBe('absolute');
});

test('on ANOTHER chosen tab the normal bar applies despite the viewfinder flag', async () => {
  cinemaStage.set(true);
  mockUseSegments.mockReturnValue(['(tabs)', 'trip']);
  await render(<TabsLayout />);
  const options = optionsFor('trip');
  expect(options?.tabBarStyle?.position).not.toBe('absolute');
  expect(options?.tabBarBackground).toBeUndefined();
});

// The player exception beats the cinema bar: full screen means no bar, even
// if the viewfinder flag were still up (through a message left lying around,
// for instance).
test('on the player route the bar stays switched off even with the viewfinder flag set', async () => {
  cinemaStage.set(true);
  mockUseSegments.mockReturnValue(['(tabs)', 'recap', '[id]', 'player']);
  await render(<TabsLayout />);
  expect(optionsFor('recap')?.tabBarStyle?.display).toBe('none');
});

// During a running capture (photo cycle or video, the camera screen sets the
// lock, see capture/__tests__/camera.test.tsx) a tap on a tab must NOT
// switch: the focus cleanup would otherwise fire right into the running
// session. The bar stays put (no display:'none': that would take the height
// away from the scene mid-capture and the viewfinder would jump), the tap
// simply runs into nothing via preventDefault.
test('during a running capture a tab tap runs into nothing', async () => {
  await render(<TabsLayout />);
  captureLock.lock(true);
  const event = { preventDefault: jest.fn() };
  lastScreenListeners?.tabPress?.(event);
  expect(event.preventDefault).toHaveBeenCalled();
});

// Counter-check: without the lock the tab switch is left untouched. The
// listener reads at the moment of the event (no rerender needed), so it is
// enough to flip the lock after rendering.
test('without a running capture the tab tap switches as it always did', async () => {
  await render(<TabsLayout />);
  const event = { preventDefault: jest.fn() };
  lastScreenListeners?.tabPress?.(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
});
