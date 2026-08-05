import { View, StyleSheet, type ViewProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

export function Card({ style, children, ...rest }: ViewProps) {
  const { colors, scheme } = useTheme();
  return (
    <View
      {...rest}
      style={[
        styles.base,
        { backgroundColor: colors['bg-1'] },
        scheme === 'light' && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ base: { borderRadius: radius.card, padding: spacing.base } });
