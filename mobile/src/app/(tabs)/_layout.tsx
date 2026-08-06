import { StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { Camera, Map, Play, User } from 'lucide-react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';

// DESIGN-LANGUAGE v2 §4: Tab-Bar volle Breite, bg-0, 1 px Hairline oben,
// keine Rundung (die schwebende v1-Pille entfällt). Aktiv accent, inaktiv text-2.
export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors['bg-0'] },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors['text-2'],
        tabBarLabelStyle: type.tab,
        tabBarStyle: {
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
