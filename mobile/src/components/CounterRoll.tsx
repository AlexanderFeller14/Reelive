import { Animated, StyleSheet, Text, View } from 'react-native';
import { palette, type } from '@/theme/tokens';

type Props = {
  from: number;
  to: number;
  // The single timer of the sequence (0 → 1), same construction as in
  // SealAnimation.tsx: this component doesn't bring its own timer,
  // `progressWindow` says which fraction of it it rolls during.
  progress: Animated.Value;
  progressWindow: readonly [number, number];
};

// How far digits travel while rolling. A motion distance, not a distance
// between two surfaces, therefore allowed outside the 4-pt grid (the same
// named exception as SPARK_RISE in RevealSequence.tsx).
const ROLL_DISTANCE = 28;

// The counter digit roll (DESIGN-LANGUAGE §5: "counter = digit roll"): only
// the digits that actually change roll (the old digit slides out upward, the
// new one comes in from below), unchanged digits stand still. Both numbers
// are right-aligned on top of each other (ones on ones), so 9 → 10 rolls the
// ones digit 9 → 0 and the new tens digit comes in alone, instead of "9"
// being swapped for "10" as a whole.
export function CounterRoll({ from, to, progress, progressWindow }: Props) {
  const length = Math.max(String(from).length, String(to).length);
  const old = String(from).padStart(length, ' ');
  const next = String(to).padStart(length, ' ');
  const [start, end] = progressWindow;

  const oldOpacity = progress.interpolate({
    inputRange: [start, end],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const oldY = progress.interpolate({
    inputRange: [start, end],
    outputRange: [0, -ROLL_DISTANCE],
    extrapolate: 'clamp',
  });
  const nextOpacity = progress.interpolate({
    inputRange: [start, end],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const nextY = progress.interpolate({
    inputRange: [start, end],
    outputRange: [ROLL_DISTANCE, 0],
    extrapolate: 'clamp',
  });

  return (
    // For screen readers this is ONE number (the new value), not two digits
    // per rolling position.
    <View
      style={styles.row}
      accessible
      accessibilityLabel={String(to)}
      importantForAccessibility="yes"
    >
      {Array.from(next, (nextDigit, i) => {
        const oldDigit = old[i];
        if (oldDigit === nextDigit) {
          return (
            <Text key={i} testID={`zaehler-ziffer-fest-${i}`} style={styles.digit}>
              {nextDigit}
            </Text>
          );
        }
        return (
          <View key={i}>
            <Animated.Text
              testID={`zaehler-ziffer-neu-${i}`}
              style={[styles.digit, { opacity: nextOpacity, transform: [{ translateY: nextY }] }]}
            >
              {nextDigit}
            </Animated.Text>
            {/* This position might not have existed before (9 → 10): then the
                new digit rolls in alone, a rendered space would still have
                digit width with tabular-nums and would visibly shift the
                number. */}
            {oldDigit !== ' ' && (
              <Animated.Text
                testID={`zaehler-ziffer-alt-${i}`}
                style={[
                  styles.digit,
                  styles.oldOverlay,
                  { opacity: oldOpacity, transform: [{ translateY: oldY }] },
                ]}
              >
                {oldDigit}
              </Animated.Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  digit: {
    ...type.display,
    color: palette['text-1'],
  },
  // Old and new digit are exactly the same width with tabular-nums, the new
  // digit carries the layout, the old one sits exactly on top of it.
  oldOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
