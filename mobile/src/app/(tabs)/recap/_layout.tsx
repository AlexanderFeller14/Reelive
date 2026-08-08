import { Stack } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';

// Stack innerhalb des Tabs, gleiches Rezept wie reise/_layout.tsx: die
// Tab-Bar bleibt beim Navigieren sichtbar, Header aus — jeder Screen bringt
// seinen eigenen H1 mit (Design-Language §2). Das Verzeichnis heisst wie
// vorher die Platzhalter-Datei `recap.tsx` — Expo Router löst `(tabs)/recap`
// darum unverändert auf denselben Tab auf, `(tabs)/_layout.tsx` bleibt unberührt.
export default function RecapStackLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors['bg-0'] } }} />
  );
}
