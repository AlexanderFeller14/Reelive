import { Text, View, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';

export default function AufnehmenScreen() {
  const { colors } = useTheme();
  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      <Text style={[type.h2, { color: colors['text-1'] }]}>Hier fängst du bald Momente ein</Text>
      <Text style={[type.body, { color: colors['text-2'] }]}>
        Die Kamera kommt in Phase 4. Deine Filmrolle wartet auf dich.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.s },
});
