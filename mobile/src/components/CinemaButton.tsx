import { StyleSheet, Text, View } from 'react-native';
import { PressScale } from './PressScale';
import { cinema, radius, spacing, type } from '@/theme/tokens';

// The solid button of the media screens (DESIGN-LANGUAGE v2 §1): a light
// text-1 surface with a dark label instead of the accent, so it does not
// compete with the picture underneath. It used to live as two identical
// copies in recap/[id]/player.tsx and share/[token].tsx; the library-import
// sheets would have been the third.
export function CinemaButton({
  label,
  onPress,
  testID,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  // Keeps the button in place but inert (the review screen with nothing
  // left to submit): dimmed surface, no press, told to VoiceOver.
  disabled?: boolean;
}) {
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      testID={testID}
      onPress={() => {
        if (!disabled) onPress();
      }}
    >
      <View style={[styles.button, disabled && styles.buttonDisabled]}>
        <Text style={[type.bodyMedium, { color: disabled ? cinema['text-2'] : cinema['bg-0'] }]}>
          {label}
        </Text>
      </View>
    </PressScale>
  );
}

// The quiet action next to it: an underlined text-1 link, the cinema twin
// of Button's `text` variant (which is bound to the light palette).
export function CinemaTextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      // The label text itself is shorter than the 44 pt minimum touch
      // target (design-language-v2 §8 Accessibility), so the hit area
      // grows past its visible bounds instead of leaving the actual tap
      // target too small.
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
    >
      <Text style={[type.bodyMedium, styles.link]}>{label}</Text>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
    backgroundColor: cinema['text-1'],
  },
  buttonDisabled: { backgroundColor: cinema['bg-1'] },
  link: { color: cinema['text-1'], textDecorationLine: 'underline', textAlign: 'center' },
});
