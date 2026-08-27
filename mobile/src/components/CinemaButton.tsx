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
}: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <PressScale accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={onPress}>
      <View style={styles.button}>
        <Text style={[type.bodyMedium, { color: cinema['bg-0'] }]}>{label}</Text>
      </View>
    </PressScale>
  );
}

// The quiet action next to it: an underlined text-1 link, the cinema twin
// of Button's `text` variant (which is bound to the light palette).
export function CinemaTextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PressScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
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
  link: { color: cinema['text-1'], textDecorationLine: 'underline', textAlign: 'center' },
});
