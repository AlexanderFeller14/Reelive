import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Pill } from '@/components/Pill';
import { PressScale } from '@/components/PressScale';
import { activeStep, label } from '@/features/camera/zoom';
import { cinema, radius, spacing, type } from '@/theme/tokens';

type Props = {
  /** Displayed factors, ascending, they come from the device, see zoom.ts. */
  steps: number[];
  /** The current factor, even between two steps. */
  factor: number;
  onSelect: (step: number) => void;
};

// The zoom row above the shutter. Built like in the Camera app: a
// translucent row where the current step sits as a filled circle and
// carries the live factor while the pinch runs.
//
// The row itself is the pill (DESIGN-LANGUAGE §1: `overlay-pill` + blur),
// the active step within it gets a SOLID fill, nothing shows through an
// opaque surface, so no second pill there (see the note in Pill.tsx,
// precedent: `emojiPillActive` in the recap player).
export function ZoomSelector({ steps, factor, onSelect }: Props) {
  const active = activeStep(factor, steps);

  return (
    <Pill testID="zoom-selector" style={styles.row}>
      {steps.map((step) => {
        const isActive = step === active;
        // The active step shows where you actually stand (e.g. "2,3×"), the
        // others show their own number.
        const text = label(isActive ? factor : step);
        return (
          <PressScale
            key={step}
            accessibilityRole="button"
            accessibilityLabel={`Zoom ${text}`}
            accessibilityState={{ selected: isActive }}
            // The steps are flatter than a comfortable press target, so it's
            // extended up and down: visible 24, tappable 48. Not sideways,
            // where the neighbors abut and their areas would otherwise
            // overlap.
            hitSlop={{ top: spacing.m, bottom: spacing.m }}
            onPress={() => {
              // Garnish (§5): a denied haptic must never hold up the zoom,
              // same pattern as in the shutter.
              void Haptics.selectionAsync().catch(() => {});
              onSelect(step);
            }}
          >
            <View style={styles.step}>
              <Text numberOfLines={1} style={[type.label, isActive ? styles.textActive : styles.text]}>
                {text}
              </Text>
            </View>
          </PressScale>
        );
      })}
    </Pill>
  );
}

const styles = StyleSheet.create({
  // No `backgroundColor`, the pill sets that itself.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.xs,
    borderRadius: radius.pill,
  },
  // Kept flat: 24 tall from the 4-pt grid (§3), noticeably less than the 44
  // of the control pills above. The row sits in the middle of the image and
  // shouldn't weigh it down; since the steps no longer carry a filled disc
  // anyway, only how much height the row takes up in the image matters. The
  // width is a lower bound, so a long value ("2,3×" during the pinch)
  // stretches the step instead of overflowing.
  step: {
    minWidth: 32,
    height: 24,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The active step no longer carries a filled disc, only the lighter text,
  // the same device the tab bar uses to separate active from inactive (§4).
  // On a camera image, every extra surface is one more thing covering the
  // subject.
  text: { color: cinema['text-2'] },
  textActive: { color: cinema['text-1'] },
});
