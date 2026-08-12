import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, motion, palette, radius, spacing, type } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';

type Props = TextInputProps & {
  label: string;
  error?: string;
  // `Sheet` hat seit Task 8 einen `kino`-Schalter (DESIGN-LANGUAGE v2 §1:
  // Medien-Screens nutzen IMMER die feste Kino-Palette, nie `useTheme()`,
  // ThemeProvider ist konstruktionsbedingt light-only, siehe dort). Dieses
  // `Input` sitzt seit Task 12 im Kommentar-Sheet des Recap-Players (einem
  // Kino-Screen) und zog bislang zwingend die Licht-Palette: eine weisse Box
  // mit #222222-Text auf `cinema['bg-1']` (Phase-5-Final-Review, Punkt 4).
  // Gleicher Schalter, gleiches Prinzip wie bei `Sheet`.
  kino?: boolean;
};

// Floating-Label-Input (DESIGN-LANGUAGE v2 §4): Label liegt mittig und
// schrumpft bei Fokus/Inhalt nach oben (150 ms ease-smooth). Fokus-Rand
// 2 px text-1 (bewusst nicht accent), Fehler in danger.
// Abweichung zur Spec: das Label bleibt konstant in type.body.fontFamily,
// weil fontFamily nicht animierbar ist. Die Grösse wird ebenfalls nicht
// direkt animiert (fontSize ist wie fontFamily kein Transform-Property),
// §5 verlangt strikt nur transform/opacity auf dem UI-Thread. Statt top/
// fontSize zu interpolieren, bleibt das Label auf top 17 / fontSize 16
// fixiert und wird per translateY (0 → −9, ergibt visuell top 8) und
// scale (1 → 0.75, ergibt visuell 12 px) verschoben/verkleinert;
// transformOrigin 'left top' hält die linke obere Ecke fest, sodass die
// Skalierung die Oberkante nicht verschiebt, translateY −9 ergibt damit
// exakt top 17 → 8, ohne weitere Kompensation.
export function Input({ label, error, value, placeholder, style, onFocus, onBlur, kino, ...rest }: Props) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const lifted = focused || !!value;
  const [anim] = useState(() => new Animated.Value(lifted ? 1 : 0));
  const reducedMotion = useReducedMotion();

  // Die Animation haengt am abgeleiteten `lifted`, NICHT an den Fokus-Handlern.
  // Vorher trieben nur onFocus/onBlur den Wert, ein programmatisch gesetzter
  // `value` (Prefill des Bearbeiten-Formulars, wiederhergestellter Entwurf,
  // Autofill) hob das Label deshalb nie an, und die Beschriftung lag mitten
  // im bereits ausgefuellten Feld. Als Effekt formuliert deckt eine einzige
  // Stelle alle drei Ausloeser ab: Fokus, Blur und Wertwechsel von aussen.
  useEffect(() => {
    const to = lifted ? 1 : 0;
    // Reduced Motion (§5): Wert direkt setzen statt zu animieren.
    if (reducedMotion) {
      anim.setValue(to);
      return;
    }
    const lauf = Animated.timing(anim, {
      toValue: to,
      duration: motion.duration.fast,
      easing: Easing.bezier(...motion.easeSmooth),
      useNativeDriver: true, // nur transform/scale, UI-Thread (DESIGN-LANGUAGE v2 §5)
    });
    lauf.start();
    return () => lauf.stop();
  }, [lifted, reducedMotion, anim]);

  // Kino übernimmt dieselbe Zuordnung wie Sheet.tsx (Fläche `bg-1`, Text
  // `text-1`, Rand-Ersatz für `line-strong` ist `text-2`, die feste
  // Kino-Palette kennt keine dritte, gedämpftere Textstufe, siehe
  // DESIGN-LANGUAGE §1). `danger` bleibt in BEIDEN Paletten dasselbe fixe
  // Fehler-Rot aus `palette`, kein Teil der Kino-Palette, aber auch nicht
  // Teil der wechselnden Licht-Palette (§1: „Nur Fehler und destruktive
  // Aktionen"), exakt wie `palette.accent`/`on-accent` schon direkt im
  // Kommentar-Sheet dieses Screens wiederverwendet werden (player.tsx,
  // `kommentarSendenKnopf`).
  const flaeche = kino ? cinema['bg-1'] : colors['bg-0'];
  const textFarbe = kino ? cinema['text-1'] : colors['text-1'];
  const labelFarbeFokus = kino ? cinema['text-2'] : colors['text-2'];
  const labelFarbeUnfokus = kino ? cinema['text-2'] : colors['text-3'];
  const randFarbeNormal = kino ? cinema['text-2'] : colors['line-strong'];
  const randFarbeFokus = kino ? cinema['text-1'] : colors['text-1'];
  const borderColor = error ? palette.danger : focused ? randFarbeFokus : randFarbeNormal;
  // Fokus-Rand wird 2 px, Padding kompensiert, damit nichts springt.
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
          backgroundColor: flaeche,
          paddingHorizontal: pad,
        }}
      >
        <Animated.Text
          // Das sichtbare Label und `accessibilityLabel` am TextInput tragen
          // denselben Text, VoiceOver las ihn dadurch zweimal vor, einmal als
          // eigenes Textelement und einmal als Beschriftung des Feldes. Sichtbar
          // bleibt es, hoerbar nur noch einmal, naemlich am Feld selbst.
          importantForAccessibility="no"
          accessibilityElementsHidden
          style={{
            position: 'absolute',
            left: pad,
            top: 17,
            fontSize: type.body.fontSize,
            fontFamily: type.body.fontFamily,
            color: focused ? labelFarbeFokus : labelFarbeUnfokus,
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
          placeholderTextColor={labelFarbeUnfokus}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            // BEWUSST nicht `type.body` als Ganzes: dessen `lineHeight: 24` ist
            // für Fliesstext gedacht und im einzeiligen TextInput schädlich.
            // iOS legt die Glyphen dann an den UNTEREN Rand der Zeilenbox statt
            // in ihre Mitte, der Text hängt sichtbar zu tief im Feld. Familie,
            // Grösse und Ziffernvariante kommen mit, die Zeilenhöhe nicht.
            {
              fontFamily: type.body.fontFamily,
              fontSize: type.body.fontSize,
              fontVariant: type.body.fontVariant,
            },
            // `flex: 1` statt der intrinsischen Höhe, und der Rahmen darüber
            // ohne `justifyContent: 'flex-end'`: sonst ist das Feld nur so hoch
            // wie sein Text und klebt an der Unterkante, und die obere Hälfte
            // des Rahmens, genau dort wo das Label steht, gehört zu keinem
            // Touch-Ziel.
            //
            // Das gehobene Label endet bei 20 (top 8 plus 12 px Schrifthöhe).
            // Der Text sitzt im Raum darunter: iOS zentriert einzeiligen Text
            // zwischen den beiden Paddings, 22 oben und 8 unten legen ihn
            // mittig zwischen Label-Unterkante und Feldboden.
            { color: textFarbe, flex: 1, paddingTop: 22, paddingBottom: 8, paddingHorizontal: 0 },
            style,
          ]}
          {...rest}
        />
      </View>
      {error ? <Text style={[type.secondary, { color: palette.danger }]}>{error}</Text> : null}
    </View>
  );
}
