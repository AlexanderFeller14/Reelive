import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { motion, radius, shadow, spacing, type } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';

const REDUZIERTE_DAUER_MS = 200;
// Grosszügig ausserhalb des sichtbaren Bereichs: die tatsächliche Sheet-Höhe hängt
// vom Inhalt ab (Task 12 legt z. B. eine Kommentarliste hinein) — dieser Wert muss
// nur «sicher jenseits jeder realistischen Höhe» sein, keine echte Distanz.
const AUSGANGSPOSITION = 640;
// Wisch-Schwelle: entweder ein ausreichend weiter Weg oder ein schneller Flick
// schliesst das Sheet — unabhängig von der (inhaltsabhängigen) Höhe des Panels.
const WISCH_WEG_SCHWELLE = 96;
const WISCH_GESCHWINDIGKEIT_SCHWELLE = 0.5;

// Reine Entscheidung, ohne PanResponder/Animated drumherum — so bleibt sie ohne
// simulierte Touch-Events direkt testbar (gleiches Prinzip wie queueLogic.ts:
// Entscheidung von Mechanik getrennt).
export function wischUeberSchwelle(dy: number, vy: number): boolean {
  return dy > WISCH_WEG_SCHWELLE || vy > WISCH_GESCHWINDIGKEIT_SCHWELLE;
}

type Props = {
  sichtbar: boolean;
  titel?: string;
  onSchliessen: () => void;
  children: ReactNode;
};

// Erste Sheet-Komponente des Projekts (DESIGN-LANGUAGE §4): von unten, Radius 24
// oben, Grabber, shadow-3, öffnet per spring-ui. Wiederverwendet in Task 12
// (Kommentare) — deshalb bewusst allgemein (nur Titel + beliebiger Inhalt), ohne
// Extras wie eine eigene ScrollView oder eine feste Maximalhöhe, die dort nicht
// gebraucht würden.
//
// Schliessen läuft anders als das Öffnen OHNE eigene Austrittsanimation: ein Tipp
// auf den Hintergrund oder ein ausreichender Wisch nach unten ruft sofort
// `onSchliessen`. Das Sheet verschwindet, sobald die aufrufende Stelle `sichtbar`
// auf false setzt — derselbe Kontrollfluss wie bei den Alert.alert-Dialogen in
// reise/[id]/index.tsx: der Elternteil hält den Zustand, die Komponente selbst
// bleibt zustandslos bezüglich «geschlossen wird gerade animiert». Ein Wisch, der
// nicht über die Schwelle kommt, federt zurück statt zu schliessen.
//
// prefers-reduced-motion (§5): keine Verschiebung, nur ein 200-ms-Opacity-Fade —
// für Panel und Hintergrund gemeinsam über denselben Animated.Value.
export function Sheet({ sichtbar, titel, onSchliessen, children }: Props) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const translateY = useRef(new Animated.Value(AUSGANGSPOSITION)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  // onSchliessen kann sich zwischen zwei Renderns ändern (neue Funktionsreferenz
  // beim Elternteil) — ein Ref hält die aktuelle Version fest, ohne den
  // PanResponder bei jedem Render neu aufzubauen (gleiches Muster wie
  // Versiegelung.onFertigRef).
  const onSchliessenRef = useRef(onSchliessen);
  onSchliessenRef.current = onSchliessen;

  useEffect(() => {
    if (!sichtbar) return;
    opacity.setValue(0);
    if (reducedMotion) {
      translateY.setValue(0);
      Animated.timing(opacity, {
        toValue: 1,
        duration: REDUZIERTE_DAUER_MS,
        useNativeDriver: true,
      }).start();
    } else {
      translateY.setValue(AUSGANGSPOSITION);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, ...motion.spring }),
        Animated.timing(opacity, { toValue: 1, duration: motion.duration.base, useNativeDriver: true }),
      ]).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sichtbar, reducedMotion]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, geste) => geste.dy > 4 && Math.abs(geste.dy) > Math.abs(geste.dx),
      onPanResponderMove: (_evt, geste) => {
        if (geste.dy > 0) translateY.setValue(geste.dy);
      },
      onPanResponderRelease: (_evt, geste) => {
        if (wischUeberSchwelle(geste.dy, geste.vy)) {
          onSchliessenRef.current();
          return;
        }
        if (reducedMotion) {
          translateY.setValue(0);
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, ...motion.spring }).start();
        }
      },
    })
  ).current;

  if (!sichtbar) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        testID="sheet-backdrop"
        accessibilityRole="button"
        accessibilityLabel="Schliessen"
        style={StyleSheet.absoluteFill}
        onPress={onSchliessen}
      >
        <Animated.View style={[StyleSheet.absoluteFill, styles.hintergrund, { opacity }]} />
      </Pressable>
      <Animated.View
        style={[styles.panel, { backgroundColor: colors['bg-0'], opacity, transform: [{ translateY }] }]}
      >
        {/* Nur der Griffbereich ist wischbar — der Rest bleibt frei für Inhalt wie
            Listen oder Eingabefelder (Task 12), die eigene Touch-Gesten brauchen. */}
        <View testID="sheet-griff-bereich" style={styles.griffBereich} {...pan.panHandlers}>
          <View style={[styles.griff, { backgroundColor: colors['line-strong'] }]} />
          {titel ? <Text style={[type.h3, { color: colors['text-1'] }]}>{titel}</Text> : null}
        </View>
        <View style={styles.inhalt}>{children}</View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  hintergrund: { backgroundColor: 'rgba(0,0,0,0.4)' },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingBottom: spacing.xl,
    ...shadow.s3,
  },
  griffBereich: { alignItems: 'center', paddingTop: spacing.m, paddingBottom: spacing.base, gap: spacing.base },
  griff: { width: 36, height: 4, borderRadius: radius.pill },
  inhalt: { paddingHorizontal: spacing.screen, gap: spacing.base },
});
