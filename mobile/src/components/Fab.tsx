import { Text, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, shadow, spacing, type } from '@/theme/tokens';

// FAB (DESIGN-LANGUAGE v2 §4): accent, Radius 999, shadow-2, unten rechts.
// Press-Scale 0.94 laut §5.
export function Fab({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ position: 'absolute', right: spacing.screen, bottom: spacing.screen }}>
      <PressScale scaleTo={0.94} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.s,
            height: 56,
            paddingHorizontal: spacing.l,
            borderRadius: radius.pill,
            backgroundColor: colors.accent,
            ...shadow.s2,
          }}
        >
          <Plus size={20} color={colors['on-accent']} strokeWidth={1.75} />
          <Text style={[type.bodyMedium, { color: colors['on-accent'] }]}>{label}</Text>
        </View>
      </PressScale>
    </View>
  );
}
