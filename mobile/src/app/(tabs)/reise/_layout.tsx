import { Stack } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';

// Stack innerhalb des Tabs: die Tab-Bar bleibt beim Navigieren sichtbar.
// Header aus, jeder Screen bringt seinen eigenen H1 mit (Design-Language §2).
export default function ReiseStackLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors['bg-0'] } }} />
  );
}
