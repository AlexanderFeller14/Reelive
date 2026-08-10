import { Stack } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema } from '@/theme/tokens';

// Stack innerhalb des Tabs, gleiches Rezept wie reise/_layout.tsx: die
// Tab-Bar bleibt beim Navigieren sichtbar, Header aus, jeder Screen bringt
// seinen eigenen H1 mit (Design-Language §2). Das Verzeichnis heisst wie
// vorher die Platzhalter-Datei `recap.tsx`, Expo Router löst `(tabs)/recap`
// darum unverändert auf denselben Tab auf, `(tabs)/_layout.tsx` bleibt unberührt.
//
// Liste und Übersicht sind helle Screens, der Player ist ein Medien-Screen.
// DESIGN-LANGUAGE §5 verlangt für genau diesen Wechsel den «Fade durch Dunkel»
// («das Licht geht aus») statt des Parallax-Slides, den ein Stack sonst nimmt.
// Der Player blendet innen zusätzlich einen dunklen Overlay aus; ohne die
// Routen-Ebene hier bliebe darunter aber der weisse Stack-Grund stehen und der
// Wechsel begänne hell.
//
// Phase-5-Final-Review, Punkt 5: der Player ist Vollbild, die Tab-Bar
// bleibt bewusst NICHT sichtbar, wenn diese Route aktiv ist. `tabBarStyle`
// gehört dem Tabs-Navigator, nicht diesem verschachtelten Stack, die
// Abschaltung sitzt darum in `(tabs)/_layout.tsx` (dort per `useSegments()`),
// nicht hier.
export default function RecapStackLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors['bg-0'] } }}>
      <Stack.Screen
        name="[id]/player"
        options={{ animation: 'fade', contentStyle: { backgroundColor: cinema['bg-0'] } }}
      />
    </Stack>
  );
}
