import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { cinema } from '@/theme/tokens';

type Props = {
  children?: ReactNode;
  /** Shape (radius, size, padding, positioning), NEVER backgroundColor, this component owns that. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
  pointerEvents?: ViewProps['pointerEvents'];
};

// DESIGN-LANGUAGE §1: "On photos, UI sits exclusively as a translucent
// pill: rgba(19,17,16,0.55) + blur 10." Until Task 10 (Phase 6) the blur
// was missing everywhere, `expo-blur` wasn't installed, every spot carried
// a comment "without a real blur". This component bundles the recipe ONCE
// instead of repeating it at ~20 spots (aufnehmen/, recap/, teilen/,
// progress bars) one by one, each copy would be another chance to let the
// blur value or the tint drift slightly.
//
// intensity=50 is both expo-blur's own default AND yields exactly
// `blur(10px)` on web (BlurView.web.tsx: `blur(${Math.min(intensity,100)*0.2}px)`,
// i.e. 50*0.2=10), the same figure "blur 10" from the design language,
// without needing a platform-specific conversion. On iOS it produces the
// documented system blur, which can't be visually verified in the app-wide
// reference environment here; on Android expo-blur, per its own docs,
// falls back to a plain-colored surface anyway (no native blur API), which
// is exactly why the tint layer below guarantees the right color
// REGARDLESS of whether the blur actually takes effect.
const INTENSITY = 50;

// The tint sits as its OWN layer above the blur, not as BlurView's own
// `style.backgroundColor`, the latter would (see the BlurView source) sit
// BEHIND the native blur layer and get tinted by the system blur material
// (softening, brightening). A separate, opaque layer ON TOP guarantees
// exactly `rgba(19,17,16,0.55)`, platform-independent, with or without an
// actually effective blur underneath.
const tint: ViewStyle = { ...StyleSheet.absoluteFill, backgroundColor: cinema['overlay-pill'] };
const base: ViewStyle = { overflow: 'hidden' }; // needed so the blur actually clips at a rounded edge.

// Replaces a plain `<View style={styles.xPill}>` everywhere DESIGN-LANGUAGE
// §1/§4 calls for a translucent pill. `style` remains the existing shape
// declaration (radius, padding, dimensions, positioning), only
// `backgroundColor: cinema['overlay-pill']` drops out there, this
// component owns that now. Do NOT use this for an ACTIVE/selected pill
// with a solid fill (e.g. `emojiPillActive`), that needs no blur, nothing
// shows through an opaque surface.
export function Pill({ children, style, testID, accessibilityLabel, pointerEvents }: Props) {
  return (
    <BlurView
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      pointerEvents={pointerEvents}
      intensity={INTENSITY}
      tint="dark"
      style={[base, style]}
    >
      <View style={tint} pointerEvents="none" />
      {children}
    </BlurView>
  );
}
