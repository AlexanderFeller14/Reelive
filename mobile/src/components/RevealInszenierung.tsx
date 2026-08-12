import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Lock, LockOpen, Sparkle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { cinema, motion } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';

const REDUZIERTE_DAUER_MS = 200;

type Props = {
  sichtbar: boolean;
  onFertig: () => void;
};

// Fünf Funken mit leicht versetztem Start («Streuung»), damit sie nicht als
// ein einziger Klumpen aufsteigen, jeder liest trotzdem von DEMSELBEN
// `fortschritt`-Wert ab, es gibt also weiterhin genau einen Zeitgeber (siehe
// Kommentar unten, gleiches Prinzip wie Versiegelung.tsx).
//
// Review Major 1: `versatzX`/`versatzY` werden UNTEN bewusst über `transform`
// (translateX/translateY) ausgedrückt, nie über `left`/`top`. Der Elternteil
// (`styles.mitte`) zentriert per `alignItems`/`justifyContent: 'center'`,
// aber sobald ein Kind mit `position: 'absolute'` einen Inset (`left`/`top`/
// `right`/`bottom`) gesetzt bekommt, gewinnt in Yoga IMMER der Inset über die
// Ausrichtung des Elternteils (react-native/ReactCommon/yoga/yoga/algorithm/
// AbsoluteLayout.cpp: `justifyAbsoluteChild`/`alignAbsoluteChild` laufen nur,
// wenn KEIN Inset gesetzt ist). Mit `left`/`top` sassen alle fünf Funken
// relativ zur oberen linken Ecke des ganzen Bildschirms statt ums Siegel
// verteilt, nur `transform` einzusetzen ist hier also nicht bloss näher an
// §5 («nur transform und opacity»), sondern die einzige Art, wie die
// Zentrierung des Elternteils überhaupt erhalten bleibt.
//
// `versatzX`/`versatzY` liegen auf dem 4er-Raster aus §3 (auch wenn es hier
// um eine Bewegungs- statt eine Layout-Distanz geht), FUNKEN_AUFSTIEG unten
// ist die einzige benannte Ausnahme davon.
const FUNKEN = [
  { versatzX: -48, versatzY: 8, startVersatz: 0 },
  { versatzX: -24, versatzY: -16, startVersatz: 0.07 },
  { versatzX: 8, versatzY: 12, startVersatz: 0.02 },
  { versatzX: 24, versatzY: -12, startVersatz: 0.1 },
  { versatzX: 48, versatzY: 4, startVersatz: 0.05 },
] as const;

// Wie viele Pixel die Funken über ihren Startpunkt steigen. Bewusst
// ausserhalb der §3-Werte {4,8,12,16,24,32,48} belassen: das ist eine
// Bewegungsstrecke, keine Distanz zwischen zwei Flächen, die einzige
// Ausnahme in dieser Datei, darum hier benannt statt stillschweigend.
const FUNKEN_AUFSTIEG = 96;

// Die zweite der zwei ausdrücklich erlaubten Inszenierungen (DESIGN-LANGUAGE
// v2 §5): «Siegel bricht auf, Gold-Funken ✦ steigen (kein Konfetti). Haptik:
// success.» Aufbau bewusst identisch zu Versiegelung.tsx (Vorbild laut
// Task-9-Brief): ein einzelner Animated.Value treibt Scrim, Siegel- und
// Funken-Choreografie zugleich, die Haptik feuert genau einmal pro
// sichtbar=true (Ref statt State, ein Neustart des Effekts z. B. durch
// einen Wechsel von `reducedMotion` mitten in der Inszenierung darf sie
// nicht doppelt feuern), `onFertig` kommt über einen eigenen `setTimeout`,
// weil die UI-Thread-Animation selbst keinen verlässlichen Zeitgeber für
// Folge-Aktionen abgibt (in Tests ohne aktives natives Animated-Modul löst
// ihr eigener Abschluss-Callback sofort aus statt nach `dauer`). Animiert
// wird ausschliesslich `transform`/`opacity` mit `useNativeDriver`,
// `prefers-reduced-motion` verkürzt auf einen 200-ms-Fade.
export function RevealInszenierung({ sichtbar, onFertig }: Props) {
  const reducedMotion = useReducedMotion();
  const [fortschritt] = useState(() => new Animated.Value(0));
  const onFertigRef = useRef(onFertig);
  onFertigRef.current = onFertig;
  const haptikGefeuertRef = useRef(false);

  useEffect(() => {
    if (!sichtbar) {
      fortschritt.setValue(0);
      haptikGefeuertRef.current = false;
      return;
    }

    if (!haptikGefeuertRef.current) {
      haptikGefeuertRef.current = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }

    const dauer = reducedMotion ? REDUZIERTE_DAUER_MS : motion.duration.feature;
    fortschritt.setValue(0);
    const animation = Animated.timing(fortschritt, {
      toValue: 1,
      duration: dauer,
      useNativeDriver: true,
    });
    animation.start();
    const timer = setTimeout(() => onFertigRef.current(), dauer);

    // Aufräumen bei Unmount/erneutem Effekt-Lauf: eine laufende Animation
    // darf nach dem Verlassen des Screens kein onFertig mehr an eine
    // verschwundene Komponente feuern.
    return () => {
      clearTimeout(timer);
      animation.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sichtbar, reducedMotion]);

  if (!sichtbar) return null;

  const scrimOpacity = fortschritt.interpolate({
    inputRange: [0, 0.15, 1],
    outputRange: [0, 1, 1],
  });
  // Das geschlossene Siegel: kurz sichtbar, dann bricht es auf, ein knapper
  // Scale-Pop statt eines einfachen Verschwindens.
  const siegelOpacity = fortschritt.interpolate({
    inputRange: [0, 0.25, 0.4],
    outputRange: [1, 1, 0],
    extrapolateRight: 'clamp',
  });
  const siegelScale = fortschritt.interpolate({
    inputRange: [0, 0.25, 0.4],
    outputRange: [1, 1, 1.3],
    extrapolateRight: 'clamp',
  });
  // Das offene Siegel kommt danach herein, mit demselben Bounce wie
  // Versiegelung.tsx (0.6 → 1.15 → 1), visuelles Gegenstück zum Schliessen.
  const aufOpacity = fortschritt.interpolate({
    inputRange: [0.3, 0.45, 1],
    outputRange: [0, 1, 1],
    extrapolateLeft: 'clamp',
  });
  const aufScale = fortschritt.interpolate({
    inputRange: [0.3, 0.45, 0.6, 1],
    outputRange: [0.6, 1.15, 1, 1],
    extrapolateLeft: 'clamp',
  });

  return (
    // Review Minor: ANDERS als Versiegelung.tsx (wo darunter nur die
    // Aufnahme-Vorschau liegt) deckt dieser Overlay im Reise-Detail
    // tippbare, teils destruktive Aktionen ab («Reise löschen», «Reise
    // bearbeiten», Mitglied-entfernen-Kreuze). `pointerEvents="none"` liesse
    // Tipps während der ganzen Inszenierung ungehindert durch den blickdicht
    // wirkenden Overlay auf diese Flächen durch, deshalb hier ausdrücklich
    // "auto" (blockiert alles darunter), statt wie dort "none".
    <View style={StyleSheet.absoluteFill} pointerEvents="auto" testID="reveal-inszenierung">
      <Animated.View style={[StyleSheet.absoluteFill, styles.hintergrund, { opacity: scrimOpacity }]} />
      <View style={[StyleSheet.absoluteFill, styles.mitte]}>
        <Animated.View style={[styles.icon, { opacity: siegelOpacity, transform: [{ scale: siegelScale }] }]}>
          <Lock size={40} color={cinema['seal-glow']} strokeWidth={1.75} />
        </Animated.View>
        <Animated.View style={[styles.icon, { opacity: aufOpacity, transform: [{ scale: aufScale }] }]}>
          <LockOpen size={40} color={cinema['seal-glow']} strokeWidth={1.75} />
        </Animated.View>
        {FUNKEN.map((funke, i) => {
          // Jeder Funke bekommt sein eigenes Zeitfenster innerhalb von
          // `fortschritt`, verschoben um `startVersatz`, dieselbe Idee wie
          // die gestaffelten Listen-Animationen in DESIGN-LANGUAGE §5 (Stagger
          // 40 ms), nur hier als Anteil derselben 700–900-ms-Inszenierung
          // statt eigener Timer.
          const start = 0.3 + funke.startVersatz;
          const funkeOpacity = fortschritt.interpolate({
            inputRange: [start, start + 0.15, start + 0.35, 1],
            outputRange: [0, 1, 1, 0],
            extrapolateLeft: 'clamp',
          });
          // Startet bei `versatzY` (der kleinen vertikalen Streuung) und
          // steigt von dort `FUNKEN_AUFSTIEG` Pixel weiter auf, beides über
          // `translateY`, nicht `top` (siehe Kommentar bei FUNKEN oben).
          const funkeTranslateY = fortschritt.interpolate({
            inputRange: [start, 1],
            outputRange: [funke.versatzY, funke.versatzY - FUNKEN_AUFSTIEG],
            extrapolateLeft: 'clamp',
          });
          return (
            <Animated.View
              key={i}
              style={[
                styles.funke,
                {
                  opacity: funkeOpacity,
                  // `translateX` ist hier ein fester Wert (keine Animation),
                  // reiner horizontaler Versatz, kombiniert mit dem
                  // animierten `translateY` im selben Array.
                  transform: [{ translateX: funke.versatzX }, { translateY: funkeTranslateY }],
                },
              ]}
            >
              <Sparkle size={16} color={cinema['seal-glow']} strokeWidth={1.75} />
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hintergrund: {
    backgroundColor: cinema['bg-0'],
  },
  mitte: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    position: 'absolute',
  },
  funke: {
    position: 'absolute',
  },
});
