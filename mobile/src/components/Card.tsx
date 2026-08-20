import { View, StyleSheet, type ViewProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, shadow, spacing } from '@/theme/tokens';

// Card with chrome (DESIGN-LANGUAGE v2 §3): white surface with shadow-1.
// Borderless trip cards (phase 3) are NOT a Card, they are image + text.
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
