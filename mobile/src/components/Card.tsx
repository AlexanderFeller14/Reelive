import { View, StyleSheet, type ViewProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, shadow, spacing } from '@/theme/tokens';

// Karte mit Chrome (DESIGN-LANGUAGE v2 §3): weisse Fläche mit shadow-1.
// Randlose Reise-Karten (Phase 3) sind KEINE Card, sie bestehen aus Bild + Text.
export function Card({ style, children, ...rest }: ViewProps) {
  const { colors } = useTheme();
  return (
    <View {...rest} style={[styles.base, { backgroundColor: colors['bg-0'] }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.card, padding: spacing.base, ...shadow.s1 },
});
