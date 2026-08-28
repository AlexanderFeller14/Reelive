import { render, screen, fireEvent } from '@testing-library/react-native';
import { Animated, Dimensions, Easing, StyleSheet, Text } from 'react-native';
import * as React from 'react';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { cinema, motion, palette, radius, shadow, spacing } from '@/theme/tokens';
import { MAX_HEIGHT_RATIO, Sheet, swipeExceedsThreshold } from '../Sheet';

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/theme/useReducedMotion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

// The resolved translateY value of the outer (shadow) node, Animated.View
// resolves its Animated.Value props to plain numbers when rendering, so
// this is directly checkable via StyleSheet.flatten, without passing refs
// out of the component.
function translateYOf(node: ReturnType<typeof screen.getByTestId>): number | undefined {
  const flattened = StyleSheet.flatten(node.props.style) as { transform?: { translateY?: number }[] };
  return flattened.transform?.find((t) => 'translateY' in t)?.translateY;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseReducedMotion.mockReturnValue(false);
});

test('invisible renders nothing', async () => {
  await wrap(
    <Sheet visible={false} onClose={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  expect(screen.queryByTestId('sheet-backdrop')).toBeNull();
  expect(screen.queryByText('Inhalt')).toBeNull();
});

test('visible shows the title and arbitrary content', async () => {
  await wrap(
    <Sheet visible title="Kommentare" onClose={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  expect(screen.getByText('Kommentare')).toBeTruthy();
  expect(screen.getByText('Inhalt')).toBeTruthy();
});

test('without a title, the title line stays away', async () => {
  await wrap(
    <Sheet visible onClose={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  expect(screen.queryByText('Kommentare')).toBeNull();
});

test('a tap on the background calls onClose', async () => {
  const onClose = jest.fn();
  await wrap(
    <Sheet visible onClose={onClose}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  await fireEvent.press(screen.getByTestId('sheet-backdrop'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('opens with spring-ui (DESIGN-LANGUAGE §5) when motion is not reduced', async () => {
  const springSpy = jest.spyOn(Animated, 'spring');
  await wrap(
    <Sheet visible onClose={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  expect(springSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ toValue: 0, ...motion.spring })
  );
  springSpy.mockRestore();
});

test('reduced motion: no spring, just a 200 ms fade', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  const springSpy = jest.spyOn(Animated, 'spring');
  const timingSpy = jest.spyOn(Animated, 'timing');
  await wrap(
    <Sheet visible onClose={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  expect(springSpy).not.toHaveBeenCalled();
  expect(timingSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ toValue: 1, duration: 200 })
  );
  springSpy.mockRestore();
  timingSpy.mockRestore();
});

test('motion that is not reduced fades the background over 250 ms (duration-base)', async () => {
  const timingSpy = jest.spyOn(Animated, 'timing');
  await wrap(
    <Sheet visible onClose={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  expect(timingSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ toValue: 1, duration: motion.duration.base })
  );
  timingSpy.mockRestore();
});

// Review minor: both Animated.timing calls ran without `easing`, RN then
// takes its default curve instead of ease-smooth (convention, see
// Input.tsx).
test("uses ease-smooth for the time-based fades, not RN's default curve", async () => {
  const easingSpy = jest.spyOn(Easing, 'bezier');
  await wrap(
    <Sheet visible onClose={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  expect(easingSpy).toHaveBeenCalledWith(...motion.easeSmooth);
  easingSpy.mockRestore();
});

// Review Important 3 (mutation gap): setting START_POSITION to 0 went
// undetected because only spies were checked, never the actual value.
test('opens from clearly outside the visible area, not from the zero position', async () => {
  await wrap(
    <Sheet visible onClose={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  const shadowNode = screen.getByTestId('sheet-shadow');
  expect(translateYOf(shadowNode)).toBeGreaterThan(100);
});

// Review Important 3: deleting `translateY.setValue(0)` in the
// reduced-motion branch went undetected so far, the sheet would stay
// permanently below the screen for reduced-motion users, invisible.
test('reduced motion holds the position at 0, no invisible sheet', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  await wrap(
    <Sheet visible onClose={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  const shadowNode = screen.getByTestId('sheet-shadow');
  expect(translateYOf(shadowNode)).toBe(0);
});

test('unmount cleans up properly', async () => {
  const { unmount } = await wrap(
    <Sheet visible onClose={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  await unmount();
});

describe('DESIGN-LANGUAGE §4, spec measurements, checked individually (mutation gaps from the review)', () => {
  test('24 px radius on top, not radius.control', async () => {
    await wrap(
      <Sheet visible onClose={jest.fn()}>
        <Text>Inhalt</Text>
      </Sheet>
    );
    const panel = screen.getByTestId('sheet-panel');
    const flattened = StyleSheet.flatten(panel.props.style);
    expect(flattened.borderTopLeftRadius).toBe(radius.card);
    expect(flattened.borderTopRightRadius).toBe(radius.card);
  });

  test('shadow-3, not deleted, and on the node with the visible surface (an iOS shadow needs content)', async () => {
    await wrap(
      <Sheet visible onClose={jest.fn()}>
        <Text>Inhalt</Text>
      </Sheet>
    );
    const shadowNode = screen.getByTestId('sheet-shadow');
    const flattened = StyleSheet.flatten(shadowNode.props.style);
    expect(flattened.shadowOpacity).toBe(shadow.s3.shadowOpacity);
    expect(flattened.shadowRadius).toBe(shadow.s3.shadowRadius);
    expect(flattened.elevation).toBe(shadow.s3.elevation);
    expect(flattened.backgroundColor).toBe(palette['bg-0']);
  });

  test('the grabber has the spec measurements (36x4, radius 999), not removed', async () => {
    await wrap(
      <Sheet visible onClose={jest.fn()}>
        <Text>Inhalt</Text>
      </Sheet>
    );
    const handle = screen.getByTestId('sheet-handle');
    const flattened = StyleSheet.flatten(handle.props.style);
    expect(flattened.width).toBe(36);
    expect(flattened.height).toBe(4);
    expect(flattened.borderRadius).toBe(radius.pill);
  });

  test('only the handle area carries the swipe handlers, not the whole panel', async () => {
    await wrap(
      <Sheet visible onClose={jest.fn()}>
        <Text>Inhalt</Text>
      </Sheet>
    );
    const handleArea = screen.getByTestId('sheet-handle-area');
    expect(typeof handleArea.props.onStartShouldSetResponder).toBe('function');
    const panel = screen.getByTestId('sheet-panel');
    expect(panel.props.onStartShouldSetResponder).toBeUndefined();
  });
});

// Review Important 2: a maximum height can't be retrofitted from a child,
// Task 12 (comment list) needs it unconditionally.
describe('Review Important 2, maximum height and cinema variant', () => {
  // Re-review: `maxHeight: '85%'` was, with high probability, ineffective:
  // `panelClip` sits inside `shadowLayer`, and `shadowLayer` is
  // `position:'absolute'` WITHOUT `top` and without an explicit height, so
  // it has no DEFINITE height for a percent value to resolve against.
  // `react-test-renderer` doesn't run a real Yoga layout, an "is a percent
  // string set" test could NEVER have caught this bug, with or without a
  // layout engine. The fix (numeric from useWindowDimensions() instead of
  // a percent string, see MAX_HEIGHT_RATIO in Sheet.tsx), in contrast,
  // makes the effect directly checkable: a number can be checked exactly
  // against the known window size of this Jest environment, independent
  // of whether any parent node ever gets a definite height.
  test('the panel is limited to a fraction of the actual window height (not to an ineffective percent string) and clips overflowing content', async () => {
    await wrap(
      <Sheet visible onClose={jest.fn()}>
        <Text>Inhalt</Text>
      </Sheet>
    );
    const panel = screen.getByTestId('sheet-panel');
    const flattened = StyleSheet.flatten(panel.props.style);
    const expectedHeight = Dimensions.get('window').height * MAX_HEIGHT_RATIO;
    expect(typeof flattened.maxHeight).toBe('number');
    expect(flattened.maxHeight).toBeCloseTo(expectedHeight);
    expect(flattened.overflow).toBe('hidden');
  });

  test('without `cinemaMode` the sheet uses the light palette', async () => {
    await wrap(
      <Sheet visible title="Titel" onClose={jest.fn()}>
        <Text>Inhalt</Text>
      </Sheet>
    );
    const shadowNode = screen.getByTestId('sheet-shadow');
    expect(StyleSheet.flatten(shadowNode.props.style).backgroundColor).toBe(palette['bg-0']);
    expect(StyleSheet.flatten(screen.getByText('Titel').props.style).color).toBe(palette['text-1']);
  });

  test('with `cinemaMode` the sheet uses the fixed cinema palette (cinema-1) instead of useTheme()', async () => {
    await wrap(
      <Sheet visible title="Titel" cinemaMode onClose={jest.fn()}>
        <Text>Inhalt</Text>
      </Sheet>
    );
    const shadowNode = screen.getByTestId('sheet-shadow');
    expect(StyleSheet.flatten(shadowNode.props.style).backgroundColor).toBe(cinema['bg-1']);
    expect(StyleSheet.flatten(screen.getByText('Titel').props.style).color).toBe(cinema['text-1']);
  });

  // Final-Review Critical 1: on the capture tab the cinema tab bar sits as
  // an absolute overlay on top of the scene, and without an inset the
  // sheet's own actions (button, text link) end up underneath it, where
  // taps hit the tabs instead. `bottomInset` lets a caller lift the panel's
  // padding by the bar's height.
  test("an explicit bottom inset lifts the panel's actions above an overlay bar", async () => {
    await wrap(
      <Sheet visible onClose={jest.fn()} bottomInset={91}>
        <Text>Inhalt</Text>
      </Sheet>
    );
    const panel = screen.getByTestId('sheet-panel');
    const flattened = Object.assign({}, ...[panel.props.style].flat(Infinity).filter(Boolean));
    expect(flattened.paddingBottom).toBe(spacing.xl + 91);
  });

  test('without a bottom inset the panel keeps the plain spacing.xl padding', async () => {
    await wrap(
      <Sheet visible onClose={jest.fn()}>
        <Text>Inhalt</Text>
      </Sheet>
    );
    const panel = screen.getByTestId('sheet-panel');
    const flattened = Object.assign({}, ...[panel.props.style].flat(Infinity).filter(Boolean));
    expect(flattened.paddingBottom).toBe(spacing.xl);
  });
});

// Device finding 2026-08-13 (the name-change sheet in the profile tab):
// the keyboard covered the panel completely and it seemed impossible to
// close. With behavior="padding", KeyboardAvoidingView only sets a
// paddingBottom ON ITSELF, and padding doesn't reach absolutely positioned
// children (the same finding has stood, word for word, in vorschau.tsx
// since the caption field). The panel must therefore be a normal flex
// child (root justifyContent 'flex-end', panel without
// position:'absolute'), only then does the padding push it above the
// keyboard. Jest doesn't run a Yoga layout; what's checkable is the
// STRUCTURE the geometry follows from, like the tree-position test in
// profileTab.test.tsx.
test('the panel is a flex child at the bottom edge, not absolutely positioned (otherwise the keyboard would cover it)', async () => {
  await wrap(
    <Sheet visible onClose={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  const root = StyleSheet.flatten(screen.getByTestId('sheet-root').props.style);
  expect(root.justifyContent).toBe('flex-end');
  const shadowNode = StyleSheet.flatten(screen.getByTestId('sheet-shadow').props.style);
  expect(shadowNode.position).toBeUndefined();
  expect(shadowNode.bottom).toBeUndefined();
});

// Review Important 2: an input field at the bottom (Task 12) also needs
// keyboard-avoidance logic that can't be retrofitted from a child either
// (the sheet itself hangs at the bottom edge).
test('avoids the keyboard (iOS: behavior="padding", same convention as preview.tsx)', async () => {
  await wrap(
    <Sheet visible onClose={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  // `behavior` itself is a configuration prop that KeyboardAvoidingView
  // consumes internally instead of passing it through to the rendered
  // host node (this RNTL version also no longer exposes a
  // react-test-renderer introspection like UNSAFE_getByType to query the
  // component itself instead of the host node). What's observable is the
  // RESOLVED effect: with behavior="padding", KeyboardAvoidingView renders
  // a `paddingBottom` in its own style (0 without a visible keyboard),
  // without behavior this style key is missing entirely (manually
  // cross-checked). jest-expo mocks Platform.OS as 'ios'.
  const root = screen.getByTestId('sheet-root');
  const flattened = StyleSheet.flatten(root.props.style);
  expect(flattened).toHaveProperty('paddingBottom');
});

// swipeExceedsThreshold is deliberately exported as a pure function (see
// Sheet.tsx), a real swipe gesture via PanResponder can't be reliably
// simulated without native touch history (also done nowhere else in the
// project, see preview.tsx: the caption-drag gesture there has no gesture
// test of its own for the same reason). The decision itself is still
// tested exhaustively here; the reset after a swipe-close (review minor,
// one-frame jump) is a direct consequence of it and, for the same reason,
// not separately simulatable.
describe('swipeExceedsThreshold', () => {
  test('a short, slow swipe does not close', () => {
    expect(swipeExceedsThreshold(20, 0.1)).toBe(false);
  });

  test('a sufficiently long distance closes', () => {
    expect(swipeExceedsThreshold(120, 0)).toBe(true);
  });

  test('a fast flick closes even over a short distance', () => {
    expect(swipeExceedsThreshold(10, 0.8)).toBe(true);
  });

  test('exactly at the distance threshold does not close yet (exclusive)', () => {
    expect(swipeExceedsThreshold(96, 0)).toBe(false);
  });

  test('exactly at the velocity threshold does not close yet (exclusive)', () => {
    expect(swipeExceedsThreshold(0, 0.5)).toBe(false);
  });
});
