import { Text, View, StyleSheet } from 'react-native';
import { cinema, spacing, type } from '@/theme/tokens';

// Medien-Screen: immer Kino-Palette (DESIGN-LANGUAGE v2 §1), kein Theme.
export default function AufnehmenScreen() {
  return (
    <View style={[styles.screen, { backgroundColor: cinema['bg-0'] }]}>
      <Text style={[type.h2, { color: cinema['text-1'] }]}>Hier fängst du bald Momente ein</Text>
      <Text style={[type.body, { color: cinema['text-2'] }]}>
        Die Kamera kommt in Phase 4. Deine Filmrolle wartet auf dich.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.s },
});
