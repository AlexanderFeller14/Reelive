import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { backdrop, cinema, motion, radius, shadow, spacing, type } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';

const REDUCED_DURATION_MS = 200;
// Generously outside the visible area: the actual sheet height depends on
// the content (Task 12 puts e.g. a comment list in there), this value only
// needs to be "safely beyond any realistic height", not a real distance.
const START_POSITION = 640;
// Swipe threshold: either a sufficiently long distance or a fast flick
// closes the sheet, independent of the (content-dependent) height of the
// panel.
const SWIPE_DISTANCE_THRESHOLD = 96;
const SWIPE_VELOCITY_THRESHOLD = 0.5;
// Limits the height independent of the content (review Important 2: a
// longer comment list, Task 12, would otherwise grow upward without limit
// and run off the top of the screen). Re-review: a percent string here
// would have been ineffective, `panelClip` sits inside `shadowLayer`, and
// `shadowLayer` is `position:'absolute'` WITHOUT `top` and without an
// explicit height, so it has no DEFINITE height for a percentage to resolve
// against (Yoga behaves like CSS here: a percentage height without a
// definite parent height is ignored). A numeric value from the actual
// window doesn't need that precondition, it applies independent of the
// parent height, and it's also the part of this fix that a test can
// actually verify: react-test-renderer doesn't run a real Yoga layout, so a
// percentage alone says nothing about the result, a computed number does.
// Exported so Sheet.test.tsx checks exactly the same ratio instead of
// guessing a second, potentially different number.
export const MAX_HEIGHT_RATIO = 0.85;

// How much window height the SCROLLING part of a sheet's content occupies
// at most.
//
// The value lives here rather than in one of the screens because it
// follows from THIS file: the panel above caps itself at 85% and clips the
// overhang hard (`overflow: hidden`). Content that keeps growing uncapped
// loses its last lines without replacement, and for a list of moments on
// one spot, those are exactly the ones unreachable any other way.
//
// Half leaves enough room under the 85% limit for the handle, the title, a
// pinned button, and the bottom padding, even on the smallest device
// (667 pt: 334 + 44 + 16 + 52 + 32 = 478 of 567 possible).
//
// Used by recap/[id]/map.tsx and share/[token].tsx. Before the merge fix
// round the number stood twice; the screen exported it explicitly,
// "instead of guessing a second number", but the shared recap can't import
// it without pulling recapApi/urlPool/tripsApi into its module graph
// (share/__tests__/moduleGraph.test.ts forbids exactly that). So it goes
// where the reasoning comes from anyway.
export const SHEET_SCROLL_RATIO = 0.5;

// A pure decision, without PanResponder/Animated around it, so it stays
// directly testable without simulated touch events (same principle as
// queueLogic.ts: decision separated from mechanics).
export function swipeExceedsThreshold(dy: number, vy: number): boolean {
  return dy > SWIPE_DISTANCE_THRESHOLD || vy > SWIPE_VELOCITY_THRESHOLD;
}

type Props = {
  visible: boolean;
  title?: string;
  onClose: () => void;
  children: ReactNode;
  // Review Important 2: Task 12 hangs the comment panel as a sheet in the
  // recap player (cinema context, docs/.../design-language-v2-airbnb-design.md
  // §7 "comment panel as sheet (cinema-1)"). `useTheme()` by construction
  // always returns the light palette (ThemeProvider is light-only), a child
  // can't recolor the surfaces the sheet draws itself (panel, grabber,
  // title) after the fact. Hence an explicit switch here, not derivable
  // from the theme.
  cinemaMode?: boolean;
  // Screens whose navigator paints an absolute bar over the scene, like the
  // capture tab's cinema bar (mobile/src/features/navigation/TabBar.tsx),
  // hand the bar's height here so the panel's actions clear it instead of
  // sitting underneath the bar where taps hit the tabs instead.
  bottomInset?: number;
};

// The project's first sheet component (DESIGN-LANGUAGE §4): from the
// bottom, 24 px radius on top, grabber, shadow-3, opens with spring-ui.
// Reused in Task 12 (comments).
//
// Closing works differently from opening, WITHOUT its own exit animation: a
// tap on the background or a sufficient downward swipe calls `onClose`
// immediately. The sheet disappears as soon as the calling site sets
// `visible` to false, the same control flow as the Alert.alert dialogs in
// trip/[id]/index.tsx: the parent holds the state, the component itself
// stays stateless regarding "is currently animating closed". A swipe that
// doesn't cross the threshold springs back instead of closing.
//
// prefers-reduced-motion (§5): no translation, just a 200 ms opacity fade,
// shared by panel and background over the same Animated.Value.
export function Sheet({ visible, title, onClose, children, cinemaMode, bottomInset = 0 }: Props) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  // useWindowDimensions instead of a percent string in the stylesheet, see
  // the comment at MAX_HEIGHT_RATIO. Also reacts to a device rotation while
  // the sheet is open.
  const { height: windowHeight } = useWindowDimensions();
  const maxHeight = windowHeight * MAX_HEIGHT_RATIO;
  const [translateY] = useState(() => new Animated.Value(START_POSITION));
  const [opacity] = useState(() => new Animated.Value(0));
  // onClose can change between two renders (a new function reference at
  // the parent), a ref holds the current version without rebuilding the
  // PanResponder on every render (same pattern as
  // SealAnimation.tsx/onFinishedRef).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!visible) return;
    opacity.setValue(0);
    // Computed fresh instead of cached at module scope (same convention as
    // Input.tsx's animate()): calling Easing.bezier() again on every open
    // costs nothing measurable and keeps the call visible at the spot that
    // actually needs it.
    if (reducedMotion) {
      translateY.setValue(0);
      Animated.timing(opacity, {
        toValue: 1,
        duration: REDUCED_DURATION_MS,
        easing: Easing.bezier(...motion.easeSmooth),
        useNativeDriver: true,
      }).start();
    } else {
      translateY.setValue(START_POSITION);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, ...motion.spring }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: motion.duration.base,
          easing: Easing.bezier(...motion.easeSmooth),
          useNativeDriver: true,
        }),
      ]).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reducedMotion]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_evt, gesture) => {
        if (gesture.dy > 0) translateY.setValue(gesture.dy);
      },
      onPanResponderRelease: (_evt, gesture) => {
        if (swipeExceedsThreshold(gesture.dy, gesture.vy)) {
          // The component stays mounted while closing (the parent only
          // renders `visible=false`), so the Animated.Value refs survive.
          // Without this reset, translateY would stay at the last swipe
          // offset: the first frame of the next open would flash at the old
          // position before the open effect (which only runs AFTER the
          // paint) corrects it.
          translateY.setValue(reducedMotion ? 0 : START_POSITION);
          onCloseRef.current();
          return;
        }
        if (reducedMotion) {
          translateY.setValue(0);
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, ...motion.spring }).start();
        }
      },
    })
  ).current;

  if (!visible) return null;

  const surface = cinemaMode ? cinema['bg-1'] : colors['bg-0'];
  const textColor = cinemaMode ? cinema['text-1'] : colors['text-1'];
  const grabberColor = cinemaMode ? cinema['text-2'] : colors['line-strong'];

  return (
    // Review Important 2: an input field at the bottom (Task 12: comment
    // entry) needs keyboard-avoidance logic, which can't be retrofitted
    // from a child. Same pattern as reise/neu.tsx: `padding` on iOS,
    // Android handles it via windowSoftInputMode at the window level.
    //
    // Device finding 2026-08-13 (the name-change sheet): padding alone was
    // NOT enough as long as the panel was `position:'absolute', bottom:0`,
    // padding doesn't reach absolutely positioned children (the same
    // finding as with the caption field, detailed in vorschau.tsx). That's
    // why the panel is a normal flex child, and `justifyContent:'flex-end'`
    // keeps it at the bottom: this way the keyboard padding actually pushes
    // it up.
    <KeyboardAvoidingView
      testID="sheet-root"
      style={[StyleSheet.absoluteFill, styles.root]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Pressable
        testID="sheet-backdrop"
        accessibilityRole="button"
        accessibilityLabel="Schliessen"
        style={StyleSheet.absoluteFill}
        onPress={onClose}
      >
        <Animated.View style={[StyleSheet.absoluteFill, styles.background, { opacity }]} />
      </Pressable>
      {/* Shadow and surface separated from the height limit: an iOS shadow
          needs a visible (non-transparent) surface to sit on, AND must not
          be clipped along with `overflow:'hidden'`, so the outer node
          carries surface+shadow+movement, the inner one only the
          limit/the clipping. */}
      <Animated.View
        testID="sheet-shadow"
        style={[styles.shadowLayer, { backgroundColor: surface, opacity, transform: [{ translateY }] }]}
      >
        <View
          testID="sheet-panel"
          style={[styles.panelClip, { maxHeight }, { paddingBottom: spacing.xl + bottomInset }]}
        >
          {/* Only the handle area is swipeable, the rest stays free for
              content like lists or input fields (Task 12) that need their
              own touch gestures (scroll). */}
          <View testID="sheet-handle-area" style={styles.handleArea} {...pan.panHandlers}>
            <View testID="sheet-handle" style={[styles.handle, { backgroundColor: grabberColor }]} />
            {title ? <Text style={[type.h3, { color: textColor }]}>{title}</Text> : null}
          </View>
          <View style={styles.content}>{children}</View>
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // Phase-5 final review, point 6: no more fixed hex/rgba value in the code
  // (DESIGN-LANGUAGE §9), `backdrop` (mobile/src/theme/tokens.ts) carries
  // the same value ("scrim rgba(0,0,0,0.4) faded 250 ms", see there) and
  // applies unchanged to both sheets (light AND cinema).
  background: { backgroundColor: backdrop },
  root: { justifyContent: 'flex-end' },
  shadowLayer: {
    // NO position:'absolute' (device finding 2026-08-13, comment in the
    // JSX): as a flex child at the bottom edge (root: flex-end), the
    // KeyboardAvoidingView's keyboard padding lifts the panel, an absolute
    // bottom:0 would ignore it. `flexShrink: 1` belongs to the same fix:
    // when space above the keyboard runs short, the panel shrinks instead
    // of running off the top of the screen (the full width comes for free
    // from `alignSelf: stretch`).
    flexShrink: 1,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    ...shadow.s3,
  },
  panelClip: {
    // maxHeight comes dynamically from useWindowDimensions() (see JSX), a
    // percent value here would have no definite parent height to resolve
    // against (see the comment at MAX_HEIGHT_RATIO).
    overflow: 'hidden',
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingBottom: spacing.xl,
  },
  handleArea: { alignItems: 'center', paddingTop: spacing.m, paddingBottom: spacing.base, gap: spacing.base },
  handle: { width: 36, height: 4, borderRadius: radius.pill },
  content: { paddingHorizontal: spacing.screen, gap: spacing.base },
});
