import { Stack } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema } from '@/theme/tokens';

// Stack inside the tab, same recipe as trip/_layout.tsx: the tab bar stays
// visible while navigating, headers off, every screen brings its own H1
// (DESIGN-LANGUAGE §2). The directory carries the name of the former
// placeholder file `recap.tsx`, so Expo Router still resolves `(tabs)/recap`
// onto the same tab and `(tabs)/_layout.tsx` stays untouched.
//
// List and overview are light screens, the player is a media screen.
// DESIGN-LANGUAGE §5 asks for exactly this switch to use the "fade through
// black" ("the lights go out") instead of the parallax slide a stack would
// take otherwise. The player additionally fades out a dark overlay on the
// inside; without the route level here the white stack ground would stay
// underneath and the switch would begin light.
//
// Phase 5 final review, point 5: the player is full screen, the tab bar
// deliberately stays hidden while this route is active. `tabBarStyle` belongs
// to the tabs navigator, not to this nested stack, so the switch off sits in
// `(tabs)/_layout.tsx` (there via `useSegments()`), not here.
export default function RecapStackLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors['bg-0'] } }}>
      {/* `index` MUST stand here, even though the route needs no options of its
          own. As soon as a stack has <Stack.Screen> children at all, their
          order decides which route the stack registers first, and the first one
          is its initial route. Found on the device (2026-08-11), not derived:
          the two other tab stacks stand as a self closing <Stack />, where
          `index` wins automatically. The remaining routes (`[id]/overview`,
          `[id]/map`) stay deliberately undeclared, they need no options and
          inherit the rest from `screenOptions`. */}
      <Stack.Screen name="index" />
      <Stack.Screen
        name="[id]/player"
        options={{ animation: 'fade', contentStyle: { backgroundColor: cinema['bg-0'] } }}
      />
    </Stack>
  );
}
