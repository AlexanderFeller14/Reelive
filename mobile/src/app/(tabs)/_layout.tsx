import { StyleSheet } from 'react-native';
import { Tabs, useSegments } from 'expo-router';
import { Camera, Map, Play, User } from 'lucide-react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';

// DESIGN-LANGUAGE v2 §4: Tab-Bar volle Breite, bg-0, 1 px Hairline oben,
// keine Rundung (die schwebende v1-Pille entfällt). Aktiv accent, inaktiv text-2.
export default function TabsLayout() {
  const { colors } = useTheme();
  // Phase-5-Final-Review, Punkt 5: der Recap-Player (recap/[id]/player) ist
  // laut Spec §8.2 "Vollbild, Kino-Palette" — keine helle bg-0-Leiste mit
  // accent/text-2-Labels unter dem Kinosaal, und `sozialBereich` (die
  // Emoji-Leiste im Player) liegt bei `bottom: spacing.xl`, exakt dort, wo
  // die Tab-Bar sonst gerendert würde. `tabBarStyle` lässt sich nur AUF der
  // Tabs-Navigator-Ebene abschalten, nicht aus dem verschachtelten Stack in
  // recap/_layout.tsx heraus — `useSegments()` liefert dafür die
  // UNNORMALISIERTEN Datei-Pfad-Segmente (Cast wie in app/_layout.tsx: mit
  // `experiments.typedRoutes` engt der Rückgabetyp sich sonst auf ein festes
  // Tupel ein, Laufzeitverhalten unverändert), für die Player-Route exakt
  // `['(tabs)', 'recap', '[id]', 'player']`.
  const segments = useSegments() as string[];
  const aufPlayerRoute = segments[1] === 'recap' && segments[2] === '[id]' && segments[3] === 'player';
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors['bg-0'] },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors['text-2'],
        tabBarLabelStyle: type.tab,
        tabBarStyle: aufPlayerRoute
          ? { display: 'none' }
          : {
              backgroundColor: colors['bg-0'],
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.line,
            },
      }}
    >
      <Tabs.Screen name="aufnehmen" options={{ title: 'Aufnehmen', tabBarIcon: ({ color }) => <Camera color={color} strokeWidth={1.75} /> }} />
      <Tabs.Screen name="reise" options={{ title: 'Reise', tabBarIcon: ({ color }) => <Map color={color} strokeWidth={1.75} /> }} />
      <Tabs.Screen name="recap" options={{ title: 'Recap', tabBarIcon: ({ color }) => <Play color={color} strokeWidth={1.75} /> }} />
      <Tabs.Screen name="profil" options={{ title: 'Profil', tabBarIcon: ({ color }) => <User color={color} strokeWidth={1.75} /> }} />
    </Tabs>
  );
}
