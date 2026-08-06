import { ActivityIndicator, Pressable, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';

type Props = {
  variant: 'primary' | 'secondary' | 'text';
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export function Button({ variant, label, onPress, disabled, loading }: Props) {
  const { colors } = useTheme();
  const blocked = disabled || loading;
  const bg =
    variant === 'primary' ? colors.accent : variant === 'secondary' ? colors['bg-1'] : 'transparent';
  const fg =
    variant === 'primary' ? colors['on-accent'] : variant === 'secondary' ? colors['text-1'] : colors['accent-text'];

  const handlePress = () => {
    if (!blocked) {
      onPress();
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        variant !== 'text' && { backgroundColor: bg, height: 52 },
        { opacity: blocked ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator testID="button-loading" color={fg} />
      ) : (
        <Text style={[type.body, { fontFamily: 'Figtree_600SemiBold', color: fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
  },
});
