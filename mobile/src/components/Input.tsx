import { Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';

type Props = TextInputProps & { label: string; error?: string };

export function Input({ label, error, style, ...rest }: Props) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[type.label, { color: colors['text-2'] }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors['text-3']}
        style={[
          type.body,
          {
            backgroundColor: colors['bg-2'],
            color: colors['text-1'],
            borderRadius: radius.control,
            paddingHorizontal: spacing.base,
            height: 52,
          },
          style,
        ]}
        {...rest}
      />
      {error ? <Text style={[type.secondary, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}
