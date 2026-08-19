import { useSyncExternalStore } from 'react';
import { StyleSheet } from 'react-native';
import { Tabs, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, Map, Play, User } from 'lucide-react-native';
import { Pill } from '@/components/Pill';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, type } from '@/theme/tokens';
import * as captureLock from '@/features/camera/captureLock';
import * as cinemaStage from '@/features/camera/cinemaStage';

// Height and padding of the bar live in cinemaStage.ts (BAR_CONTENT_HEIGHT,
// BAR_TOP_PADDING, barHeight): the camera screen lifts its lower controls by
// exactly this height as soon as the bar lies over the viewfinder as an
// overlay, one shared formula instead of two numbers that can drift apart.
// The reasoning behind the values (UIKit constant 49, one grid step of air
// above the icons) is documented there.
const TOP_PADDING = cinemaStage.BAR_TOP_PADDING;

// DESIGN-LANGUAGE v2 §4: tab bar at full width, bg-0, 1 px hairline on top,
// no rounding (the floating v1 pill is gone). Active accent, inactive text-2.
export default function TabsLayout() {
  const { colors } = useTheme();
  // `tabBarStyle` can only be switched off ON the tabs navigator level, not
  // from inside the nested stack in recap/_layout.tsx, and `useSegments()`
  // supplies the UNNORMALISED file path segments for that (cast as in
  // app/_layout.tsx: with `experiments.typedRoutes` the return type would
  // otherwise narrow to a fixed tuple, runtime behaviour unchanged), for the
  // player route exactly `['(tabs)', 'recap', '[id]', 'player']`.
  const segments = useSegments() as string[];
  const onPlayerRoute = segments[1] === 'recap' && segments[2] === '[id]' && segments[3] === 'player';
  // The capture preview deliberately needs NO exception here, even though it
  // is a full-screen media screen too: it no longer lives inside the tab
  // navigator but next to it (app/preview.tsx, reasoning there and in
  // guard.ts). An exception at this spot only takes effect once the
  // navigator rerenders after the route change, and the bar therefore stayed
  // visible for a blink after the shutter.
  //
  // The height has to grow with it: the renderer pins it (49 + inset), and a
  // bare `paddingTop` squeezed icon and label inside instead of opening the
  // bar up. A `height` in `tabBarStyle` is at the same time what the
  // renderer reads for `useBottomTabBarHeight()`, so screens keep computing
  // with the right value.
  const { bottom } = useSafeAreaInsets();
  // While the camera screen shows the viewfinder, the bar lies translucent
  // OVER the image instead of taking space away from it (device finding
  // 2026-08-18): viewfinder and capture preview both draw with `cover`, but
  // into surfaces of different heights, so the preview showed about 10 % less
  // image width than the viewfinder ("more cropped than before I hit the
  // shutter"). With the bar as an overlay both surfaces are equal: what you
  // see is what you get. The screen only reports through cinemaStage WHETHER
  // the viewfinder stands (the bright states of the tab keep the normal
  // bar); WHICH tab the cinema shape applies to is decided below by the
  // route of the screenOptions function. Focus is no good for that: the
  // capture preview covers the tab (blur), the bar would fall invisibly back
  // into the bright shape and would visibly jump on the first frame of the
  // instant way back, exactly the rough transition from the device finding.
  const viewfinderVisible = useSyncExternalStore(cinemaStage.subscribe, cinemaStage.get);
  return (
    <Tabs
      // The bar stays put during a running capture: display:'none' would take
      // the height away from the scene mid-capture and the viewfinder would
      // jump. The listener reads the lock synchronously with the event, no
      // rerender needed; that way it also blocks VoiceOver tab switches,
      // which travel through the same navigation event.
      screenListeners={{
        tabPress: (e) => {
          if (captureLock.isLocked()) e.preventDefault();
        },
      }}
      screenOptions={({ route }) => {
        const cinemaMode = route.name === 'capture' && viewfinderVisible;
        return {
          headerShown: false,
          sceneStyle: { backgroundColor: colors['bg-0'] },
          tabBarActiveTintColor: colors.accent,
          // Over the camera image, inactive needs the cinema text colour: the
          // light grey of text-2 would otherwise sit on a dark blur.
          tabBarInactiveTintColor: cinemaMode ? cinema['text-2'] : colors['text-2'],
          tabBarStyle: onPlayerRoute
            ? { display: 'none' as const }
            : cinemaMode
              ? {
                  position: 'absolute' as const,
                  backgroundColor: 'transparent',
                  borderTopWidth: 0,
                  paddingTop: TOP_PADDING,
                  height: cinemaStage.barHeight(bottom),
                }
              : {
                  backgroundColor: colors['bg-0'],
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.line,
                  paddingTop: TOP_PADDING,
                  height: cinemaStage.barHeight(bottom),
                },
          // DESIGN-LANGUAGE §1: UI on top of the image only translucent
          // (rgba(19,17,16,0.55) + blur 10), exactly the pill recipe, only
          // without rounding (§4: tab bar has no rounding).
          tabBarBackground: cinemaMode
            ? () => <Pill style={StyleSheet.absoluteFill} pointerEvents="none" />
            : undefined,
          tabBarLabelStyle: type.tab,
        };
      }}
    >
      <Tabs.Screen name="capture" options={{ title: 'Aufnehmen', tabBarIcon: ({ color }) => <Camera color={color} strokeWidth={1.75} /> }} />
      <Tabs.Screen name="trip" options={{ title: 'Reise', tabBarIcon: ({ color }) => <Map color={color} strokeWidth={1.75} /> }} />
      <Tabs.Screen name="recap" options={{ title: 'Recap', tabBarIcon: ({ color }) => <Play color={color} strokeWidth={1.75} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil', tabBarIcon: ({ color }) => <User color={color} strokeWidth={1.75} /> }} />
    </Tabs>
  );
}
