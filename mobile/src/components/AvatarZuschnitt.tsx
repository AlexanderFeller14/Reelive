import { useState } from 'react';
import {
  Dimensions,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { PressScale } from '@/components/PressScale';
import { cinema, radius, spacing, type } from '@/theme/tokens';
import {
  ausschnittFuer,
  begrenze,
  grundfaktor,
  type Ausschnitt,
  type Blick,
} from '@/features/auth/zuschnitt';

// Der Ersatz für den System-Zuschnitt, den `allowsEditing` mitbrachte. Diese
// Option musste raus (siehe AvatarWaehler): sie erzwingt auf iOS den alten
// UIImagePickerController, der bei grossen Bildern vom System abgeräumt wird.
// Ohne Ersatz wäre das Bild aber ungefragt mittig beschnitten worden, und ein
// Profilbild, dessen Ausschnitt man nicht wählen kann, ist ein Rückschritt.
//
// Kino-Palette statt `useTheme()`: Hier liegt ein Foto ganzflächig, und
// DESIGN-LANGUAGE §1 verlangt für Medien-Screens den dunklen Saal. Gleiches
// Vorgehen wie im Recap-Player.
//
// Gesten von Hand über PanResponder statt über einen Erkenner: dasselbe Muster
// wie Sheet.tsx (Wischen) und der Kamera-Zoom im Sucher. Das Projekt hat
// react-native-gesture-handler zwar als Abhängigkeit, benutzt es aber nirgends
// selbst — ein zweites Gesten-Modell nur für diesen Screen wäre die
// schlechtere Wahl.

const { width: FENSTER_BREITE } = Dimensions.get('window');
// Der Rahmen ist quadratisch und nimmt die Fensterbreite abzüglich der
// Screen-Ränder ein.
const RAHMEN = FENSTER_BREITE - spacing.screen * 2;

const START: Blick = { zoom: 1, versatzX: 0, versatzY: 0 };

function abstand(punkte: { pageX: number; pageY: number }[]): number {
  const dx = punkte[0].pageX - punkte[1].pageX;
  const dy = punkte[0].pageY - punkte[1].pageY;
  return Math.hypot(dx, dy);
}

export function AvatarZuschnitt({
  uri, breite, hoehe, onAbbrechen, onFertig,
}: {
  uri: string;
  breite: number;
  hoehe: number;
  onAbbrechen: () => void;
  onFertig: (ausschnitt: Ausschnitt) => void;
}) {
  const quelle = { breite, hoehe };
  const [blick, setBlick] = useState<Blick>(START);

  // Der Stand beim Beginn einer Geste. Als State und nicht als Ref, weil das
  // Projekt seine Animated-/Gestenwerte seit dem Lint-Durchgang so hält; für
  // die Geste selbst zählt nur, dass der Wert zwischen zwei Ereignissen steht.
  const [start, setStart] = useState<{ blick: Blick; spanne: number | null }>({
    blick: START,
    spanne: null,
  });

  const [pan] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const beruehrungen = evt.nativeEvent.touches;
        setBlick((jetzt) => {
          setStart({
            blick: jetzt,
            spanne: beruehrungen.length >= 2 ? abstand(beruehrungen) : null,
          });
          return jetzt;
        });
      },
      onPanResponderMove: (evt, geste) => {
        const beruehrungen = evt.nativeEvent.touches;
        setStart((s) => {
          // Zwei Finger: zoomen. Der Startabstand wird nachgetragen, wenn der
          // zweite Finger erst während der Geste dazukommt — sonst spränge das
          // Bild im Moment der Berührung.
          if (beruehrungen.length >= 2) {
            const jetztSpanne = abstand(beruehrungen);
            if (s.spanne === null) return { blick: s.blick, spanne: jetztSpanne };
            setBlick(
              begrenze(
                { ...s.blick, zoom: s.blick.zoom * (jetztSpanne / s.spanne) },
                quelle,
                RAHMEN,
              ),
            );
            return s;
          }
          setBlick(
            begrenze(
              {
                zoom: s.blick.zoom,
                versatzX: s.blick.versatzX + geste.dx,
                versatzY: s.blick.versatzY + geste.dy,
              },
              quelle,
              RAHMEN,
            ),
          );
          return s;
        });
      },
    }),
  );

  // Die Darstellung spiegelt exakt das Modell aus zuschnitt.ts: Grundfaktor
  // mal Zoom, dann verschoben. Weicht das hier ab, zeigt der Rahmen etwas
  // anderes als am Ende herauskommt.
  const faktor = grundfaktor(quelle, RAHMEN) * blick.zoom;

  return (
    <View style={styles.flaeche}>
      <View style={styles.mitte}>
        <View testID="zuschnitt-rahmen" style={styles.rahmen} {...pan.panHandlers}>
          <Image
            testID="zuschnitt-bild"
            source={{ uri }}
            style={{
              width: breite * faktor,
              height: hoehe * faktor,
              transform: [
                { translateX: blick.versatzX },
                { translateY: blick.versatzY },
              ],
            }}
            contentFit="fill"
          />
        </View>
        <Text style={[type.secondary, styles.hinweis]}>
          Schieben und mit zwei Fingern zoomen
        </Text>
      </View>

      <View style={styles.knoepfe}>
        <PressScale testID="zuschnitt-abbrechen" accessibilityRole="button" onPress={onAbbrechen}>
          <Text style={[type.bodyMedium, styles.knopfText]}>Abbrechen</Text>
        </PressScale>
        <PressScale
          testID="zuschnitt-uebernehmen"
          accessibilityRole="button"
          onPress={() => onFertig(ausschnittFuer(blick, quelle, RAHMEN))}
        >
          <Text style={[type.bodyMedium, styles.knopfTextStark]}>Übernehmen</Text>
        </PressScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flaeche: {
    // `absoluteFill`, nicht `absoluteFillObject`: Letzteres gibt es in dieser
    // React-Native-Fassung nicht mehr (0.86), und `absoluteFill` ist hier ein
    // schlichtes, spreadbares Objekt — dieselbe Stelle wie in Sheet.tsx.
    ...StyleSheet.absoluteFill,
    backgroundColor: cinema['bg-0'],
    justifyContent: 'space-between',
  },
  mitte: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.l },
  // Rund, nicht eckig: Der Rahmen zeigt genau das, was später im Avatar-Kreis
  // steht. Ein eckiger Rahmen liesse Ecken mitwählen, die nie zu sehen sind.
  rahmen: {
    width: RAHMEN,
    height: RAHMEN,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: cinema['bg-1'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  hinweis: { color: cinema['text-2'] },
  knoepfe: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.l,
  },
  knopfText: { color: cinema['text-2'], paddingVertical: spacing.m },
  knopfTextStark: { color: cinema['text-1'], paddingVertical: spacing.m },
});
