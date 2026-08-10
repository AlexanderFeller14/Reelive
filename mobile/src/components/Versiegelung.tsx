import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { cinema, motion, radius } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';

const REDUZIERTE_DAUER_MS = 200;

type Props = {
  sichtbar: boolean;
  onFertig: () => void;
};

// Eine der zwei ausdrücklich erlaubten Inszenierungen (DESIGN-LANGUAGE v2 §5):
// «Moment schrumpft in die Filmrolle, Siegel schliesst mit Gold-Glow, Zähler
// rollt hoch. Haptik: success.» Die Feinoptik (Filmrolle, Zähler-Digit-Roll)
// gehört Task 12, dieser Baustein liefert die abgesicherte Mechanik: Haptik
// feuert genau einmal beim Start, `onFertig` kommt zuverlässig nach der Dauer,
// animiert wird ausschliesslich `transform`/`opacity` mit `useNativeDriver`
// (UI-Thread), `prefers-reduced-motion` verkürzt auf einen 200-ms-Fade.
export function Versiegelung({ sichtbar, onFertig }: Props) {
  const reducedMotion = useReducedMotion();
  const fortschritt = useRef(new Animated.Value(0)).current;
  // Ref statt direkter Closure: `onFertig` darf sich zwischen Start und Ende
  // der Animation ändern (neue Funktionsreferenz bei jedem Render des
  // Elternteils), ohne dass das die laufende Animation neu anstösst.
  const onFertigRef = useRef(onFertig);
  onFertigRef.current = onFertig;
  // Fix-Runde 1: der Effekt hängt (nötigerweise) auch an `reducedMotion`, weil
  // die Dauer davon abhängt, ändert sich die Systemeinstellung, während die
  // Inszenierung schon läuft (sichtbar bleibt true), lief der Effekt bisher
  // erneut und feuerte die Haptik ein zweites Mal für dasselbe Siegel. Dieser
  // Ref merkt sich «für dieses sichtbar=true schon gefeuert» unabhängig vom
  // Effekt-Neustart und wird nur zurückgesetzt, wenn die Inszenierung wieder
  // unsichtbar wird.
  const haptikGefeuertRef = useRef(false);

  useEffect(() => {
    if (!sichtbar) {
      fortschritt.setValue(0);
      haptikGefeuertRef.current = false;
      return;
    }

    // Haptik feuert genau einmal, beim Start der Inszenierung (§5: success
    // beim Versiegeln). .catch(): reines Beiwerk, darf das Versiegeln selbst
    // nie stören (gleiches Muster wie Ausloeser.leichtesFeedback).
    if (!haptikGefeuertRef.current) {
      haptikGefeuertRef.current = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }

    const dauer = reducedMotion ? REDUZIERTE_DAUER_MS : motion.duration.feature;
    fortschritt.setValue(0);
    // Die Optik läuft mit useNativeDriver auf dem UI-Thread (§5) und damit
    // unabhängig vom JS-Thread, ihr eigener Abschluss-Callback ist darum
    // aber KEIN verlässlicher Zeitgeber für `onFertig` (auf einem Gerät ohne
    // aktives natives Animated-Modul, z. B. in Tests, meldet er sich sofort
    // statt nach `dauer`). Gleiches Prinzip wie Ausloeser.tsx: die sichtbare
    // Animation und der Zeitgeber für die Folge-Aktion laufen getrennt.
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
    inputRange: [0, 0.2, 1],
    outputRange: [0, 1, 1],
  });
  const momentScale = fortschritt.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.15],
  });
  const momentOpacity = fortschritt.interpolate({
    inputRange: [0, 0.6, 0.8],
    outputRange: [1, 1, 0],
  });
  const siegelOpacity = fortschritt.interpolate({
    inputRange: [0, 0.55, 0.7, 1],
    outputRange: [0, 0, 1, 1],
  });
  const siegelScale = fortschritt.interpolate({
    inputRange: [0.55, 0.7, 1],
    outputRange: [0.6, 1.15, 1],
    extrapolateLeft: 'clamp',
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="versiegelung">
      <Animated.View style={[StyleSheet.absoluteFill, styles.hintergrund, { opacity: scrimOpacity }]} />
      <View style={[StyleSheet.absoluteFill, styles.mitte]}>
        <Animated.View style={{ opacity: momentOpacity, transform: [{ scale: momentScale }] }}>
          <View style={styles.filmrolle} />
        </Animated.View>
        <Animated.View
          style={[styles.siegel, { opacity: siegelOpacity, transform: [{ scale: siegelScale }] }]}
        >
          <Lock size={40} color={cinema['seal-glow']} strokeWidth={1.75} />
        </Animated.View>
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
  filmrolle: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: cinema['bg-1'],
  },
  siegel: {
    position: 'absolute',
  },
});
