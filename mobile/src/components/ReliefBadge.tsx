import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { radius, spacing } from '@/theme/tokens';

// The raised white badge that sits ON photos: trip tab hero card ("Aktiv",
// "Noch X Tage") and the recap card's play pill. ONE recipe instead of
// copies that drift apart (same reasoning as Pill.tsx).
//
// The look follows Airbnb's service pills, measured off the user's
// reference screenshot (2026-08-27, pixel scan) and tuned on the device in
// several feedback rounds: an almost white fill whose crown darkens only a
// touch, a soft white ring with a blurred dark seam just outside it (the
// visible "border"), a faint inner curvature, and a double drop shadow
// (tight contact + wide lift). Fixed hex values, a surface gradient and
// shadows outside the three-step scale are deliberate deviations from
// DESIGN-LANGUAGE §1/§3/§7 for exactly this effect; they are the badge's
// material, not palette colors, and stay local to this file.
const SHEEN = ['#FFFFFF', '#F3F3F3', '#FBFBFB', '#FFFFFF'] as const;
const SHEEN_STOPS = [0, 0.22, 0.8, 1] as const;
// The last layer is the dark seam just OUTSIDE the white ring; its blur
// feathers the seam instead of cutting it hard.
const SHADOW =
  '0px 3px 5px rgba(0,0,0,0.26), 0px 18px 34px rgba(0,0,0,0.18), 0px 0px 2px 1px rgba(0,0,0,0.10)';
// First layer blends the white ring softly into the fill, the other two
// carve the pillow: shaded along the top inner edge, glowing along the
// bottom one.
const INNER =
  'inset 0px 0px 2px rgba(255,255,255,0.9), inset 0px 2px 4px rgba(0,0,0,0.05), inset 0px -3px 6px rgba(255,255,255,1)';

export function ReliefBadge({
  children, style, contentStyle, testID,
}: {
  children: ReactNode;
  /** Placement only (alignSelf, margins); the badge owns its own look. */
  style?: StyleProp<ViewStyle>;
  /** Size and padding overrides for the content box, e.g. a fixed round
      icon badge; colors and relief stay this component's business. */
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    // The shadow lives on this wrapper: the gradient inside must clip
    // itself (overflow hidden), and clipping would swallow its own shadow.
    <View testID={testID} style={[styles.shadow, style]}>
      <LinearGradient colors={SHEEN} locations={SHEEN_STOPS} style={[styles.badge, contentStyle]}>
        <View pointerEvents="none" style={styles.inner} />
        {children}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: { borderRadius: radius.pill, boxShadow: SHADOW },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    overflow: 'hidden',
  },
  // Carries the curvature AND the white ring: the overlay sits above the
  // gradient, so both stay visible on top of it. Inset boxShadow on the
  // gradient itself would be painted over by its native gradient layer.
  inner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
    boxShadow: INNER,
  },
});
