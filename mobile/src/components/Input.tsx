import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, motion, palette, radius, spacing, type } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';

type Props = TextInputProps & {
  label: string;
  error?: string;
  // `Sheet` has had a `cinemaMode` switch since Task 8 (DESIGN-LANGUAGE v2
  // §1: media screens ALWAYS use the fixed cinema palette, never
  // `useTheme()`, ThemeProvider is light-only by construction, see there).
  // Since Task 12, this `Input` sits in the recap player's comment sheet
  // (a cinema screen) and used to unconditionally pull the light palette: a
  // white box with #222222 text on `cinema['bg-1']` (Phase-5 final review,
  // point 4). Same switch, same principle as with `Sheet`.
  cinemaMode?: boolean;
};

// Floating-label input (DESIGN-LANGUAGE v2 §4): label sits centered and
// shrinks upward on focus/content (150 ms ease-smooth). Focus border 2 px
// text-1 (deliberately not accent), error in danger.
// Deviation from the spec: the label stays constant in
// type.body.fontFamily, because fontFamily isn't animatable. The size
// also isn't animated directly (fontSize, like fontFamily, isn't a
// transform property), §5 strictly requires only transform/opacity on the
// UI thread. Instead of interpolating top/fontSize, the label stays fixed
// at top 17 / fontSize 16 and is shifted/shrunk via translateY (0 -> -9,
// visually resulting in top 8) and scale (1 -> 0.75, visually resulting
// in 12 px); transformOrigin 'left top' keeps the top-left corner fixed,
// so the scaling doesn't shift the top edge, translateY -9 thus results
// in exactly top 17 -> 8, without further compensation.
export function Input({ label, error, value, placeholder, style, onFocus, onBlur, cinemaMode, ...rest }: Props) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const lifted = focused || !!value;
  const [anim] = useState(() => new Animated.Value(lifted ? 1 : 0));
  const reducedMotion = useReducedMotion();

  // The animation is tied to the derived `lifted`, NOT to the focus
  // handlers. Previously only onFocus/onBlur drove the value, so a
  // programmatically set `value` (prefill of the edit form, a restored
  // draft, autofill) never lifted the label, and the caption sat in the
  // middle of an already-filled field. Formulated as an effect, a single
  // spot covers all three triggers: focus, blur, and an external value
  // change.
  useEffect(() => {
    const to = lifted ? 1 : 0;
    // Reduced motion (§5): set the value directly instead of animating.
    if (reducedMotion) {
      anim.setValue(to);
      return;
    }
    const timingAnimation = Animated.timing(anim, {
      toValue: to,
      duration: motion.duration.fast,
      easing: Easing.bezier(...motion.easeSmooth),
      useNativeDriver: true, // only transform/scale, UI thread (DESIGN-LANGUAGE v2 §5)
    });
    timingAnimation.start();
    return () => timingAnimation.stop();
  }, [lifted, reducedMotion, anim]);

  // Cinema takes over the same mapping as Sheet.tsx (surface `bg-1`, text
  // `text-1`, the border substitute for `line-strong` is `text-2`, the
  // fixed cinema palette has no third, more muted text level, see
  // DESIGN-LANGUAGE §1). `danger` stays the same fixed error red from
  // `palette` in BOTH palettes, not part of the cinema palette, but also
  // not part of the changing light palette (§1: "only errors and
  // destructive actions"), exactly like `palette.accent`/`on-accent` are
  // already reused directly in this screen's comment sheet (player.tsx,
  // `kommentarSendenKnopf`).
  const surface = cinemaMode ? cinema['bg-1'] : colors['bg-0'];
  const textColor = cinemaMode ? cinema['text-1'] : colors['text-1'];
  const labelColorFocused = cinemaMode ? cinema['text-2'] : colors['text-2'];
  const labelColorUnfocused = cinemaMode ? cinema['text-2'] : colors['text-3'];
  const borderColorDefault = cinemaMode ? cinema['text-2'] : colors['line-strong'];
  const borderColorFocused = cinemaMode ? cinema['text-1'] : colors['text-1'];
  const borderColor = error ? palette.danger : focused ? borderColorFocused : borderColorDefault;
  // The focus border becomes 2 px, padding compensates so nothing jumps.
  const pad = focused ? spacing.base - 1 : spacing.base;

  return (
    <View style={{ gap: spacing.xs }}>
      <View
        testID="input-rahmen"
        style={{
          height: 56,
          borderWidth: focused ? 2 : 1,
          borderColor,
          borderRadius: radius.control,
          backgroundColor: surface,
          paddingHorizontal: pad,
        }}
      >
        <Animated.Text
          // The visible label and the `accessibilityLabel` on the
          // TextInput carry the same text, VoiceOver used to read it out
          // twice because of that, once as its own text element and once
          // as the field's caption. It stays visible, audible only once
          // now, namely at the field itself.
          importantForAccessibility="no"
          accessibilityElementsHidden
          style={{
            position: 'absolute',
            left: pad,
            top: 17,
            fontSize: type.body.fontSize,
            fontFamily: type.body.fontFamily,
            color: focused ? labelColorFocused : labelColorUnfocused,
            transformOrigin: 'left top',
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
          placeholderTextColor={labelColorUnfocused}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            // DELIBERATELY not `type.body` as a whole: its `lineHeight: 24`
            // is meant for flowing text and is harmful in the single-line
            // TextInput. iOS then places the glyphs at the BOTTOM edge of
            // the line box instead of centering them, the text visibly
            // hangs too low in the field. Family, size, and figure variant
            // come along, the line height doesn't.
            {
              fontFamily: type.body.fontFamily,
              fontSize: type.body.fontSize,
              fontVariant: type.body.fontVariant,
            },
            // `flex: 1` instead of the intrinsic height, and the frame
            // above without `justifyContent: 'flex-end'`: otherwise the
            // field is only as tall as its text and sticks to the bottom
            // edge, and the top half of the frame, exactly where the label
            // sits, belongs to no touch target.
            //
            // The lifted label ends at 20 (top 8 plus 12 px text height).
            // The text sits in the space below it: iOS centers single-line
            // text between the two paddings, 22 on top and 8 on the bottom
            // place it centered between the label's bottom edge and the
            // field's floor.
            { color: textColor, flex: 1, paddingTop: 22, paddingBottom: 8, paddingHorizontal: 0 },
            style,
          ]}
          {...rest}
        />
      </View>
      {error ? <Text style={[type.secondary, { color: palette.danger }]}>{error}</Text> : null}
    </View>
  );
}
