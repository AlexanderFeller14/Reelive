import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { PressScale } from '@/components/PressScale';
import { cinema, radius } from '@/theme/tokens';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Snapchat-Muster (Produktkonzept): Tippen = Foto, Halten = Video. Die
// Schwelle entscheidet, wann aus einem Druck ein Video wird, kurz genug, um
// sich nicht wie eine Verzögerung anzufühlen, lang genug, um ein normales
// Tippen nicht versehentlich als Halten zu werten.
const HALTE_SCHWELLE_MS = 500;

const GROESSE = 76; // Aussendurchmesser des Auslösers (Radius 999, DESIGN-LANGUAGE §4)
const STROKE = 4;
const RING_RADIUS = (GROESSE - STROKE) / 2;
const UMFANG = 2 * Math.PI * RING_RADIUS;

// DESIGN-LANGUAGE §5, bewusste und eng begrenzte Ausnahme (im Review vom
// 2026-08-07 bestätigt als vertretbarer Weg, siehe Fix-Runde-1-Anhang in
// task-7-report.md): Der Fortschrittsring animiert `strokeDashoffset`, weder
// `transform` noch `opacity`, und läuft JS-getrieben (`useNativeDriver:
// false`), nicht auf dem UI-Thread.
//
// Wichtig, Klarstellung zur ursprünglich falschen Begründung: Die
// „linear ist verboten, ausser bei Fortschritt, der reale Zeit abbildet"-
// Ausnahme in §5 betrifft NUR die Beschleunigungskurve (linear vs.
// ease-smooth), nicht die animierte Eigenschaft. Sie deckt diesen Fall also
// NICHT automatisch ab, das war ein Fehlschluss im ersten Anlauf.
//
// Eigenständige Begründung für die Ausnahme: Ein füllender Kreisring lässt
// sich mit reinem `transform`/`opacity` nur über zwei unabhängig rotierende
// Halbkreis-Masken nachbilden (das Standardmuster hinter z.B.
// react-native-circular-progress). Diese Geometrie ist in diesem Sandbox-
// Environment ohne Simulator/Screenshot nicht visuell verifizierbar, ein
// unbemerkter Rotations-/Pivot-Fehler wäre an genau der einen Stelle der App
// sichtbar, die das Produktkonzept als „Herzstück" bezeichnet. Die
// SVG-Stroke-Technik ist demgegenüber Industriestandard für Kreis-Fortschritt,
// bleibt auf dieses eine Bauteil beschränkt (kein anderer Ort der App
// animiert eine Nicht-Transform-Eigenschaft) und wird über `Animated.timing`
// (statt eines rohen `setInterval`) umgesetzt, damit sie sich wenigstens in
// die Animated-Systematik des Projekts einfügt.
const RING_DAUER_EASING = Easing.linear; // §5: linear ist hier die erlaubte Ausnahme für Echtzeit-Fortschritt.

type Props = {
  onFoto: () => void;
  onVideoStart: () => void;
  onVideoStop: () => void;
  /** Höchstdauer eines Videos in Sekunden, der Ring stoppt von selbst hier. */
  maxSekunden: number;
};

type Phase = 'ruhe' | 'haelt' | 'video';

function leichtesFeedback() {
  // .catch(): Haptik ist reines Beiwerk (§5), ein fehlendes/verweigertes
  // Haptik-Feature darf die Aufnahme selbst nie stören.
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

// Der Auslöser ist die einzige Stelle im Kamera-Screen mit echter Logik:
// Tippen gegen Halten unterscheiden und die Aufnahme bei maxSekunden selbst
// stoppen. Zwei Timer stecken das ab (Schwelle + Höchstdauer) und werden
// sowohl beim Loslassen als auch beim Unmount aufgeräumt, ein hängender
// Timer würde nach dem Verlassen des Screens weiter onVideoStart/-Stop feuern.
export function Ausloeser({ onFoto, onVideoStart, onVideoStop, maxSekunden }: Props) {
  const [nimmtAuf, setNimmtAuf] = useState(false);
  // Ref statt State: die Timer-Callbacks brauchen den aktuellen Phasenwert
  // synchron und ohne Stale-Closure-Risiko (setState ist asynchron/gebatcht).
  const phase = useRef<Phase>('ruhe');
  const schwellenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoechstdauerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fortschritt = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Unmount-Aufräumen: ohne dies liefe ein zum Verlassen-Zeitpunkt noch
    // ausstehender Timer im Hintergrund weiter und riefe onVideoStart/-Stop
    // an einer Komponente auf, die längst nicht mehr existiert.
    return () => {
      if (schwellenTimer.current) clearTimeout(schwellenTimer.current);
      if (hoechstdauerTimer.current) clearTimeout(hoechstdauerTimer.current);
      fortschritt.stopAnimation();
    };
  }, [fortschritt]);

  const videoStoppen = () => {
    if (hoechstdauerTimer.current) {
      clearTimeout(hoechstdauerTimer.current);
      hoechstdauerTimer.current = null;
    }
    fortschritt.stopAnimation();
    fortschritt.setValue(0);
    phase.current = 'ruhe';
    setNimmtAuf(false);
    onVideoStop();
  };

  const onPressIn = () => {
    phase.current = 'haelt';
    schwellenTimer.current = setTimeout(() => {
      phase.current = 'video';
      schwellenTimer.current = null;
      setNimmtAuf(true);
      leichtesFeedback();
      onVideoStart();
      // Realer Zeitverlauf bis maxSekunden, DESIGN-LANGUAGE §5 erlaubt
      // `linear` ausdrücklich als Ausnahme für die Beschleunigungskurve bei
      // Fortschritt, der reale Zeit abbildet (zur animierten Eigenschaft
      // selbst siehe die Erklärung bei RING_DAUER_EASING oben).
      Animated.timing(fortschritt, {
        toValue: 1,
        duration: maxSekunden * 1000,
        easing: RING_DAUER_EASING,
        useNativeDriver: false, // strokeDashoffset ist kein Transform/Opacity, kann nicht nativ laufen.
      }).start();
      hoechstdauerTimer.current = setTimeout(videoStoppen, maxSekunden * 1000);
    }, HALTE_SCHWELLE_MS);
  };

  const onPressOut = () => {
    if (phase.current === 'haelt') {
      // Schwelle nie erreicht: ein normales Tippen -> Foto.
      if (schwellenTimer.current) {
        clearTimeout(schwellenTimer.current);
        schwellenTimer.current = null;
      }
      phase.current = 'ruhe';
      leichtesFeedback();
      onFoto();
      return;
    }
    if (phase.current === 'video') {
      videoStoppen();
    }
    // phase === 'ruhe': das Video hat sich bereits selbst gestoppt
    // (Höchstdauer erreicht), ein verspätetes pressOut löst nichts mehr aus.
  };

  const dashOffset = fortschritt.interpolate({ inputRange: [0, 1], outputRange: [UMFANG, 0] });

  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel="Auslöser"
      onPressIn={onPressIn}
      onPressOut={onPressOut}
    >
      <View style={styles.wrap}>
        <Svg width={GROESSE} height={GROESSE} style={StyleSheet.absoluteFill}>
          <Circle
            cx={GROESSE / 2}
            cy={GROESSE / 2}
            r={RING_RADIUS}
            stroke={cinema['overlay-pill']}
            strokeWidth={STROKE}
            fill="none"
          />
          {nimmtAuf && (
            <AnimatedCircle
              cx={GROESSE / 2}
              cy={GROESSE / 2}
              r={RING_RADIUS}
              stroke={cinema['seal-glow']}
              strokeWidth={STROKE}
              strokeDasharray={`${UMFANG}, ${UMFANG}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              fill="none"
              rotation={-90}
              origin={`${GROESSE / 2}, ${GROESSE / 2}`}
            />
          )}
        </Svg>
        <View style={[styles.kern, nimmtAuf && styles.kernAktiv]} />
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: GROESSE,
    height: GROESSE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kern: {
    width: GROESSE - STROKE * 4,
    height: GROESSE - STROKE * 4,
    borderRadius: radius.pill,
    backgroundColor: cinema['text-1'],
  },
  // Beim Aufnehmen zieht sich der Kern zusammen, reine Transform-Änderung
  // (DESIGN-LANGUAGE §5), kein Opacity-Dimmen.
  kernAktiv: {
    transform: [{ scale: 0.72 }],
    backgroundColor: cinema['seal-glow'],
  },
});
