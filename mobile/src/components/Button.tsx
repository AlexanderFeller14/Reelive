import { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Text, View, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { useTheme } from '@/theme/ThemeProvider';
import { motion, radius, spacing, type } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';

// The checkmark fades in with scale + opacity (§5: only transform/opacity),
// via spring-ui, whose slight overshoot brings the "pop" for free, a
// hard-appearing success checkmark would read as a jump, not a moment. Its
// own component, because the fade-in is tied to the MOUNT: it only exists
// once `success` becomes true, and starts at 0 exactly then.
function SuccessCheck({ color }: { color: string }) {
  const [fadeIn] = useState(() => new Animated.Value(0));
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      // §5: everything becomes a 200 ms fade.
      Animated.timing(fadeIn, {
        toValue: 1,
        duration: 200,
        easing: Easing.bezier(...motion.easeSmooth),
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.spring(fadeIn, { toValue: 1, useNativeDriver: true, ...motion.spring }).start();
  }, [fadeIn, reducedMotion]);

  return (
    <Animated.View
      testID="button-erfolg"
      style={{
        opacity: fadeIn,
        // With reduced motion, just the fade, no growing out of nothing.
        transform: [{ scale: reducedMotion ? 1 : fadeIn }],
      }}
    >
      <Check size={22} color={color} strokeWidth={1.75} />
    </Animated.View>
  );
}

type Props = {
  variant: 'primary' | 'secondary' | 'text';
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  // Success moment (the save moment in the name editor): a checkmark
  // replaces the label, the button is locked but keeps its colors, the
  // moment celebrates, it doesn't disable. NEVER green: §1/§7 forbid green
  // as a success color, the checkmark stands in the label color (primary:
  // on-accent).
  success?: boolean;
};

// DESIGN-LANGUAGE v2 §4: primary = accent surface, secondary = outline on
// white, text = underlined link in text-1. Exactly one primary button per
// screen.
export function Button({ variant, label, onPress, disabled, loading, success }: Props) {
  const { colors } = useTheme();
  // `success` locks like `blocked`, but does NOT take on the blocked
  // colors (see bg/fg below): a gray success moment wouldn't be one.
  const blocked = disabled || loading || success;

  return (
    <PressScale
      accessibilityRole="button"
      // `accessibilityLabel` explicit, because the text gets replaced by an
      // ActivityIndicator in the loading state, without it the button would
      // then be nameless. `busy` distinguishes "currently loading" from
      // "disabled" for VoiceOver, even though both states trigger the same
      // lock here.
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!blocked, busy: !!loading }}
      disabled={!!blocked}
      onPress={() => {
        if (!blocked) onPress();
      }}
    >
      {({ pressed }) => {
        // `success` deliberately doesn't count as blocked for the colors.
        const dimmed = blocked && !success;
        const bg =
          variant === 'primary'
            ? dimmed
              ? colors['bg-1']
              : pressed && !success
                ? colors['accent-pressed']
                : colors.accent
            : variant === 'secondary'
              ? pressed && !dimmed
                ? colors['bg-1']
                : colors['bg-0']
              : 'transparent';
        const fg =
          variant === 'primary'
            ? dimmed
              ? colors['text-3']
              : colors['on-accent']
            : dimmed
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
            {success ? (
              <SuccessCheck color={fg} />
            ) : loading ? (
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
