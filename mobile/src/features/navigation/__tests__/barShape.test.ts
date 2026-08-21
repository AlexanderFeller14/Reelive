import { barShape, swipeAllowed } from '../barShape';

// These assertions used to live in app/(tabs)/__tests__/_layout.test.tsx and
// had to render the navigator to reach a nested ternary inside
// `screenOptions`. They survived the move to the swipeable navigator as what
// they always were: questions about a route, answered by a plain function.
describe('barShape', () => {
  test('on the player route the bar is gone (spec 8.2: full screen)', () => {
    expect(barShape(['(tabs)', 'recap', '[id]', 'player'], 'recap', false)).toBe('hidden');
  });

  test('another route in the same tab keeps its bar', () => {
    expect(barShape(['(tabs)', 'recap', '[id]', 'overview'], 'recap', false)).toBe('plain');
  });

  // Phase 7, task 11: the map explicitly does NOT get the player's exception.
  // Spec 5.3 places it next to the player as a "Werkzeug zum Finden", not as
  // a full-screen media screen, and map.tsx puts its bottom bar at
  // `bottom: spacing.screen`, a value that assumes the tab bar is standing.
  // Whoever reverses this has to take the map's bottom edge along.
  test('the map keeps its bar, it is a tool, not a full-screen media screen', () => {
    expect(barShape(['(tabs)', 'recap', '[id]', 'map'], 'recap', false)).toBe('plain');
  });

  // Mutation guard: a comparison that is too generous (only segments[1] ===
  // 'recap') would hide every route in the tab; one that is too narrow (only
  // the last segment) would hide a 'player' elsewhere.
  test('a "player" segment outside recap/[id]/ does not hide anything', () => {
    expect(barShape(['(tabs)', 'capture', 'player'], 'capture', false)).toBe('plain');
  });

  test('with the viewfinder up the capture tab wears the cinema bar', () => {
    expect(barShape(['(tabs)', 'capture'], 'capture', true)).toBe('cinema');
  });

  test('without the viewfinder the capture tab wears the plain bar', () => {
    expect(barShape(['(tabs)', 'capture'], 'capture', false)).toBe('plain');
  });

  test('the cinema bar survives the preview covering the tab', () => {
    // The preview lives NEXT to the tabs (app/preview.tsx), so the segments
    // leave the navigator entirely. The shape hangs off the CHOSEN tab, not
    // off focus, otherwise the bar drops into its light shape invisibly and
    // jumps on the first frame of the instant way back (device finding
    // 2026-08-18).
    expect(barShape(['preview'], 'capture', true)).toBe('cinema');
  });

  test('on another chosen tab the viewfinder flag changes nothing', () => {
    expect(barShape(['(tabs)', 'trip'], 'trip', true)).toBe('plain');
  });

  test('the player beats the cinema bar', () => {
    expect(barShape(['(tabs)', 'recap', '[id]', 'player'], 'recap', true)).toBe('hidden');
  });
});

describe('swipeAllowed', () => {
  test('on the root screen of a tab you may swipe', () => {
    expect(swipeAllowed(['(tabs)', 'trip'])).toBe(true);
    expect(swipeAllowed(['(tabs)', 'capture'])).toBe(true);
    expect(swipeAllowed(['(tabs)', 'recap'])).toBe(true);
    expect(swipeAllowed(['(tabs)', 'profile'])).toBe(true);
  });

  test('inside a nested stack you may not: the back swipe owns that gesture', () => {
    expect(swipeAllowed(['(tabs)', 'trip', '[id]'])).toBe(false);
    expect(swipeAllowed(['(tabs)', 'trip', '[id]', 'invite'])).toBe(false);
    expect(swipeAllowed(['(tabs)', 'recap', '[id]', 'overview'])).toBe(false);
    expect(swipeAllowed(['(tabs)', 'recap', '[id]', 'player'])).toBe(false);
  });

  test('while a screen outside the tabs covers them, nobody swipes', () => {
    expect(swipeAllowed(['preview'])).toBe(false);
    expect(swipeAllowed(['(auth)', 'sign-in'])).toBe(false);
    expect(swipeAllowed([])).toBe(false);
  });
});
