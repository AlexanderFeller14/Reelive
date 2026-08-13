import { StyleSheet } from 'react-native';
import { Tabs, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, Map, Play, User } from 'lucide-react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';

// Die UIKit-Standardhöhe der Tab-Bar in React Navigation (49 Punkte Inhalt,
// der Home-Indicator-Streifen kommt als Safe-Area-Inset obendrauf). Der Wert
// steht als Konstante in expo-routers mitgeliefertem Bottom-Tabs-Renderer
// (`TABBAR_HEIGHT_UIKIT`), wird von dort aber nicht exportiert, darum hier
// nachgezogen. Nur portrait relevant: die App ist laut app.json auf
// `portrait` festgelegt, die schmalere Landscape-Variante (32) kann nicht
// auftreten.
const TAB_BAR_INHALT = 49;

// DESIGN-LANGUAGE §3 (4er-Raster): ein Rasterschritt Luft zwischen Hairline
// und Icon. Die Items des Renderers stehen mit `justifyContent: 'flex-start'`
// und 5 Punkten Innenabstand oben in der Leiste, am Gerät klebten Icon und
// Label dadurch an der Trennlinie.
const LUFT_OBEN = spacing.s;

// DESIGN-LANGUAGE v2 §4: Tab-Bar volle Breite, bg-0, 1 px Hairline oben,
// keine Rundung (die schwebende v1-Pille entfällt). Aktiv accent, inaktiv text-2.
export default function TabsLayout() {
  const { colors } = useTheme();
  // Phase-5-Final-Review, Punkt 5: der Recap-Player (recap/[id]/player) ist
  // laut Spec §8.2 "Vollbild, Kino-Palette", keine helle bg-0-Leiste mit
  // accent/text-2-Labels unter dem Kinosaal, und `sozialBereich` (die
  // Emoji-Leiste im Player) liegt bei `bottom: spacing.xl`, exakt dort, wo
  // die Tab-Bar sonst gerendert würde. `tabBarStyle` lässt sich nur AUF der
  // Tabs-Navigator-Ebene abschalten, nicht aus dem verschachtelten Stack in
  // recap/_layout.tsx heraus, `useSegments()` liefert dafür die
  // UNNORMALISIERTEN Datei-Pfad-Segmente (Cast wie in app/_layout.tsx: mit
  // `experiments.typedRoutes` engt der Rückgabetyp sich sonst auf ein festes
  // Tupel ein, Laufzeitverhalten unverändert), für die Player-Route exakt
  // `['(tabs)', 'recap', '[id]', 'player']`.
  const segments = useSegments() as string[];
  const aufPlayerRoute = segments[1] === 'recap' && segments[2] === '[id]' && segments[3] === 'player';
  // Die Aufnahme-Vorschau braucht hier KEINE Ausnahme, obwohl sie ebenfalls
  // ein Vollbild-Medienscreen ist: Sie liegt gar nicht mehr im Tab-Navigator,
  // sondern daneben (app/vorschau.tsx, Begründung dort und in guard.ts). Eine
  // Ausnahme an dieser Stelle wirkt erst, wenn der Navigator nach dem
  // Routenwechsel neu rendert, die Leiste blieb dadurch nach dem Auslösen noch
  // einen Wimpernschlag stehen.
  // Die Höhe muss mitwachsen: der Renderer setzt sie fest (49 + Inset), ein
  // blosses `paddingTop` stauchte Icon und Label darin, statt die Leiste
  // aufzumachen. Ein `height` im `tabBarStyle` ist zugleich das, was der
  // Renderer für `useBottomTabBarHeight()` liest, Screens rechnen also weiter
  // mit dem richtigen Wert.
  const { bottom } = useSafeAreaInsets();
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
              paddingTop: LUFT_OBEN,
              height: TAB_BAR_INHALT + LUFT_OBEN + bottom,
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
