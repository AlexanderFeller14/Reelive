import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { cinema } from '@/theme/tokens';

type Props = {
  children?: ReactNode;
  /** Form (Radius, Grösse, Padding, Positionierung), NIE backgroundColor, das übernimmt diese Komponente. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
  pointerEvents?: ViewProps['pointerEvents'];
};

// DESIGN-LANGUAGE §1: «Auf Fotos liegt UI ausschliesslich als translucente
// Pille: rgba(19,17,16,0.55) + Blur 10.» Bis Task 10 (Phase 6) fehlte der
// Blur überall, `expo-blur` war nicht installiert, jede Stelle hatte einen
// Kommentar «ohne echten Blur». Diese Komponente bündelt das Rezept EINMAL,
// statt es an ~20 Stellen (aufnehmen/, recap/, teilen/, Fortschrittsbalken)
// einzeln zu wiederholen, jede Kopie wäre eine weitere Chance, den Blur-
// Wert oder die Tönung leicht abweichen zu lassen.
//
// intensity=50 ist zugleich expo-blurs eigener Default UND ergibt auf Web
// exakt `blur(10px)` (BlurView.web.tsx: `blur(${Math.min(intensity,100)*0.2}px)`,
// also 50*0.2=10), dieselbe Zahl "Blur 10" aus der Design-Sprache, ohne
// dass eine plattformspezifische Umrechnung nötig wäre. Auf iOS bewirkt sie
// den in der App-weiten Referenzumgebung nicht sichtbar prüfbaren, aber
// dokumentierten Systemblur; auf Android liefert expo-blur laut eigener
// Doku ohnehin nur eine einfarbige Ersatzfläche (kein natives Blur-API),
// dafür sorgt die Tönungsebene unten UNABHÄNGIG vom Blur-Erfolg für die
// exakt richtige Farbe.
const INTENSITAET = 50;

// Die Tönung liegt als EIGENE Ebene über dem Blur, nicht als BlurViews
// eigene `style.backgroundColor`, letztere würde (siehe BlurView-Quelltext)
// HINTER der nativen Blur-Ebene liegen und vom System-Blur-Material
// (Weichzeichnung, Aufhellung) verfärbt. Eine eigene, deckende Ebene DARÜBER
// garantiert exakt `rgba(19,17,16,0.55)`, plattformunabhängig, mit oder
// ohne tatsächlich wirksamen Blur darunter.
const toenung: ViewStyle = { ...StyleSheet.absoluteFill, backgroundColor: cinema['overlay-pill'] };
const basis: ViewStyle = { overflow: 'hidden' }; // nötig, damit der Blur an einem gerundeten Rand tatsächlich clippt.

// Ersetzt ein einfaches `<View style={styles.xPille}>` überall dort, wo
// DESIGN-LANGUAGE §1/§4 eine translucente Pille verlangt. `style` bleibt die
// bisherige Form-Deklaration (Radius, Padding, Dimensionen, Positionierung),
// nur `backgroundColor: cinema['overlay-pill']` fällt dort weg, das
// übernimmt diese Komponente. NICHT verwenden für eine AKTIVE/ausgewählte
// Pille mit solider Füllung (z.B. `emojiPilleAktiv`), die braucht keinen
// Blur, nichts scheint durch eine deckende Fläche hindurch.
export function Pille({ children, style, testID, accessibilityLabel, pointerEvents }: Props) {
  return (
    <BlurView
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      pointerEvents={pointerEvents}
      intensity={INTENSITAET}
      tint="dark"
      style={[basis, style]}
    >
      <View style={toenung} pointerEvents="none" />
      {children}
    </BlurView>
  );
}
