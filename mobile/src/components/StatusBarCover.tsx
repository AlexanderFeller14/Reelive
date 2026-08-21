import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';

// Opaque backing for the status bar area (clock, wifi, battery). No screen
// shows a navigation header, so scrolled content and keyboard-shifted forms
// slide up to y = 0 and become visible behind the system indicators. This
// plants an app-background surface over exactly the strip the device
// occupies: on the white background it is invisible until content passes
// underneath.
//
// Mount it as a sibling AFTER the scrolling content (later siblings paint on
// top) but BEFORE sheets and overlays, whose backdrop must keep covering the
// whole screen. Light journal screens only: the cinema screens rely on their
// photo scrims, the map stays edge-to-edge by design.
//
// The height is exactly `insets.top`, not a grid value: what the device
// occupies is not a design decision (same reasoning as useTopInset).
export function StatusBarCover() {
  const { top } = useSafeAreaInsets();
  const { colors } = useTheme();
  // Web and other environments without a system strip need no cover.
  if (top === 0) return null;
  return (
    <View
      testID="status-bar-cover"
      // The strip lies over the scroll content; touches must reach it.
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: top,
        backgroundColor: colors['bg-0'],
      }}
    />
  );
}
