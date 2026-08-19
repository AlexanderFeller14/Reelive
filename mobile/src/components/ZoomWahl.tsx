import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Pille } from '@/components/Pille';
import { PressScale } from '@/components/PressScale';
import { activeStep, label } from '@/features/camera/zoom';
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
  const aktiv = activeStep(faktor, stufen);

  return (
    <Pille testID="zoom-wahl" style={styles.reihe}>
      {stufen.map((stufe) => {
        const istAktiv = stufe === aktiv;
        // Die aktive Stufe zeigt, wo man wirklich steht (etwa «2,3×»), die
        // anderen ihre eigene Zahl.
        const text = label(istAktiv ? faktor : stufe);
        return (
          <PressScale
            key={stufe}
            accessibilityRole="button"
            accessibilityLabel={`Zoom ${text}`}
            accessibilityState={{ selected: istAktiv }}
            // Die Stufen sind flacher als eine bequeme Druckfläche, also wird
            // sie nach oben und unten erweitert: sichtbar 24, treffbar 48. Zur
            // Seite nicht, dort stossen die Nachbarn an und ihre Flächen
            // überlappten sonst.
            hitSlop={{ top: spacing.m, bottom: spacing.m }}
            onPress={() => {
              // Beiwerk (§5): eine verweigerte Haptik darf den Zoom nie
              // aufhalten, gleiches Muster wie im Auslöser.
              void Haptics.selectionAsync().catch(() => {});
              onWahl(stufe);
            }}
          >
            <View style={styles.stufe}>
              <Text numberOfLines={1} style={[type.label, istAktiv ? styles.textAktiv : styles.text]}>
                {text}
              </Text>
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
  // Flach gehalten: 24 hoch aus dem 4er-Raster (§3), deutlich weniger als die
  // 44 der Steuer-Pillen oben. Die Reihe liegt mitten im Bild und soll es
  // nicht beschweren; da die Stufen keine Fläche mehr tragen, zählt ohnehin
  // nur, wie viel Höhe die Zeile im Bild einnimmt. Die Breite ist eine
  // Untergrenze, damit ein langer Wert («2,3×» während des Pinchs) die Stufe
  // dehnt, statt überzulaufen.
  stufe: {
    minWidth: 32,
    height: 24,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Die aktive Stufe trägt keine gefüllte Scheibe mehr, sondern nur die
  // hellere Schrift — dasselbe Mittel, mit dem die Tab-Bar aktiv von inaktiv
  // trennt (§4). Auf einem Kamerabild ist jede zusätzliche Fläche eine, die
  // das Motiv verdeckt.
  text: { color: cinema['text-2'] },
  textAktiv: { color: cinema['text-1'] },
});
