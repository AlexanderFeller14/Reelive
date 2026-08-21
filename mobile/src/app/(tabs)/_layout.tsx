import { useSyncExternalStore } from 'react';
import { useSegments } from 'expo-router';
import { TopTabs, type MaterialTopTabBarProps } from 'expo-router/js-top-tabs';
import { useTheme } from '@/theme/ThemeProvider';
import { TabBar } from '@/features/navigation/TabBar';
import { swipeAllowed } from '@/features/navigation/barShape';
import * as captureLock from '@/features/camera/captureLock';

// The tabs can be swiped: a horizontal drag carries the content along and
// can be taken back mid-gesture. TopTabs is the navigator expo-router ships
// for that (over react-native-tab-view); the bottom tabs it replaces knew
// taps only.
//
// Two things follow from the swap. The bar stays at the bottom
// (tabBarPosition) but is OURS (features/navigation/TabBar.tsx): the material
// bar underneath brings an indicator stripe, a ripple and no icons, none of
// which DESIGN-LANGUAGE v2 §4 wants. And the shape of the bar, which used to
// be a nested ternary in `tabBarStyle` right here, now lives as a plain
// function next to the bar (barShape.ts).
export default function TabsLayout() {
  const { colors } = useTheme();
  // `useSegments()` supplies the UNNORMALISED file path segments (cast as in
  // app/_layout.tsx: with `experiments.typedRoutes` the return type would
  // otherwise narrow to a fixed tuple, runtime behaviour unchanged). Both the
  // shape of the bar and the swipe permission hang off them.
  const segments = useSegments() as string[];
  // Unlike the tap listener it replaces, this is read while RENDERING, hence
  // the subscription (captureLock.ts): a swipe during a running capture would
  // fire the focus cleanup into the live session and navigate away from a
  // capture on its way to the preview.
  const locked = useSyncExternalStore(captureLock.subscribe, captureLock.isLocked);
  return (
    <TopTabs
      tabBarPosition="bottom"
      tabBar={(props: MaterialTopTabBarProps) => <TabBar {...props} segments={segments} />}
      screenOptions={{
        // Every screen stays mounted, so the neighbour is already there while
        // the finger drags instead of arriving empty. What that costs stays
        // small: the screens hang their loading on useFocusEffect, which
        // fires for the focused one only. The camera is the exception, and it
        // starts with the gesture instead (features/camera/warmup.ts).
        lazy: false,
        swipeEnabled: swipeAllowed(segments) && !locked,
        sceneStyle: { backgroundColor: colors['bg-0'] },
      }}
    >
      <TopTabs.Screen name="capture" />
      <TopTabs.Screen name="trip" />
      <TopTabs.Screen name="recap" />
      <TopTabs.Screen name="profile" />
    </TopTabs>
  );
}
