import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Pille } from '@/components/Pille';
import { PressScale } from '@/components/PressScale';
import { aktiveStufe, beschriftung } from '@/features/kamera/zoom';
import { cinema, radius, spacing, type } from '@/theme/tokens';

type Props = {
  /** Angezeigte Faktoren, aufsteigend — sie kommen vom Gerät, siehe zoom.ts. */
  stufen: number[];
  /** Der geltende Faktor, auch zwischen zwei Stufen. */
  faktor: number;
  onWahl: (stufe: number) => void;
};

// Die Zoom-Reihe über dem Auslöser. Aufbau wie in der Kamera-App: eine
// translucente Reihe, in der die geltende Stufe als gefüllter Kreis steht und
// den laufenden Faktor trägt, während der Pinch läuft.
//
// Die Reihe selbst ist die Pille (DESIGN-LANGUAGE §1: `overlay-pill` + Blur),
// die aktive Stufe darin bekommt eine SOLIDE Füllung — durch eine deckende
// Fläche scheint nichts hindurch, deshalb dort keine zweite Pille (siehe den
// Hinweis in Pille.tsx, Präzedenz: `emojiPilleAktiv` im Recap-Player).
export function ZoomWahl({ stufen, faktor, onWahl }: Props) {
  const aktiv = aktiveStufe(faktor, stufen);

  return (
    <Pille testID="zoom-wahl" style={styles.reihe}>
      {stufen.map((stufe) => {
        const istAktiv = stufe === aktiv;
        // Die aktive Stufe zeigt, wo man wirklich steht (etwa «2,3×»), die
        // anderen ihre eigene Zahl.
        const text = beschriftung(istAktiv ? faktor : stufe);
        return (
          <PressScale
            key={stufe}
            accessibilityRole="button"
            accessibilityLabel={`Zoom ${text}`}
            accessibilityState={{ selected: istAktiv }}
            onPress={() => {
              // Beiwerk (§5): eine verweigerte Haptik darf den Zoom nie
              // aufhalten, gleiches Muster wie im Auslöser.
              void Haptics.selectionAsync().catch(() => {});
              onWahl(stufe);
            }}
          >
            <View style={[styles.stufe, istAktiv && styles.stufeAktiv]}>
              <Text style={[type.label, istAktiv ? styles.textAktiv : styles.text]}>{text}</Text>
            </View>
          </PressScale>
        );
      })}
    </Pille>
  );
}

const styles = StyleSheet.create({
  // Kein `backgroundColor` — den setzt die Pille selbst.
  reihe: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.xs,
    borderRadius: radius.pill,
  },
  // 44 ist die Mindestgrösse einer Druckfläche und zugleich das Mass der
  // Steuer-Pillen oben im Sucher. Kein Abstand dazwischen: die Kreise stossen
  // aneinander, wie in der Kamera-App, und die Druckflächen überlappen sich
  // dadurch nicht.
  stufe: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stufeAktiv: { backgroundColor: cinema['text-1'] },
  text: { color: cinema['text-1'] },
  // Auf heller Füllung kehrt sich der Kontrast um.
  textAktiv: { color: cinema['bg-0'] },
});
