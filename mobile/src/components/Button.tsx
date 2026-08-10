import { ActivityIndicator, Text, View, StyleSheet } from 'react-native';
import { PressScale } from '@/components/PressScale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';

type Props = {
  variant: 'primary' | 'secondary' | 'text';
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

// DESIGN-LANGUAGE v2 §4: primär = accent-Fläche, sekundär = Outline auf Weiss,
// text = unterstrichener Link in text-1. Genau ein Primär-Button pro Screen.
export function Button({ variant, label, onPress, disabled, loading }: Props) {
  const { colors } = useTheme();
  const blocked = disabled || loading;

  return (
    <PressScale
      accessibilityRole="button"
      // `accessibilityLabel` explizit, weil der Text im Ladezustand durch einen
      // ActivityIndicator ersetzt wird, ohne ihn ist der Knopf dann namenlos.
      // `busy` unterscheidet fuer VoiceOver «laedt gerade» von «deaktiviert»,
      // obwohl beide Zustaende hier dieselbe Sperre ausloesen.
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!blocked, busy: !!loading }}
      disabled={!!blocked}
      onPress={() => {
        if (!blocked) onPress();
      }}
    >
      {({ pressed }) => {
        const bg =
          variant === 'primary'
            ? blocked
              ? colors['bg-1']
              : pressed
                ? colors['accent-pressed']
                : colors.accent
            : variant === 'secondary'
              ? pressed
                ? colors['bg-1']
                : colors['bg-0']
              : 'transparent';
        const fg =
          variant === 'primary'
            ? blocked
              ? colors['text-3']
              : colors['on-accent']
            : blocked
              ? colors['text-3']
              : colors['text-1'];
        return (
          <View
            style={[
              styles.base,
              variant !== 'text' && { backgroundColor: bg, height: 52 },
              variant === 'secondary' && { borderWidth: 1, borderColor: fg },
            ]}
          >
            {loading ? (
              <ActivityIndicator testID="button-loading" color={fg} />
            ) : (
              <Text style={[type.bodyMedium, { color: fg }, variant === 'text' && styles.underline]}>
                {label}
              </Text>
            )}
          </View>
        );
      }}
    </PressScale>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
  },
  underline: { textDecorationLine: 'underline' },
});
