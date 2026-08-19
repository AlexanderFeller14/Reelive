import { Stack } from 'expo-router';
import { cinema } from '@/theme/tokens';

// Media screens (DESIGN-LANGUAGE v2 §1): fixed cinema palette, no theme;
// unlike trip/_layout.tsx, useTheme() is deliberately NOT used here. Header
// off, every screen brings its own head.
export default function CaptureStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: cinema['bg-0'] } }} />
  );
}
