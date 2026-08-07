import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { PressScale } from '@/components/PressScale';
import { cinema, radius } from '@/theme/tokens';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Snapchat-Muster (Produktkonzept): Tippen = Foto, Halten = Video. Die
// Schwelle entscheidet, wann aus einem Druck ein Video wird — kurz genug, um
// sich nicht wie eine Verzögerung anzufühlen, lang genug, um ein normales
// Tippen nicht versehentlich als Halten zu werten.
const HALTE_SCHWELLE_MS = 500;

const GROESSE = 76; // Aussendurchmesser des Auslösers (Radius 999, DESIGN-LANGUAGE §4)
const STROKE = 4;
const RING_RADIUS = (GROESSE - STROKE) / 2;
const UMFANG = 2 * Math.PI * RING_RADIUS;
// Taktrate des Fortschrittsrings. Bewusst per `setInterval` + `setValue()`
// statt `Animated.timing`: Letzteres hängt seinen eigenen Zeitgeber (RAF/
// Looper) an dieselbe Uhr, die die Timer-Logik ohnehin schon über
// setTimeout/setInterval steuert — ein zweiter, unabhängiger Zeitgeber für
// dieselbe Sache. So läuft der Ring exakt im selben Takt wie Schwelle und
// Höchstdauer und hängt an denselben, bereits vorhandenen Cleanup-Pfaden.
const RING_TAKT_MS = 100;

type Props = {
  onFoto: () => void;
  onVideoStart: () => void;
  onVideoStop: () => void;
  /** Höchstdauer eines Videos in Sekunden — der Ring stoppt von selbst hier. */
  maxSekunden: number;
};

type Phase = 'ruhe' | 'haelt' | 'video';

function leichtesFeedback() {
  // .catch(): Haptik ist reines Beiwerk (§5) — ein fehlendes/verweigertes
  // Haptik-Feature darf die Aufnahme selbst nie stören.
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

// Der Auslöser ist die einzige Stelle im Kamera-Screen mit echter Logik:
// Tippen gegen Halten unterscheiden und die Aufnahme bei maxSekunden selbst
// stoppen. Zwei Timer stecken das ab (Schwelle + Höchstdauer) und werden
// sowohl beim Loslassen als auch beim Unmount aufgeräumt — ein hängender
// Timer würde nach dem Verlassen des Screens weiter onVideoStart/-Stop feuern.
export function Ausloeser({ onFoto, onVideoStart, onVideoStop, maxSekunden }: Props) {
  const [nimmtAuf, setNimmtAuf] = useState(false);
  // Ref statt State: die Timer-Callbacks brauchen den aktuellen Phasenwert
  // synchron und ohne Stale-Closure-Risiko (setState ist asynchron/gebatcht).
  const phase = useRef<Phase>('ruhe');
  const schwellenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoechstdauerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringTakt = useRef<ReturnType<typeof setInterval> | null>(null);
  const aufnahmeStart = useRef(0);
  const fortschritt = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Unmount-Aufräumen: ohne dies liefe ein zum Verlassen-Zeitpunkt noch
    // ausstehender Timer im Hintergrund weiter und riefe onVideoStart/-Stop
    // an einer Komponente auf, die längst nicht mehr existiert.
    return () => {
      if (schwellenTimer.current) clearTimeout(schwellenTimer.current);
      if (hoechstdauerTimer.current) clearTimeout(hoechstdauerTimer.current);
      if (ringTakt.current) clearInterval(ringTakt.current);
    };
  }, []);

  const videoStoppen = () => {
    if (hoechstdauerTimer.current) {
      clearTimeout(hoechstdauerTimer.current);
      hoechstdauerTimer.current = null;
    }
    if (ringTakt.current) {
      clearInterval(ringTakt.current);
      ringTakt.current = null;
    }
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
      // Realer Zeitverlauf bis maxSekunden — DESIGN-LANGUAGE §5 erlaubt
      // `linear` ausdrücklich als Ausnahme für Fortschritt, der reale Zeit
      // abbildet.
      aufnahmeStart.current = Date.now();
      ringTakt.current = setInterval(() => {
        const anteil = Math.min(1, (Date.now() - aufnahmeStart.current) / (maxSekunden * 1000));
        fortschritt.setValue(anteil);
      }, RING_TAKT_MS);
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
    // (Höchstdauer erreicht) — ein verspätetes pressOut löst nichts mehr aus.
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
  // Beim Aufnehmen zieht sich der Kern zusammen — reine Transform-Änderung
  // (DESIGN-LANGUAGE §5), kein Opacity-Dimmen.
  kernAktiv: {
    transform: [{ scale: 0.72 }],
    backgroundColor: cinema['seal-glow'],
  },
});
