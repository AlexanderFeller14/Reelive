import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Marker } from 'react-native-maps';
import { Play } from 'lucide-react-native';
import { Pille } from '@/components/Pille';
import { useTheme } from '@/theme/ThemeProvider';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { cinema, motion, radius, shadow, spacing, type } from '@/theme/tokens';
import type { RecapMoment } from '@/features/recap/types';
import { zeitInZone } from '@/features/recap/uhrzeit';
import type { KartenPunkt } from '@/features/karte/typen';

// Die Nadel auf der Recap-Karte (Spec §5.4): keine Stecknadel, sondern das
// runde Thumbnail des Moments — dieselbe Formsprache wie die Avatare
// (DESIGN-LANGUAGE §4: rund, 2 px weisser Ring). Sie beantwortet «was war
// hier?» ohne einen einzigen Tipp.
//
// Zwei Komponenten in einer Datei, weil sie eine Regel teilen:
// `KartenNadel` ist das Aussehen, `KartenNadelMarker` setzt es auf die Karte
// und entscheidet, wann es aufhören darf, sich zu zeichnen. Diese Entscheidung
// hängt daran, WAS die Nadel gerade zeigt — sie zu trennen hiesse, dieselbe
// Frage an zwei Orten zu beantworten.

// 44 px inklusive Ring, wie der grösste Avatar (§4). Der Ring liegt als
// `borderWidth` INNEN, genau wie in Avatar.tsx.
const GROESSE = 44;
const RING = 2;
// Das Play-Zeichen sitzt in einer translucenten Pille (§1) — 20 px ist die
// kleinste Fläche, in der ein 12-px-Icon nicht klebt.
const VIDEO_PILLE = 20;
const ZAEHLER = 20;

type NadelProps = {
  moment: RecapMoment;
  /** Bild-URL aus dem Vorrat; `null`, wenn es keine brauchbare gibt. */
  thumbUrl: string | null;
  /** Momente in der Gruppe. 1 (der Normalfall) zeigt keine Zahl. */
  anzahl?: number;
  /**
   * Meldet, dass die Nadel fertig aussieht und sich von selbst nichts mehr
   * ändert. `KartenNadelMarker` schaltet daraufhin `tracksViewChanges` ab.
   * Wird auch erneut gemeldet, wenn sich das Aussehen geändert hat und der
   * neue Stand steht — siehe `nadelAbbild`.
   */
  onBereit?: () => void;
};

// Alles, was das Aussehen der Nadel bestimmt, als EIN Wert. Beide Komponenten
// bilden ihn mit dieser Funktion: die Nadel, um zu wissen, wann sie ihren
// Fertig-Stand neu melden muss, und der Marker, um zu wissen, ob der gemeldete
// Stand noch der aktuelle ist. Zwei getrennte Formeln liefen früher oder
// später auseinander — und die Karte zeigte ein Bild, das nicht mehr gilt.
function nadelAbbild(moment: RecapMoment, thumbUrl: string | null, anzahl: number): string {
  return `${moment.type}|${anzahl}|${thumbUrl ?? ''}`;
}

// Der Kreis unter dem Bild. `puls` unterscheidet die beiden Gründe, aus denen
// er zu sehen ist:
//
// - `true`: es ist ein Bild unterwegs (§4 Skeleton, Opacity-Puls 0.6 ↔ 1.0,
//   NIE ein Gradient-Shimmer). Der Puls ist das Versprechen «gleich kommt was».
// - `false`: es kommt nichts mehr. Dann pulst hier auch nichts — eine stille
//   `bg-1`-Fläche, wie ein Avatar ohne Bild.
//
// Bewusst dieselbe Mechanik wie `SkelettBlock` in uebersicht.tsx (dort
// privat), hier als Kreis statt als Block.
function SkelettKreis({ puls }: { puls: boolean }) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (!puls) {
      opacity.setValue(1);
      return;
    }
    if (reducedMotion) {
      opacity.setValue(0.8);
      return;
    }
    const schleife = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: motion.duration.gentle, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.6, duration: motion.duration.gentle, useNativeDriver: true }),
      ])
    );
    schleife.start();
    return () => schleife.stop();
  }, [puls, reducedMotion, opacity]);

  return (
    <Animated.View
      testID="nadel-skelett"
      style={[StyleSheet.absoluteFill, { backgroundColor: colors['bg-1'], opacity }]}
    />
  );
}

export function KartenNadel({ moment, thumbUrl, anzahl = 1, onBereit }: NadelProps) {
  const { colors } = useTheme();

  // Nicht «ist geladen», sondern «WELCHE URL ist geladen»: bei einem Wechsel
  // der Quelle (der Vorrat erneuert seine Signaturen, bevor sie ablaufen) ist
  // der alte Ladestand wertlos, und der Skeleton muss zurückkommen. Als
  // blosses Boolean bräuchte es dafür einen Effekt, der es zurücksetzt — und
  // der käme in der Reihenfolge der Effekte dem Fertig-Melden in die Quere.
  const [geladeneUrl, setGeladeneUrl] = useState<string | null>(null);
  const bildSteht = thumbUrl !== null && geladeneUrl === thumbUrl;

  // Ohne Bildquelle wartet die Nadel auf nichts: ihr Aussehen steht sofort
  // fest. Meldete sie sich hier nie, zeichnete der Marker sie für immer bei
  // jedem Frame neu (Fixrunde 1, Punkt 3).
  const fertig = thumbUrl === null || bildSteht;
  const abbild = nadelAbbild(moment, thumbUrl, anzahl);

  const bildDa = useCallback(() => setGeladeneUrl(thumbUrl), [thumbUrl]);

  // `abbild` gehört in die Abhängigkeiten, nicht nur `fertig`: ändert sich die
  // Zähler-Pille oder das Play-Zeichen, während das Bild längst steht, feuert
  // sonst nichts mehr — und der Marker zeichnete den neuen Stand nie.
  useEffect(() => {
    if (fertig) onBereit?.();
  }, [fertig, abbild, onBereit]);

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
          {/* Der Kreis liegt UNTER dem Bild, nicht darüber, und beide sind
              gleichzeitig gemountet. Das ist kein Zufall: react-native-maps
              zeichnet die Nadel ein letztes Mal, wenn `tracksViewChanges`
              abschaltet — und das passiert im selben Commit, in dem der Kreis
              verschwindet. Läge er oben, entschiede die Reihenfolge zweier
              nativer Operationen darüber, ob das eingefrorene Bild den Kreis
              noch trägt. Unten ist die Frage gegenstandslos: das geladene Foto
              deckt ihn ohnehin vollständig ab. */}
          {!bildSteht && <SkelettKreis puls={thumbUrl !== null} />}

          {thumbUrl !== null && (
            // Bewusst OHNE `transition` (anders als die Kacheln in
            // uebersicht.tsx): ein laufendes Einblenden würde im letzten
            // Zeichnen halb durchsichtig eingefroren.
            <Image
              testID="nadel-bild"
              source={{ uri: thumbUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              onLoad={bildDa}
              onError={bildDa}
            />
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

// Nach dem Rastern ist die Nadel für VoiceOver EIN Element — was innen steht,
// ist dann nicht mehr erreichbar. Die Beschriftung gehört deshalb an den
// Marker, nicht in die Nadel. Form wie in uebersicht.tsx («Moment 3 öffnen»),
// nur mit dem, was hier bekannt ist: Autor und Uhrzeit — und für eine Gruppe
// ihre Anzahl statt eines einzelnen Moments.
function nadelBeschriftung(moment: RecapMoment, anzahl: number): string {
  if (anzahl > 1) return `${anzahl} Momente an diesem Ort öffnen`;
  const uhrzeit = zeitInZone(moment.captured_at, moment.captured_tz);
  return `Moment von ${moment.autor_name} um ${uhrzeit} öffnen`;
}

type MarkerProps = {
  punkt: KartenPunkt;
  thumbUrl: string | null;
  anzahl?: number;
  /**
   * Tipp auf die Nadel. Bekommt den Punkt zurück, den sie darstellt (bei einer
   * Gruppe deren Anker) — statt eine fertige Aktion einzupacken. Nur so kann
   * der Screen EINE unveränderliche Funktion an alle Nadeln geben; ein
   * `() => tuWas(gruppe)` wäre bei jedem Rendern eine neue und machte das
   * `memo` unten wirkungslos.
   */
  onPress?: (punkt: KartenPunkt) => void;
};

// Die Nadel auf der Karte. `tracksViewChanges` ist die Stelle, an der dieser
// Screen technisch kippt — der Wert sagt react-native-maps, ob es die Nadel
// weiter nachzeichnen soll:
//
// - dauerhaft `true`: jede Nadel wird bei jedem Frame neu gerendert; ab einer
//   Handvoll Nadeln ruckelt die Karte sichtbar.
// - dauerhaft `false`: die Nadel friert in dem Zustand ein, den sie beim
//   ersten Zeichnen hatte. Das Bild kommt aber erst danach aus dem Netz —
//   stehen bliebe also der leere Kreis, für immer.
//
// Der gemeldete Fertig-Stand wird deshalb nicht als Ja/Nein gehalten, sondern
// als das Abbild, FÜR DAS er gilt. Ändert sich irgendeine sichtbare
// Eigenschaft — neue Bildquelle, andere Gruppengrösse, anderer Momenttyp —,
// stimmt der gemeldete Stand nicht mehr mit dem aktuellen überein, und die
// Nadel wird von selbst wieder gezeichnet. Ein Ja/Nein mit einem Effekt, der
// es zurücksetzt, tut dasselbe nur, solange niemand die Reihenfolge der
// Effekte gegen ihn dreht.
//
// `memo` aus demselben Grund, aus dem die Linie im Screen memoisiert ist: der
// Screen rendert bei JEDER Kartenbewegung neu (`onRegionChangeComplete`), und
// ohne das rechnete jede Nadel jedes Mal mit. Es hält zugleich das
// Koordinaten-Literal unten harmlos — neu gebaut wird es nur noch, wenn sich
// wirklich eine Eigenschaft geändert hat.
export const KartenNadelMarker = memo(function KartenNadelMarker({
  punkt, thumbUrl, anzahl = 1, onPress,
}: MarkerProps) {
  const { moment } = punkt;
  const abbild = nadelAbbild(moment, thumbUrl, anzahl);
  const [fertigesAbbild, setFertigesAbbild] = useState<string | null>(null);
  const merkeBereit = useCallback(() => setFertigesAbbild(abbild), [abbild]);

  // Der Marker reicht dem Screen zurück, WELCHE Nadel getippt wurde. Die
  // Closure entsteht hier drinnen statt im Screen — sie wird damit nur neu
  // gebaut, wenn diese Nadel ohnehin neu rendert.
  const angetippt = useCallback(() => onPress?.(punkt), [onPress, punkt]);

  return (
    <Marker
      testID={`karte-nadel-${moment.id}`}
      accessibilityLabel={nadelBeschriftung(moment, anzahl)}
      coordinate={{ latitude: punkt.lat, longitude: punkt.lng }}
      tracksViewChanges={fertigesAbbild !== abbild}
      onPress={angetippt}
    >
      <KartenNadel moment={moment} thumbUrl={thumbUrl} anzahl={anzahl} onBereit={merkeBereit} />
    </Marker>
  );
});

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
