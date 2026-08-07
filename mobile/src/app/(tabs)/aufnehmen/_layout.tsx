import { Stack } from 'expo-router';
import { cinema } from '@/theme/tokens';

// Medien-Screens (DESIGN-LANGUAGE v2 §1): feste Kino-Palette, kein Theme —
// anders als reise/_layout.tsx wird hier bewusst NICHT useTheme() verwendet.
// Header aus, jeder Screen bringt seinen eigenen Kopf mit.
export default function AufnehmenStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: cinema['bg-0'] } }} />
  );
}
