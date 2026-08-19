import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { placeholderCover } from '@/features/trips/placeholderCover';

// Das Cover einer Reise (DESIGN-LANGUAGE v2 §4): 3:2, Radius 24, randlos,
// ohne Schatten. Steht an zwei Stellen — auf der Reise-Karte in den Listen
// und ganz oben im Reise-Detail —, deshalb hier einmal statt zweimal.
//
// Echte Trip-Cover gibt es noch nicht. Bis dahin steht hier ein Platzhalter,
// wo vorher eine leere `bg-1`-Fläche stand: `position` ist der Platz der Karte
// in ihrer Liste und wählt das Bild (siehe `platzhalterCover`), damit nicht
// zwei gleiche Cover untereinander stehen. Das Reise-Detail reicht denselben
// Platz über den `cover`-Parameter seiner Route herein. Ohne Angabe bleibt es
// beim ersten Bild.
//
// `bg-1` bleibt als Grund darunter liegen, damit die Fläche beim Dekodieren
// nicht weiss aufblitzt. Die Bilder sind 16:9 und werden auf 3:2 beschnitten
// (`cover`), links und rechts fallen je rund 8 % weg — bei beiden steht das
// Motiv weit genug innen, um das zu überstehen. Das Bild sagt nichts, was der
// Titel darunter nicht schon sagt, also `accessible={false}`.
export function TripCover({
  position = 0, versiegelt = false, children,
}: {
  position?: number;
  versiegelt?: boolean;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    // Zwei Ebenen statt einer: Das Siegel überlappt die Cover-Ecke und muss
    // deshalb ausserhalb des beschneidenden Containers hängen. Läge es innen,
    // schnitte dessen `overflow: hidden` genau den überstehenden Teil ab.
    <View>
      <View style={[styles.cover, { backgroundColor: colors['bg-1'] }]}>
        <Image
          testID="reise-cover"
          source={placeholderCover(position)}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          accessible={false}
        />
        <View style={styles.auflage}>{children}</View>
      </View>
      {versiegelt && (
        // Die Versiegelung zeigt das Wachssiegel selbst, nicht mehr die Pille
        // mit dem Wort «Versiegelt». Auf einem Foto hätte die helle
        // `bg-1`-Pille ohnehin keinen verlässlichen Grund mehr gehabt (§1: auf
        // Fotos liegt UI nur als translucente Pille), das Siegel bringt seinen
        // eigenen mit. Für Screenreader steht das Wort weiterhin da, als Label
        // des Bildes — das Siegel ist keine Dekoration, es trägt den Zustand
        // der Reise.
        <Image
          testID="wachssiegel"
          source={require('@/assets/images/rotes-brief-wachssiegel-transparent.png')}
          style={styles.siegel}
          contentFit="contain"
          accessibilityRole="image"
          accessibilityLabel="Versiegelt"
        />
      )}
    </View>
  );
}

// Gut ein Drittel der Cover-Höhe: das Siegel ist der Zustand der Reise, kein
// Abzeichen am Rand, und trägt sein Relief erst in dieser Grösse.
const SIEGEL = 80;

// Wie weit es über die Ecke hinaussteht. Fester Wert statt eines Anteils der
// Siegelgrösse, weil ihn nicht das Siegel begrenzt, sondern das, was daneben
// liegt: links der 24-px-Screen-Rand, oben die Sektionsüberschrift mit ihren
// 24 px Abstand. 16 lässt zu beiden hin 8 px Luft.
const UEBERSTAND = 16;

const styles = StyleSheet.create({
  // `overflow: hidden` ist hier nicht kosmetisch: ohne es stünde das absolut
  // gefüllte Cover-Bild über die abgerundeten Ecken hinaus.
  cover: { aspectRatio: 3 / 2, borderRadius: radius.card, overflow: 'hidden' },
  auflage: { flex: 1, padding: spacing.m, alignItems: 'flex-start' },
  siegel: {
    position: 'absolute',
    top: -UEBERSTAND,
    left: -UEBERSTAND,
    width: SIEGEL,
    height: SIEGEL,
  },
});
