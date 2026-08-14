import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { motion, palette, radius, spacing, type } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { ZaehlerRoll } from './ZaehlerRoll';

const REDUZIERTE_DAUER_MS = 200;
// Nach dem Ende der Choreografie bleibt das Bild kurz stehen, damit der
// hochgerollte Zähler lesbar ist, erst dann kommt onFertig. Der Nachklang ist
// ein Standbild, keine Animation, und zählt darum nicht zum 700–900-ms-Budget
// der Inszenierung (DESIGN-LANGUAGE §5).
const NACHKLANG_MS = 500;
// Bei 55 % der Choreografie schliesst das Siegel, dort gehört die
// success-Haptik hin (§5), nicht an den Start.
const SIEGELSCHLUSS_ANTEIL = 0.55;
// In diesem Anteil der Choreografie rollt der Zähler hoch.
const ZAEHLER_FENSTER = [0.7, 0.95] as const;

// Masse der gezeichneten Filmrolle (Draufsicht: Teller, Nabe, drei
// Wickellöcher). Alles Layout-Konstanten dieser einen Zeichnung, bewusst
// lokal statt im Token-Set.
const ROLLE = 72;
const NABE = 14;
const LOCH = 8;
// Die drei Löcher sitzen im 120°-Abstand auf einem Kreis mit Radius 22 um die
// Mitte (36, 36), die Werte sind deren ausgerechnete left/top-Ecken.
const LOCH_POSITIONEN = [
  { left: 32, top: 10 },
  { left: 51, top: 43 },
  { left: 13, top: 43 },
] as const;
const SIEGEL = 44;
const GLOW = 120;

type Props = {
  sichtbar: boolean;
  onFertig: () => void;
  // Standbild des eben eingesendeten Moments (Foto: das gesicherte Medium,
  // Video: der Thumb). Ohne Bild läuft die Inszenierung ohne Schrumpf-Motiv.
  bildUri?: string | null;
  // Zählerstand VOR diesem Moment; die Inszenierung rollt auf +1 hoch.
  // null/undefined: der Stand ist gerade nicht zu haben, die Zahl entfällt.
  zaehler?: number | null;
};

// Eine der zwei ausdrücklich erlaubten Inszenierungen (DESIGN-LANGUAGE v2 §5):
// «Moment schrumpft in die Filmrolle, Siegel schliesst, Zähler rollt hoch.
// Haptik: success.» Sie läuft im hellen App-Look, nicht im Kino: weisser
// Grund, Siegel-Symbolik in `seal` (§1: NUR Versiegelungs-Symbolik auf hellem
// Grund). Die Mechanik-Garantien: Haptik feuert genau
// einmal pro sichtbar=true (beim Siegelschluss), `onFertig` kommt zuverlässig
// nach Choreografie + Nachklang, animiert wird ausschliesslich
// `transform`/`opacity` mit `useNativeDriver` (UI-Thread),
// `prefers-reduced-motion` zeigt den Endzustand als 200-ms-Fade.
export function Versiegelung({ sichtbar, onFertig, bildUri, zaehler }: Props) {
  const reducedMotion = useReducedMotion();
  const fenster = useWindowDimensions();
  const [fortschritt] = useState(() => new Animated.Value(0));
  // Ref statt direkter Closure: `onFertig` darf sich zwischen Start und Ende
  // der Animation ändern (neue Funktionsreferenz bei jedem Render des
  // Elternteils), ohne dass das die laufende Animation neu anstösst.
  const onFertigRef = useRef(onFertig);
  onFertigRef.current = onFertig;
  // Fix-Runde 1: der Effekt hängt (nötigerweise) auch an `reducedMotion`, weil
  // die Dauer davon abhängt. Ändert sich die Systemeinstellung, während die
  // Inszenierung schon läuft (sichtbar bleibt true), läuft der Effekt erneut
  // und würde die Haptik ein zweites Mal für dasselbe Siegel planen. Dieser
  // Ref merkt sich «für dieses sichtbar=true schon gefeuert» unabhängig vom
  // Effekt-Neustart und wird nur zurückgesetzt, wenn die Inszenierung wieder
  // unsichtbar wird.
  const haptikGefeuertRef = useRef(false);

  useEffect(() => {
    if (!sichtbar) {
      fortschritt.setValue(0);
      haptikGefeuertRef.current = false;
      return;
    }

    const dauer = reducedMotion ? REDUZIERTE_DAUER_MS : motion.duration.feature;
    fortschritt.setValue(0);
    // Die Optik läuft mit useNativeDriver auf dem UI-Thread (§5) und damit
    // unabhängig vom JS-Thread, ihr eigener Abschluss-Callback ist darum
    // aber KEIN verlässlicher Zeitgeber (auf einem Gerät ohne aktives
    // natives Animated-Modul, z. B. in Tests, meldet er sich sofort statt
    // nach `dauer`). Gleiches Prinzip wie Ausloeser.tsx: die sichtbare
    // Animation und die Zeitgeber für Haptik und Folge-Aktion laufen getrennt.
    const animation = Animated.timing(fortschritt, {
      toValue: 1,
      duration: dauer,
      useNativeDriver: true,
    });
    animation.start();

    // Haptik beim Siegelschluss (§5: success beim Versiegeln). Im
    // reduzierten Modus zeigt der Fade sofort das geschlossene Siegel, dann
    // gehört sie an den Anfang. .catch(): reines Beiwerk, darf das
    // Versiegeln selbst nie stören (gleiches Muster wie
    // Ausloeser.leichtesFeedback).
    const haptikVerzoegerung = reducedMotion ? 0 : Math.round(dauer * SIEGELSCHLUSS_ANTEIL);
    const haptikTimer = setTimeout(() => {
      if (haptikGefeuertRef.current) return;
      haptikGefeuertRef.current = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }, haptikVerzoegerung);

    const timer = setTimeout(() => onFertigRef.current(), dauer + NACHKLANG_MS);

    // Aufräumen bei Unmount/erneutem Effekt-Lauf: eine laufende Inszenierung
    // darf nach dem Verlassen des Screens weder onFertig noch die Haptik an
    // eine verschwundene Komponente nachfeuern.
    return () => {
      clearTimeout(timer);
      clearTimeout(haptikTimer);
      animation.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sichtbar, reducedMotion]);

  if (!sichtbar) return null;

  // §5: bei prefers-reduced-motion wird die Choreografie zu einem
  // 200-ms-Fade über dem Endzustand: kein Schrumpfen, kein Pop, keine
  // Drehung, kein Digit-Roll, alles steht, nur die Deckkraft kommt.
  const scrimOpacity = reducedMotion
    ? fortschritt
    : fortschritt.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] });

  // Das Moment-Bild startet fast bildschirmfüllend als Karte (Radius 24) und
  // schrumpft in die Filmrolle, wo es beim Eintreffen verlischt.
  const bildBreite = fenster.width - 2 * spacing.screen;
  const bildHoehe = Math.round(bildBreite * (fenster.height / fenster.width));
  const bildZielScale = ROLLE / bildBreite;
  const bildScale = fortschritt.interpolate({
    inputRange: [0, 0.05, 0.55, 1],
    outputRange: [1, 1, bildZielScale, bildZielScale],
  });
  const bildOpacity = fortschritt.interpolate({
    inputRange: [0, 0.48, 0.58, 1],
    outputRange: [1, 1, 0, 0],
  });

  // Die Filmrolle erscheint unter dem schrumpfenden Moment, macht beim
  // Eintreffen einen kleinen Pop und dreht sich ein Stück weiter, als hätte
  // sie den Moment aufgewickelt.
  const rolleOpacity = reducedMotion
    ? fortschritt
    : fortschritt.interpolate({ inputRange: [0, 0.2, 0.4, 1], outputRange: [0, 0, 1, 1] });
  const rolleScale = reducedMotion
    ? 1
    : fortschritt.interpolate({
        inputRange: [0, 0.5, 0.62, 0.75, 1],
        outputRange: [1, 1, 1.08, 1, 1],
      });
  const rolleDrehung = reducedMotion
    ? '0deg'
    : fortschritt.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '0deg', '40deg'] });

  // Siegel schliesst mit einem Puls: das Siegel kommt mit demselben Bounce
  // wie bisher, dahinter pulsieren zwei seal-farbene Kreise auf und
  // verlaufen. Kein Gradient, kein farbiger Schatten: nur Deckkraft und
  // Grösse. Auf hellem Grund bewusst zurückhaltender als der Kino-Glow.
  const siegelOpacity = reducedMotion
    ? fortschritt
    : fortschritt.interpolate({ inputRange: [0, 0.5, 0.62, 1], outputRange: [0, 0, 1, 1] });
  const siegelScale = reducedMotion
    ? 1
    : fortschritt.interpolate({
        inputRange: [0.5, 0.62, 0.75, 1],
        outputRange: [0.6, 1.15, 1, 1],
        extrapolateLeft: 'clamp',
      });
  const glow1Opacity = reducedMotion
    ? 0
    : fortschritt.interpolate({
        inputRange: [0, 0.5, 0.62, 0.85, 1],
        outputRange: [0, 0, 0.25, 0, 0],
      });
  const glow1Scale = fortschritt.interpolate({
    inputRange: [0, 0.5, 0.85, 1],
    outputRange: [0.5, 0.5, 1.6, 1.6],
  });
  const glow2Opacity = reducedMotion
    ? 0
    : fortschritt.interpolate({
        inputRange: [0, 0.58, 0.7, 0.95, 1],
        outputRange: [0, 0, 0.15, 0, 0],
      });
  const glow2Scale = fortschritt.interpolate({
    inputRange: [0, 0.58, 0.95, 1],
    outputRange: [0.7, 0.7, 2.1, 2.1],
  });

  // Der Zähler-Block steht unter der Rolle und steigt beim Erscheinen ein
  // kleines Stück hoch, während die Ziffer rollt.
  const zaehlerOpacity = reducedMotion
    ? fortschritt
    : fortschritt.interpolate({ inputRange: [0, 0.6, 0.75, 1], outputRange: [0, 0, 1, 1] });
  const zaehlerHub = reducedMotion
    ? 0
    : fortschritt.interpolate({ inputRange: [0, 0.6, 0.85, 1], outputRange: [12, 12, 0, 0] });

  const zeigtZahl = zaehler != null;
  const nachher = (zaehler ?? 0) + 1;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="versiegelung">
      <Animated.View style={[StyleSheet.absoluteFill, styles.hintergrund, { opacity: scrimOpacity }]} />

      {bildUri != null && !reducedMotion && (
        <View style={[StyleSheet.absoluteFill, styles.mitte]}>
          <Animated.View style={{ opacity: bildOpacity, transform: [{ scale: bildScale }] }}>
            <Image
              testID="versiegelung-moment"
              source={{ uri: bildUri }}
              style={{ width: bildBreite, height: bildHoehe, borderRadius: radius.card }}
              contentFit="cover"
            />
          </Animated.View>
        </View>
      )}

      <View style={[StyleSheet.absoluteFill, styles.mitte]}>
        <Animated.View style={[styles.glow, { opacity: glow1Opacity, transform: [{ scale: glow1Scale }] }]} />
        <Animated.View style={[styles.glow, { opacity: glow2Opacity, transform: [{ scale: glow2Scale }] }]} />
        <Animated.View
          testID="versiegelung-filmrolle"
          style={[styles.rolle, { opacity: rolleOpacity, transform: [{ scale: rolleScale }] }]}
        >
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: rolleDrehung }] }]}>
            {LOCH_POSITIONEN.map((position, i) => (
              <View key={i} style={[styles.loch, position]} />
            ))}
          </Animated.View>
          <View style={styles.nabe} />
        </Animated.View>
        <Animated.View style={[styles.siegel, { opacity: siegelOpacity, transform: [{ scale: siegelScale }] }]}>
          <Lock size={20} color={palette.seal} strokeWidth={1.75} />
        </Animated.View>
      </View>

      <View style={[StyleSheet.absoluteFill, styles.mitte]}>
        <Animated.View
          style={[styles.zaehlerBlock, { opacity: zaehlerOpacity, transform: [{ translateY: zaehlerHub }] }]}
        >
          {zeigtZahl && (
            <View testID="versiegelung-zaehler">
              {reducedMotion ? (
                <Text style={styles.zahlStatisch}>{String(nachher)}</Text>
              ) : (
                <ZaehlerRoll
                  von={zaehler}
                  nach={nachher}
                  fortschritt={fortschritt}
                  fenster={ZAEHLER_FENSTER}
                />
              )}
            </View>
          )}
          <Text style={styles.zeile}>Bis zum Recap versiegelt.</Text>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hintergrund: {
    backgroundColor: palette['bg-0'],
  },
  mitte: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: GLOW,
    height: GLOW,
    borderRadius: radius.pill,
    backgroundColor: palette.seal,
  },
  rolle: {
    width: ROLLE,
    height: ROLLE,
    borderRadius: radius.pill,
    backgroundColor: palette['bg-1'],
    borderWidth: 1.5,
    borderColor: palette.seal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nabe: {
    width: NABE,
    height: NABE,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: palette.seal,
  },
  loch: {
    position: 'absolute',
    width: LOCH,
    height: LOCH,
    borderRadius: radius.pill,
    backgroundColor: palette['bg-0'],
  },
  siegel: {
    position: 'absolute',
    width: SIEGEL,
    height: SIEGEL,
    borderRadius: radius.pill,
    backgroundColor: palette['bg-0'],
    borderWidth: 1.5,
    borderColor: palette.seal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Rolle (72) + Abstand + halbe Blockhöhe: der Block hängt fest unter der
  // Bildschirmmitte, damit das schrumpfende Moment exakt auf der Rolle landet.
  zaehlerBlock: {
    position: 'absolute',
    top: '50%',
    marginTop: ROLLE / 2 + spacing.l,
    alignItems: 'center',
  },
  zahlStatisch: {
    ...type.display,
    color: palette['text-1'],
    textAlign: 'center',
  },
  zeile: {
    ...type.secondary,
    color: palette['text-2'],
    marginTop: spacing.s,
  },
});
