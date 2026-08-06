import { useRef, useState } from 'react';
import { Animated, Easing, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { motion, radius, spacing, type } from '@/theme/tokens';

type Props = TextInputProps & { label: string; error?: string };

// Floating-Label-Input (DESIGN-LANGUAGE v2 §4): Label liegt mittig und
// schrumpft bei Fokus/Inhalt nach oben (150 ms ease-smooth). Fokus-Rand
// 2 px text-1 (bewusst nicht accent), Fehler in danger.
// Abweichung zur Spec: das Label bleibt konstant in Figtree_400Regular,
// weil fontFamily nicht animierbar ist. Die Grösse wird ebenfalls nicht
// direkt animiert (fontSize ist wie fontFamily kein Transform-Property) —
// §5 verlangt strikt nur transform/opacity auf dem UI-Thread. Statt top/
// fontSize zu interpolieren, bleibt das Label auf top 17 / fontSize 16
// fixiert und wird per translateY (0 → −9, ergibt visuell top 8) und
// scale (1 → 0.75, ergibt visuell 12 px) verschoben/verkleinert;
// transformOrigin 'left center' hält die linke Kante beim Schrumpfen fest.
export function Input({ label, error, value, placeholder, style, onFocus, onBlur, ...rest }: Props) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const lifted = focused || !!value;
  const anim = useRef(new Animated.Value(lifted ? 1 : 0)).current;

  const animate = (to: number) =>
    Animated.timing(anim, {
      toValue: to,
      duration: motion.duration.fast,
      easing: Easing.bezier(...motion.easeSmooth),
      useNativeDriver: true, // nur transform/scale — UI-Thread (DESIGN-LANGUAGE v2 §5)
    }).start();

  const borderColor = error ? colors.danger : focused ? colors['text-1'] : colors['line-strong'];
  // Fokus-Rand wird 2 px — Padding kompensiert, damit nichts springt.
  const pad = focused ? spacing.base - 1 : spacing.base;

  return (
    <View style={{ gap: spacing.xs }}>
      <View
        style={{
          height: 56,
          borderWidth: focused ? 2 : 1,
          borderColor,
          borderRadius: radius.control,
          backgroundColor: colors['bg-0'],
          justifyContent: 'flex-end',
          paddingHorizontal: pad,
        }}
      >
        <Animated.Text
          style={{
            position: 'absolute',
            left: pad,
            top: 17,
            fontSize: type.body.fontSize,
            fontFamily: 'Figtree_400Regular',
            color: focused ? colors['text-2'] : colors['text-3'],
            transformOrigin: 'left center',
            transform: [
              { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -9] }) },
              { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.75] }) },
            ],
          }}
        >
          {label}
        </Animated.Text>
        <TextInput
          accessibilityLabel={label}
          value={value}
          placeholder={lifted ? placeholder : undefined}
          placeholderTextColor={colors['text-3']}
          onFocus={(e) => {
            setFocused(true);
            animate(1);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            if (!value) animate(0);
            onBlur?.(e);
          }}
          style={[
            type.body,
            { color: colors['text-1'], paddingTop: 0, paddingBottom: 8, paddingHorizontal: 0 },
            style,
          ]}
          {...rest}
        />
      </View>
      {error ? <Text style={[type.secondary, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}
