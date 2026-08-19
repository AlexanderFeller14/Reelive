import { Stack } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';

// Stack inside the tab: the tab bar stays visible while navigating.
// Header off, every screen brings its own H1 (Design-Language §2).
export default function TripStackLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors['bg-0'] } }} />
  );
}
