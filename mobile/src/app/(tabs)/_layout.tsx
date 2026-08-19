import { useSyncExternalStore } from 'react';
import { StyleSheet } from 'react-native';
import { Tabs, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, Map, Play, User } from 'lucide-react-native';
import { Pill } from '@/components/Pill';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, type } from '@/theme/tokens';
import * as captureLock from '@/features/camera/captureLock';
import * as cinemaStage from '@/features/camera/cinemaStage';

// Höhe und Luft der Leiste wohnen in cinemaStage.ts (LEISTE_INHALT,
// LEISTE_LUFT_OBEN, leisteHoehe): der Kamera-Screen hebt seine unteren
// Bedienelemente um genau diese Höhe, sobald die Leiste als Overlay über dem
// Sucher liegt — eine geteilte Formel statt zweier Zahlen, die
// auseinanderlaufen können. Die Begründung der Werte (UIKit-Konstante 49,
// ein Rasterschritt Luft über den Icons) steht dort.
const LUFT_OBEN = cinemaStage.BAR_TOP_PADDING;

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
  // Zeigt der Kamera-Screen den Sucher, legt sich die Leiste durchscheinend
  // ÜBER das Bild statt ihm Platz wegzunehmen (Gerätefund 2026-08-18): Sucher
  // und Aufnahme-Vorschau zeichnen beide mit `cover`, aber vorher in
  // verschieden hohe Flächen — die Vorschau zeigte dadurch ~10 % weniger
  // Bildbreite als der Sucher («mehr gecropt als bevor ich auslöse»). Mit der
  // Leiste als Overlay sind beide Flächen gleich, was man sieht, ist was man
  // bekommt. Der Screen meldet über cinemaStage nur, OB der Sucher steht (die
  // hellen Zustände des Tabs behalten die normale Leiste); an WELCHEM Tab die
  // Kino-Form gilt, entscheidet unten die Route der screenOptions-Funktion.
  // Der Fokus taugt dafür nämlich nicht: die Aufnahme-Vorschau überdeckt den
  // Tab (Blur), die Leiste fiele unsichtbar in die helle Form zurück und
  // spränge beim Instant-Rückweg im ersten Frame sichtbar um — genau der
  // unsaubere Übergang aus dem Gerätefund. Solange aufnehmen der GEWÄHLTE
  // Tab ist, bleibt die Kino-Leiste deshalb stehen, Vorschau hin oder her.
  const sucherSichtbar = useSyncExternalStore(cinemaStage.subscribe, cinemaStage.get);
  return (
    <Tabs
      // Während einer laufenden Aufnahme (Foto-Zyklus oder Video) läuft ein
      // Tab-Tipp ins Leere: ein Wechsel feuerte das Fokus-Cleanup mitten in
      // die laufende Kamera-Session und navigierte von einer Aufnahme weg,
      // die gleich in die Vorschau will (siehe captureLock.ts). Die Leiste
      // bleibt dabei stehen — display:'none' nähme der Szene mitten in der
      // Aufnahme die Höhe, und der Sucher spränge sichtbar. Der Listener
      // liest die Sperre synchron zum Ereignis, ein Re-Render ist nicht
      // nötig; damit blockiert er auch VoiceOver-Tab-Wechsel, die durch
      // dasselbe Navigations-Ereignis laufen.
      screenListeners={{
        tabPress: (e) => {
          if (captureLock.isLocked()) e.preventDefault();
        },
      }}
      screenOptions={({ route }) => {
        // Kino-Form nur, wenn aufnehmen der GEWÄHLTE Tab ist UND der Sucher
        // steht. Der Renderer nimmt die Options des fokussierten Tabs — die
        // Route hier IST die Tab-Wahl, und die ändert sich nicht, wenn die
        // Vorschau den Navigator nur überdeckt.
        const kino = route.name === 'aufnehmen' && sucherSichtbar;
        return {
          headerShown: false,
          sceneStyle: { backgroundColor: colors['bg-0'] },
          tabBarActiveTintColor: colors.accent,
          // Über dem Kamerabild braucht Inaktives die Kino-Textfarbe, das
          // helle Grau von text-2 stünde sonst auf dunklem Blur.
          tabBarInactiveTintColor: kino ? cinema['text-2'] : colors['text-2'],
          tabBarStyle: aufPlayerRoute
            ? { display: 'none' as const }
            : kino
              ? {
                  // Overlay statt Fläche: `absolute` nimmt die Leiste aus dem
                  // Layout, der Sucher darunter bekommt den ganzen Bildschirm.
                  // Hintergrund übernimmt tabBarBackground (Pille-Rezept),
                  // keine Hairline auf dem Bild.
                  position: 'absolute' as const,
                  backgroundColor: 'transparent',
                  borderTopWidth: 0,
                  paddingTop: LUFT_OBEN,
                  height: cinemaStage.barHeight(bottom),
                }
              : {
                  backgroundColor: colors['bg-0'],
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.line,
                  paddingTop: LUFT_OBEN,
                  height: cinemaStage.barHeight(bottom),
                },
          // DESIGN-LANGUAGE §1: UI auf dem Bild nur translucent
          // (rgba(19,17,16,0.55) + Blur 10) — exakt das Pille-Rezept, nur
          // ohne Rundung (§4: Tab-Bar keine Rundung).
          tabBarBackground: kino
            ? () => <Pill style={StyleSheet.absoluteFill} pointerEvents="none" />
            : undefined,
          tabBarLabelStyle: type.tab,
        };
      }}
    >
      <Tabs.Screen name="aufnehmen" options={{ title: 'Aufnehmen', tabBarIcon: ({ color }) => <Camera color={color} strokeWidth={1.75} /> }} />
      <Tabs.Screen name="reise" options={{ title: 'Reise', tabBarIcon: ({ color }) => <Map color={color} strokeWidth={1.75} /> }} />
      <Tabs.Screen name="recap" options={{ title: 'Recap', tabBarIcon: ({ color }) => <Play color={color} strokeWidth={1.75} /> }} />
      <Tabs.Screen name="profil" options={{ title: 'Profil', tabBarIcon: ({ color }) => <User color={color} strokeWidth={1.75} /> }} />
    </Tabs>
  );
}
