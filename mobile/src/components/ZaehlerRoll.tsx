import { Animated, StyleSheet, Text, View } from 'react-native';
import { palette, type } from '@/theme/tokens';

type Props = {
  von: number;
  nach: number;
  // Der eine Zeitgeber der Inszenierung (0 → 1), dieselbe Konstruktion wie in
  // Versiegelung.tsx: diese Komponente bringt keinen eigenen Timer mit,
  // `fenster` sagt, in welchem Anteil davon gerollt wird.
  fortschritt: Animated.Value;
  fenster: readonly [number, number];
};

// Wie weit Ziffern beim Rollen wandern. Eine Bewegungsstrecke, keine Distanz
// zwischen zwei Flächen, darum ausserhalb des 4er-Rasters erlaubt (gleiche
// benannte Ausnahme wie FUNKEN_AUFSTIEG in RevealInszenierung.tsx).
const ROLLWEG = 28;

// Der Zähler-Digit-Roll (DESIGN-LANGUAGE §5: «Zähler = Digit-Roll»): nur die
// Stellen, die sich wirklich ändern, rollen (alte Ziffer schiebt nach oben
// hinaus, neue kommt von unten herein), unveränderte Stellen stehen fest.
// Beide Zahlen werden rechtsbündig übereinandergelegt (Einer auf Einer),
// damit 9 → 10 die Einerstelle 9 → 0 rollt und die neue Zehnerstelle allein
// hereinkommt, statt dass «9» als Ganzes gegen «10» getauscht wird.
export function ZaehlerRoll({ von, nach, fortschritt, fenster }: Props) {
  const laenge = Math.max(String(von).length, String(nach).length);
  const alt = String(von).padStart(laenge, ' ');
  const neu = String(nach).padStart(laenge, ' ');
  const [start, ende] = fenster;

  const altOpacity = fortschritt.interpolate({
    inputRange: [start, ende],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const altY = fortschritt.interpolate({
    inputRange: [start, ende],
    outputRange: [0, -ROLLWEG],
    extrapolate: 'clamp',
  });
  const neuOpacity = fortschritt.interpolate({
    inputRange: [start, ende],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const neuY = fortschritt.interpolate({
    inputRange: [start, ende],
    outputRange: [ROLLWEG, 0],
    extrapolate: 'clamp',
  });

  return (
    // Fürs Vorlesen ist das EINE Zahl (der neue Stand), nicht zwei Ziffern
    // pro rollender Stelle.
    <View
      style={styles.zeile}
      accessible
      accessibilityLabel={String(nach)}
      importantForAccessibility="yes"
    >
      {Array.from(neu, (neuZiffer, i) => {
        const altZiffer = alt[i];
        if (altZiffer === neuZiffer) {
          return (
            <Text key={i} testID={`zaehler-ziffer-fest-${i}`} style={styles.ziffer}>
              {neuZiffer}
            </Text>
          );
        }
        return (
          <View key={i}>
            <Animated.Text
              testID={`zaehler-ziffer-neu-${i}`}
              style={[styles.ziffer, { opacity: neuOpacity, transform: [{ translateY: neuY }] }]}
            >
              {neuZiffer}
            </Animated.Text>
            {/* Vorher gab es diese Stelle womöglich gar nicht (9 → 10): dann
                rollt die neue Ziffer allein herein, ein gerendertes
                Leerzeichen hätte mit tabular-nums trotzdem Ziffernbreite und
                würde die Zahl sichtbar verschieben. */}
            {altZiffer !== ' ' && (
              <Animated.Text
                testID={`zaehler-ziffer-alt-${i}`}
                style={[
                  styles.ziffer,
                  styles.altUeberlagert,
                  { opacity: altOpacity, transform: [{ translateY: altY }] },
                ]}
              >
                {altZiffer}
              </Animated.Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  zeile: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  ziffer: {
    ...type.display,
    color: palette['text-1'],
  },
  // Alte und neue Ziffer sind mit tabular-nums exakt gleich breit, die neue
  // Ziffer trägt das Layout, die alte liegt deckungsgleich darüber.
  altUeberlagert: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
