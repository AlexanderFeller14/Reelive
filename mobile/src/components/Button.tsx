import { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Text, View, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { useTheme } from '@/theme/ThemeProvider';
import { motion, radius, spacing, type } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';

// Der Haken blendet mit Scale + Opacity ein (§5: nur transform/opacity),
// per spring-ui, dessen leichtes Überschwingen den «Pop» gratis mitbringt —
// ein hart erscheinender Erfolgshaken läse sich als Sprung, nicht als Moment.
// Eigene Komponente, weil die Einblendung an den MOUNT gebunden ist: sie
// existiert erst, wenn `erfolg` wahr wird, und startet genau dann bei 0.
function ErfolgsHaken({ farbe }: { farbe: string }) {
  const [einblendung] = useState(() => new Animated.Value(0));
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      // §5: alles wird zu 200-ms-Fades.
      Animated.timing(einblendung, {
        toValue: 1,
        duration: 200,
        easing: Easing.bezier(...motion.easeSmooth),
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.spring(einblendung, { toValue: 1, useNativeDriver: true, ...motion.spring }).start();
  }, [einblendung, reducedMotion]);

  return (
    <Animated.View
      testID="button-erfolg"
      style={{
        opacity: einblendung,
        // Bei reduzierter Bewegung nur der Fade, kein Wachsen aus dem Nichts.
        transform: [{ scale: reducedMotion ? 1 : einblendung }],
      }}
    >
      <Check size={22} color={farbe} strokeWidth={1.75} />
    </Animated.View>
  );
}

type Props = {
  variant: 'primary' | 'secondary' | 'text';
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  // Erfolgs-Moment (Speicher-Moment im Namen-Editor): ein Häkchen ersetzt
  // das Label, der Knopf ist gesperrt, behält aber seine Farben — der Moment
  // feiert, er deaktiviert nicht. NIE grün: §1/§7 verbieten Grün als
  // Erfolgsfarbe, das Häkchen steht in der Label-Farbe (primär: on-accent).
  erfolg?: boolean;
};

// DESIGN-LANGUAGE v2 §4: primär = accent-Fläche, sekundär = Outline auf Weiss,
// text = unterstrichener Link in text-1. Genau ein Primär-Button pro Screen.
export function Button({ variant, label, onPress, disabled, loading, erfolg }: Props) {
  const { colors } = useTheme();
  // `erfolg` sperrt wie `blocked`, nimmt aber NICHT die blocked-Farben an
  // (siehe bg/fg unten): ein grauer Erfolgsmoment wäre keiner.
  const blocked = disabled || loading || erfolg;

  return (
    <PressScale
      accessibilityRole="button"
      // `accessibilityLabel` explizit, weil der Text im Ladezustand durch einen
      // ActivityIndicator ersetzt wird, ohne ihn ist der Knopf dann namenlos.
      // `busy` unterscheidet fuer VoiceOver «laedt gerade» von «deaktiviert»,
      // obwohl beide Zustaende hier dieselbe Sperre ausloesen.
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!blocked, busy: !!loading }}
      disabled={!!blocked}
      onPress={() => {
        if (!blocked) onPress();
      }}
    >
      {({ pressed }) => {
        // `erfolg` zählt bei den Farben bewusst nicht als blockiert.
        const gedimmt = blocked && !erfolg;
        const bg =
          variant === 'primary'
            ? gedimmt
              ? colors['bg-1']
              : pressed && !erfolg
                ? colors['accent-pressed']
                : colors.accent
            : variant === 'secondary'
              ? pressed && !gedimmt
                ? colors['bg-1']
                : colors['bg-0']
              : 'transparent';
        const fg =
          variant === 'primary'
            ? gedimmt
              ? colors['text-3']
              : colors['on-accent']
            : gedimmt
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
            {erfolg ? (
              <ErfolgsHaken farbe={fg} />
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
