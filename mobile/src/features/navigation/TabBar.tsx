import { useEffect, useSyncExternalStore } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, Map, Play, User, type LucideIcon } from 'lucide-react-native';
import { Pill } from '@/components/Pill';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, spacing, type } from '@/theme/tokens';
import * as captureLock from '@/features/camera/captureLock';
import * as cinemaStage from '@/features/camera/cinemaStage';
import * as warmup from '@/features/camera/warmup';
import { barShape } from './barShape';

// The tab bar, hand-built. The swipeable navigator (TopTabs, app/(tabs)/
// _layout.tsx) brings a material bar with an indicator stripe, a ripple and
// no icons at all, none of which DESIGN-LANGUAGE v2 §4 wants. What is gained
// beyond the looks: the shape of the bar used to be a nested ternary inside
// `tabBarStyle`, it now reads as a component plus a plain function
// (barShape.ts).
type Route = { key: string; name: string };

type Props = {
  state: { index: number; routes: Route[] };
  navigation: {
    emit: (event: { type: string; target: string; canPreventDefault: boolean }) => {
      defaultPrevented: boolean;
    };
  };
  /** The pager's live position, in tab widths. Drives the camera warm-up. */
  position: Animated.AnimatedInterpolation<number> | Animated.Value;
  jumpTo: (key: string) => void;
  /** The unnormalised path segments, exactly as `useSegments()` hands them over. */
  segments: string[];
};

// UI language is german (DESIGN-LANGUAGE §6), everything else here english.
const TABS: Record<string, { label: string; Icon: LucideIcon }> = {
  capture: { label: 'Aufnehmen', Icon: Camera },
  trip: { label: 'Reise', Icon: Map },
  recap: { label: 'Recap', Icon: Play },
  profile: { label: 'Profil', Icon: User },
};

const CAPTURE_TAB = 'capture';

export function TabBar({ state, navigation, position, jumpTo, segments }: Props) {
  const { colors } = useTheme();
  const { bottom } = useSafeAreaInsets();
  const viewfinderVisible = useSyncExternalStore(cinemaStage.subscribe, cinemaStage.get);
  const selectedTab = state.routes[state.index]?.name ?? '';
  const shape = barShape(segments, selectedTab, viewfinderVisible);

  // The camera session starts WITH the gesture, not when it ends: the pager
  // reports its position continuously, and this bar is the only place that
  // position is available. Without it the whole swipe would drag a black
  // surface into view, because the session only builds up on focus.
  //
  // A listener on the Animated node, deliberately not a re-render of our own:
  // this fires on every frame of the drag. `warmup.set` swallows repeats, so
  // the camera screen only re-renders when the answer actually flips.
  const captureIndex = state.routes.findIndex((route) => route.name === CAPTURE_TAB);
  useEffect(() => {
    if (captureIndex < 0) return;
    const id = position.addListener(({ value }: { value: number }) => {
      warmup.set(Math.abs(value - captureIndex) < warmup.NEAR_ENOUGH);
    });
    return () => {
      position.removeListener(id);
      // Leaving the stage (deep link, unmount) must not leave a warm-up
      // behind that nobody takes back: the session would keep running on a
      // screen that is no longer there.
      warmup.set(false);
    };
  }, [position, captureIndex]);

  if (shape === 'hidden') return null;

  const cinemaMode = shape === 'cinema';
  return (
    <View
      testID="tab-bar"
      style={[
        styles.bar,
        // The height comes from cinemaStage.barHeight and nowhere else: the
        // camera screen lifts its lower controls by exactly this amount, and
        // the scene padding in _layout.tsx keeps the other screens clear of
        // the bar, one shared formula instead of numbers that can drift
        // apart.
        { height: cinemaStage.barHeight(bottom) },
        cinemaMode
          ? styles.cinemaBar
          : {
              backgroundColor: colors['bg-0'],
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.line,
            },
      ]}
    >
      {/* DESIGN-LANGUAGE §1: UI on top of an image only translucent
          (rgba(19,17,16,0.55) + blur 10), exactly the pill recipe, only
          without rounding (§4: the tab bar has none). */}
      {cinemaMode && <Pill testID="tab-bar-cinema" style={StyleSheet.absoluteFill} pointerEvents="none" />}
      {state.routes.map((route, index) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const focused = index === state.index;
        // Over the camera image, inactive needs the cinema text colour: the
        // light grey of text-2 would otherwise sit on a dark blur.
        const color = focused ? colors.accent : cinemaMode ? cinema['text-2'] : colors['text-2'];
        return (
          <Pressable
            key={route.key}
            style={styles.item}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.label}
            onPress={() => {
              // The lock blocks the gesture through `swipeEnabled` up in the
              // layout; the tap needs its own guard, otherwise the focus
              // cleanup would fire right into a running capture. Read
              // synchronously with the event, no re-render needed, so this
              // also stops VoiceOver, which travels the same way.
              if (captureLock.isLocked()) return;
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!event.defaultPrevented) jumpTo(route.key);
            }}
          >
            <tab.Icon color={color} strokeWidth={1.75} />
            <Text style={[type.tab, styles.label, { color }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // The bar lies over the pager in EVERY shape: its shape follows the
  // COMMITTED tab, and a plain bar that took layout height made every scene
  // a bar height shorter until a swipe settled, so the dragged-in camera
  // scene stood visibly too high and dropped into place at the end of the
  // gesture (device finding 2026-08-28, "der Sucher ist beim Swipen höher").
  // The scenes keep their distance through scene padding instead
  // (barShape.paddedScene, applied in _layout.tsx).
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    paddingTop: cinemaStage.BAR_TOP_PADDING,
  },
  // Over the viewfinder the bar's own surface disappears: the translucent
  // pill below carries the cinema look, so viewfinder and preview show the
  // same area.
  cinemaBar: { backgroundColor: 'transparent' },
  item: { flex: 1, alignItems: 'center', gap: spacing.xs },
  label: { textAlign: 'center' },
});
