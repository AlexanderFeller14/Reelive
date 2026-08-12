import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { Lock } from 'lucide-react-native';
import { Pille } from '@/components/Pille';
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

// Sperren (Spec 2026-08-12): Der Daumen wischt nach rechts zum Schloss und ist
// danach frei, das Video läuft weiter. Ohne das kostet jede Aufnahme bis zu
// dreissig Sekunden Dauerdruck, und jede Bewegung der Hand geht durch genau
// den Finger, der das Bild ruhig halten soll.
const SCHLOSS_GROESSE = 44; // wie «Kamera wechseln» und «Blitz» im Kopf des Suchers
const SCHLOSS_ABSTAND = 96; // Mitte zu Mitte, vom Auslöser aus nach rechts
// Die Hälfte des Weges. Kurz genug, dass die Sperre ohne Kraftakt greift, lang
// genug, dass ein Abrutschen sie nicht auslöst.
const SPERR_SCHWELLE = SCHLOSS_ABSTAND / 2;
// Die Bühne trägt Auslöser UND Schloss und ist bewusst symmetrisch: Sie wird
// von aussen zentriert (ausloeserWrap), ein einseitiger Überhang würde den
// Auslöser aus der Bildmitte schieben. 236 passen auch auf ein iPhone SE.
const BUEHNE_BREITE = 2 * (SCHLOSS_ABSTAND + SCHLOSS_GROESSE / 2);

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

type Phase = 'ruhe' | 'haelt' | 'video' | 'gesperrt';

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
  const [gesperrt, setGesperrt] = useState(false);
  const [ueberSchwelle, setUeberSchwelle] = useState(false);
  // Ref statt State: die Timer-Callbacks brauchen den aktuellen Phasenwert
  // synchron und ohne Stale-Closure-Risiko (setState ist asynchron/gebatcht).
  const phase = useRef<Phase>('ruhe');
  const schwellenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoechstdauerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fortschritt = useRef(new Animated.Value(0)).current;
  // Wo der Daumen aufgesetzt hat. Gemessen wird die Verschiebung, nicht die
  // Bildschirmposition: Der Auslöser sitzt zwar mittig, aber ein Daumen setzt
  // selten in seiner Mitte auf.
  const startX = useRef(0);
  // Dasselbe Wissen wie `ueberSchwelle`, nur synchron lesbar. onPressOut
  // entscheidet damit zwischen Sperren und Stoppen, und ein State-Wert wäre
  // dort womöglich noch der alte.
  const jenseits = useRef(false);

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
    jenseits.current = false;
    setNimmtAuf(false);
    setGesperrt(false);
    setUeberSchwelle(false);
    onVideoStop();
  };

  const onPressIn = (e?: GestureResponderEvent) => {
    // Gesperrt ist der Auslöser ein Stopp-Knopf: der Druck beendet, statt eine
    // neue Aufnahme zu beginnen. Das folgende onPressOut findet dann 'ruhe'
    // vor und löst nichts mehr aus.
    if (phase.current === 'gesperrt') {
      videoStoppen();
      return;
    }
    startX.current = e?.nativeEvent?.pageX ?? 0;
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

  // Verfolgt den Daumen auf dem Weg zum Schloss. Erst ab 'video' ausgewertet:
  // vorher gibt es keine Aufnahme zu sperren, und ein Wisch in dieser Zeit
  // bleibt ein Tippen, also ein Foto.
  const onTouchMove = (e?: GestureResponderEvent) => {
    if (phase.current !== 'video') return;
    const jetzt = (e?.nativeEvent?.pageX ?? 0) - startX.current >= SPERR_SCHWELLE;
    if (jetzt === jenseits.current) return;
    jenseits.current = jetzt;
    setUeberSchwelle(jetzt);
    // Nur beim Erreichen, nicht beim Zurückkehren: das Signal bestätigt, dass
    // die Sperre greift, und ein Hin und Her soll nicht in der Hand vibrieren.
    if (jetzt) leichtesFeedback();
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
      // Losgelassen jenseits des Schlosses: die Aufnahme läuft weiter, nur der
      // Daumen ist frei. Beide Timer bleiben unangetastet, die Höchstdauer
      // gilt also unverändert.
      if (jenseits.current) {
        phase.current = 'gesperrt';
        jenseits.current = false;
        setGesperrt(true);
        setUeberSchwelle(false);
        return;
      }
      videoStoppen();
    }
    // phase === 'ruhe': das Video hat sich bereits selbst gestoppt
    // (Höchstdauer erreicht), ein verspätetes pressOut löst nichts mehr aus.
  };

  const dashOffset = fortschritt.interpolate({ inputRange: [0, 1], outputRange: [UMFANG, 0] });

  return (
    // box-none: die Bühne ist nur Rahmen für die Anordnung, Berührungen
    // gehören dem Auslöser und dem Schloss, nicht der Leere dazwischen.
    <View style={styles.buehne} pointerEvents="box-none">
      {nimmtAuf && !gesperrt && (
        <Pille
          testID="ausloeser-schloss"
          accessibilityLabel="Aufnahme sperren"
          style={styles.schloss}
          // Das Ziel der Geste, kein eigenes Tippziel: erreicht wird es über
          // den Daumen, der ohnehin schon auf dem Auslöser liegt.
          pointerEvents="none"
        >
          <Lock
            size={22}
            color={ueberSchwelle ? cinema['seal-glow'] : cinema['text-2']}
            strokeWidth={1.75}
          />
        </Pille>
      )}
      <PressScale
        accessibilityRole="button"
        accessibilityLabel={gesperrt ? 'Aufnahme beenden' : 'Auslöser'}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onTouchMove={onTouchMove}
        // Ohne das gäbe `Pressable` den Druck ab, sobald der Daumen den
        // Auslöser verlässt, und stoppte das Video genau auf dem Weg zum
        // Schloss. Der Bereich deckt die Strecke mit Reserve ab.
        pressRetentionOffset={{ top: 40, bottom: 40, left: 40, right: SCHLOSS_ABSTAND + SCHLOSS_GROESSE }}
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
          <View
            testID="ausloeser-kern"
            style={[styles.kern, nimmtAuf && styles.kernAktiv, gesperrt && styles.kernGesperrt]}
          />
        </View>
      </PressScale>
    </View>
  );
}

const styles = StyleSheet.create({
  buehne: {
    width: BUEHNE_BREITE,
    height: GROESSE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Sitzt am rechten Rand der Bühne, die genau so breit ist, dass die Mitte
  // der Pille SCHLOSS_ABSTAND vom Auslöser entfernt liegt.
  schloss: {
    position: 'absolute',
    right: 0,
    width: SCHLOSS_GROESSE,
    height: SCHLOSS_GROESSE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  // Rund heisst «nimmt auf», eckig heisst «beendet die Aufnahme»: das
  // gebräuchliche Stopp-Zeichen. Es ist die einzige Rückmeldung, die den
  // gesperrten Zustand trägt, denn die Schloss-Pille ist dann weg.
  // Radius 12 aus §3, kein Zwischenwert.
  kernGesperrt: {
    transform: [{ scale: 0.56 }],
    borderRadius: radius.control,
  },
});
