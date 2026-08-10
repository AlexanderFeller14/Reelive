import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';

// Pille (DESIGN-LANGUAGE v2 §4). tone 'seal' nur für Versiegelungs-Symbolik,
// nie für Interaktion, dafür ist accent da.
export function Badge({
  label, tone = 'neutral', icon,
}: { label: string; tone?: 'seal' | 'neutral'; icon?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        alignSelf: 'flex-start',
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.xs,
        borderRadius: radius.pill,
        backgroundColor: colors['bg-1'],
      }}
    >
      {icon}
      <Text style={[type.label, { color: tone === 'seal' ? colors.seal : colors['text-2'] }]}>
        {label}
      </Text>
    </View>
  );
}
