import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Pille } from '@/components/Pille';
import { cinema, radius, spacing } from '@/theme/tokens';

// DESIGN-LANGUAGE v2 §5: „linear ist verboten (Ausnahme: Fortschritt, der
// reale Zeit abbildet)." Dieser Balken ist GENAU diese Ausnahme, er bildet
// die tatsächlich vergangene Anzeigedauer eines Moments im Story-Player ab,
// keine UI-Übergangsanimation. NICHT auf `ease-smooth` „korrigieren".
const FORTSCHRITT_EASING = Easing.linear;

// Dünner Strich, kein eigener Radius-Sonderfall nötig, die Kappen kommen
// aus `radius.pill` (§3: genau 12/24/999).
const BALKEN_HOEHE = 3;

type Props = {
  /** Gesamtzahl der Momente in der Filmrolle, ein Segment pro Moment. */
  anzahl: number;
  /** Index des gerade gezeigten Moments (0-basiert). */
  aktivIndex: number;
  /** Gesamtdauer des aktiven Moments in ms (playerLogic.dauerFuer). */
  dauerMs: number;
  /**
   * Bereits vergangene Zeit des aktiven Moments in ms, 0 bei einem frisch
   * begonnenen Moment, sonst der beim Pausieren eingefrorene Stand
   * (PlayerStand.fortschritt). Der Balken beginnt bei diesem Anteil und
   * läuft von dort in Echtzeit weiter, statt bei jedem Wieder-Aufsetzen von
   * vorn zu füllen.
   */
  vergangenMs: number;
  pausiert: boolean;
};

// Ein Segment pro Moment, das aktive füllt sich in Echtzeit (Task-11-Brief,
// Schritt 1). Nur EIN Animated.Value für das jeweils aktive Segment: bei
// hunderten Momenten wäre ein Value pro Segment unnötiger Ballast, jedes
// andere Segment ist ohnehin nur statisch voll oder leer, die Animation
// läuft rein über `transform: scaleX` mit `transformOrigin: 'left'`
// (dasselbe Muster wie Input.tsx), bleibt damit auf dem UI-Thread
// (`useNativeDriver: true`) und verstösst nicht gegen "nur transform/opacity"
// (§5), anders als der Kreisring in Ausloeser.tsx, der dafür `strokeDashoffset`
// als begründete Ausnahme braucht, kommt ein horizontaler Balken ganz ohne
// Sonderweg aus.
export function Fortschrittsbalken({ anzahl, aktivIndex, dauerMs, vergangenMs, pausiert }: Props) {
  const [aktivAnteil] = useState(() => new Animated.Value(0));

  useEffect(() => {
    aktivAnteil.stopAnimation();
    const start = dauerMs > 0 ? Math.min(1, Math.max(0, vergangenMs / dauerMs)) : 1;
    aktivAnteil.setValue(start);
    // Pausiert oder bereits fertig: hier stehen bleiben, nicht weiterlaufen.
    if (pausiert || start >= 1) return;
    Animated.timing(aktivAnteil, {
      toValue: 1,
      duration: Math.max(0, dauerMs - vergangenMs),
      easing: FORTSCHRITT_EASING,
      useNativeDriver: true,
    }).start();
    return () => aktivAnteil.stopAnimation();
  }, [aktivIndex, dauerMs, vergangenMs, pausiert, aktivAnteil]);

  return (
    <View style={styles.reihe} testID="fortschrittsbalken">
      {Array.from({ length: anzahl }).map((_, i) => (
        // Task 10, Phase 6: eine eigene `Pille` (Blur + Tönung) PRO Segment,
        // nicht eine einzige über die ganze Zeile, das erhält exakt die
        // bestehende Optik (jedes Segment einzeln als abgerundete Pille mit
        // sichtbarer Lücke dazwischen, DESIGN-LANGUAGE §4 "Pill-Control").
        // Bekannter Kompromiss bei SEHR grossen `anzahl` (siehe Kommentar zu
        // `aktivAnteil` oben, "hunderte Momente"): das sind dann ebenso
        // viele native Blur-Ebenen nebeneinander, ein Performance-Effekt,
        // der sich nur am Gerät beurteilen lässt (Spec §10), hier bewusst
        // nicht vorab "optimiert" (eine gemeinsame Blur-Fläche würde die
        // Lücken zwischen den Segmenten mittönen und die Optik ändern).
        <Pille key={i} style={styles.spur} testID={`fortschritt-segment-${i}`}>
          {i < aktivIndex && <View testID={`fortschritt-voll-${i}`} style={styles.fuellungStatisch} />}
          {i === aktivIndex && (
            <Animated.View
              testID="fortschritt-aktiv"
              style={[
                styles.fuellungStatisch,
                { transform: [{ scaleX: aktivAnteil }], transformOrigin: 'left' },
              ]}
            />
          )}
        </Pille>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  reihe: { flexDirection: 'row', gap: spacing.xs },
  spur: {
    flex: 1,
    height: BALKEN_HOEHE,
    borderRadius: radius.pill,
  },
  fuellungStatisch: { flex: 1, backgroundColor: cinema['text-1'] },
});
