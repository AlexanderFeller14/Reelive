import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Play } from 'lucide-react-native';
import { Pille } from '@/components/Pille';
import { useTheme } from '@/theme/ThemeProvider';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { cinema, motion, radius, shadow, spacing, type } from '@/theme/tokens';
import type { RecapMoment } from '@/features/recap/types';

// Die Nadel auf der Recap-Karte (Spec §5.4): keine Stecknadel, sondern das
// runde Thumbnail des Moments — dieselbe Formsprache wie die Avatare
// (DESIGN-LANGUAGE §4: rund, 2 px weisser Ring). Sie beantwortet «was war
// hier?» ohne einen einzigen Tipp.
//
// Der Screen (karte.tsx) hängt sie als Kind in einen `Marker`. Damit gehört
// sie zu den wenigen Komponenten, deren Aussehen NICHT laufend nachgezeichnet
// wird: react-native-maps friert die Nadel ein, sobald `tracksViewChanges`
// auf false steht. `onBereit` ist die Antwort darauf — siehe unten.

// 44 px inklusive Ring, wie der grösste Avatar (§4). Der Ring liegt als
// `borderWidth` INNEN, genau wie in Avatar.tsx.
const GROESSE = 44;
const RING = 2;
// Das Play-Zeichen sitzt in einer translucenten Pille (§1) — 20 px ist die
// kleinste Fläche, in der ein 12-px-Icon nicht klebt.
const VIDEO_PILLE = 20;
const ZAEHLER = 20;

type Props = {
  moment: RecapMoment;
  /** Bild-URL aus dem Vorrat; `null`, solange keine da ist. */
  thumbUrl: string | null;
  /** Momente in der Gruppe. 1 (der Normalfall) zeigt keine Zahl. */
  anzahl?: number;
  /**
   * Meldet, dass die Nadel fertig aussieht und sich nichts mehr ändert.
   * karte.tsx schaltet daraufhin `tracksViewChanges` ab. Ohne URL kommt die
   * Meldung nie — der Skeleton pulst weiter und muss weiter gezeichnet werden.
   */
  onBereit?: () => void;
};

// Skeleton nach §4: `bg-1`-Fläche mit Opacity-Puls 0.6 ↔ 1.0, NIE ein
// Gradient-Shimmer. Bewusst dieselbe Mechanik wie `SkelettBlock` in
// uebersicht.tsx (dort privat) — hier als Kreis statt als Block. Die zwei
// Stellen zu einer geteilten Komponente zusammenzuziehen, wäre ein eigener
// Umbau an einem Screen, den dieser Task nicht anfasst.
function SkelettKreis() {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(0.8);
      return;
    }
    const puls = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: motion.duration.gentle, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.6, duration: motion.duration.gentle, useNativeDriver: true }),
      ])
    );
    puls.start();
    return () => puls.stop();
  }, [reducedMotion, opacity]);

  return (
    <Animated.View
      testID="nadel-skelett"
      style={[StyleSheet.absoluteFill, { backgroundColor: colors['bg-1'], opacity }]}
    />
  );
}

export function KartenNadel({ moment, thumbUrl, anzahl = 1, onBereit }: Props) {
  const { colors } = useTheme();

  return (
    // Das Polster ist kein Weissraum, sondern Platz: die Zähler-Pille ragt über
    // den Kreis hinaus, und Android schneidet ein Marker-View an seinen eigenen
    // Rändern ab. Weil es auf allen Seiten gleich ist, bleibt der Kreis im
    // Mittelpunkt des Views — und damit auf seiner Koordinate.
    <View style={styles.aussen}>
      <View style={[styles.rahmen, { borderColor: colors['bg-0'], backgroundColor: colors['bg-1'] }]}>
        {/* Der Beschnitt sitzt eine Ebene TIEFER als der Schatten: `overflow:
            hidden` und `shadow.s2` am selben View schneiden auf iOS auch den
            Schatten weg (masksToBounds). */}
        <View style={styles.beschnitt}>
          {thumbUrl ? (
            // Bewusst OHNE `transition` (anders als die Kacheln in
            // uebersicht.tsx): der Marker zeichnet die Nadel ein letztes Mal,
            // wenn `tracksViewChanges` abschaltet — und das passiert direkt
            // auf `onLoad`. Ein Einblenden liefe zu diesem Zeitpunkt noch,
            // und eingefroren würde das halb durchsichtige Bild.
            <Image
              testID="nadel-bild"
              source={{ uri: thumbUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              onLoad={onBereit}
              onError={onBereit}
            />
          ) : (
            <SkelettKreis />
          )}

          {moment.type === 'video' && (
            <View style={[StyleSheet.absoluteFill, styles.videoMitte]} pointerEvents="none">
              <Pille testID="nadel-video" style={styles.videoPille}>
                <Play size={12} color={cinema['text-1']} strokeWidth={1.75} />
              </Pille>
            </View>
          )}
        </View>
      </View>

      {/* Zähler-Pille der Gruppe (Spec §5.5). Eine Gruppe von einem ist keine
          Gruppe — sie trägt keine «1». */}
      {anzahl > 1 && (
        <View style={[styles.zaehler, { backgroundColor: colors.accent }]}>
          <Text style={[type.label, styles.zaehlerText, { color: colors['on-accent'] }]}>{String(anzahl)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  aussen: { padding: spacing.s, alignItems: 'center', justifyContent: 'center' },
  rahmen: {
    width: GROESSE,
    height: GROESSE,
    borderRadius: radius.pill,
    borderWidth: RING,
    ...shadow.s2,
  },
  beschnitt: { flex: 1, borderRadius: radius.pill, overflow: 'hidden' },
  videoMitte: { alignItems: 'center', justifyContent: 'center' },
  videoPille: {
    width: VIDEO_PILLE,
    height: VIDEO_PILLE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zaehler: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: ZAEHLER,
    height: ZAEHLER,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // §2: Zahlen immer tabular-nums — eine «11» soll nicht schmaler sein als
  // eine «44», sonst wackelt die Pille zwischen zwei Zoomstufen.
  zaehlerText: { fontVariant: ['tabular-nums'] },
});
