import { useEffect, useRef, useState } from 'react';
import {
  Animated as RNAnimated,
  Easing as RNEasing,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { motion, palette, radius, shadow, spacing, type } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { ZaehlerRoll } from './ZaehlerRoll';

// Zeitgerüst der Erfolgsanimation nach dem Einsenden (Spec 2026-08-14):
// Phase 1 (0–900): drei Polaroids fliegen nacheinander ein und stapeln sich.
// Phase 2 (900–1250): der Stapel hält kurz und «setzt» sich minimal.
// Phase 3 (1250–1700): alle drei ziehen sich zur Mitte zusammen und
// verschwinden, als würden die Erinnerungen gesammelt.
// Phase 4 (ab 1800): NACH einer kurzen Atempause auf leerer Bühne federt der
// Bestätigungs-Pin herein und kommt bis ~2250 ganz zur Ruhe.
// Phase 5 (ab 2300): erst wenn der Pin steht, erscheint darunter der
// Reisezähler — er STEHT zuerst auf dem alten Stand und rollt dann genau
// einmal auf den neuen; der Rest der Gesamtdauer ist Lesezeit.
// Die Phasen überlappen bewusst NICHT (Geräte-Abnahme 2026-08-14:
// «Polaroids, dann Gutzeichen, dann der Count — ganz clean»).
// Titel und Untertitel blenden ab 450/600 ms von unten ein und bleiben.
const GESAMT_MS = 3_600;
const TITEL_START_MS = 450;
const UNTERTITEL_START_MS = 600;
const SETZEN_START_MS = 900;
const SAMMELN_START_MS = 1_250;
const SAMMELN_DAUER_MS = 450;
const AUSBLENDEN_START_MS = 1_550;
const AUSBLENDEN_DAUER_MS = 150;
const PIN_START_MS = 1_800;
const EINBLENDEN_DAUER_MS = 200;
const SAMMEL_SCALE = 0.2;
// Der Zähler erscheint NACH dem ausgefederten Pin (Phase 5): weich
// einblenden ab 2300 ms, dann steht der alte Stand kurz lesbar, die Ziffer
// rollt 2700–3300 ms, bewusst langsam.
// Der Roll läuft über ZaehlerRoll.tsx auf einem eigenen
// RN-Animated-Zeitgeber, weil die Komponente von der alten
// Versiegelungs-Inszenierung stammt und bewusst unverändert wiederverwendet
// wird. Der Zeitgeber umfasst NUR den Roll (Fenster 0 → 1), nicht die
// Gesamtdauer: vorher lag das Fenster im Auslauf der impliziten inOut-Kurve
// von RNAnimated.timing, die Ziffer startete zu früh und kroch sub-pixelweise
// ins Ziel (Geräte-Abnahme: «nicht smooth»). So sitzt die Haus-Kurve exakt
// auf dem Roll selbst.
const ZAEHLER_EINBLENDEN_MS = 2_300;
const ZAEHLER_ROLL_START_MS = 2_700;
const ZAEHLER_ROLL_ENDE_MS = 3_300;
const ZAEHLER_ROLL_DAUER_MS = ZAEHLER_ROLL_ENDE_MS - ZAEHLER_ROLL_START_MS;
const ZAEHLER_FENSTER = [0, 1] as const;

// Reduzierte Bewegung (§5: alles wird zu Fades): die Polaroids erscheinen
// kurz statisch in Stapelpose, dann kommt direkt die Bestätigung, insgesamt
// deutlich verkürzt.
const REDUZIERT_GESAMT_MS = 900;
const REDUZIERT_PIN_MS = 350;
const REDUZIERT_FADE_MS = 150;

type Pose = { x: number; y: number; rot: number; scale: number };
type PolaroidSpec = {
  quelle: number;
  start: Pose;
  ende: Pose;
  beginn: number;
  einflug: number;
};

// Einflug-Choreografie laut Spec: Berge von links, Camper von rechts, Strand
// von unten nach vorn. Die Reihenfolge ist zugleich die Stapelordnung, das
// letzte Element liegt obenauf.
const POLAROIDS: PolaroidSpec[] = [
  {
    quelle: require('../../assets/images/memory-polaroid-mountains.png'),
    start: { x: -160, y: 40, rot: -20, scale: 0.65 },
    ende: { x: -44, y: -8, rot: -10, scale: 0.95 },
    beginn: 0,
    einflug: 500,
  },
  {
    quelle: require('../../assets/images/memory-polaroid-camper.png'),
    start: { x: 160, y: 45, rot: 20, scale: 0.65 },
    ende: { x: 44, y: -4, rot: 10, scale: 0.95 },
    beginn: 150,
    einflug: 500,
  },
  {
    quelle: require('../../assets/images/memory-polaroid-beach.png'),
    start: { x: 0, y: 150, rot: 7, scale: 0.65 },
    ende: { x: 0, y: 16, rot: 2, scale: 1 },
    beginn: 300,
    einflug: 550,
  },
];

type PolaroidWerte = {
  op: SharedValue<number>;
  x: SharedValue<number>;
  y: SharedValue<number>;
  rot: SharedValue<number>;
  scale: SharedValue<number>;
};

function usePolaroidWerte(start: Pose): PolaroidWerte {
  return {
    op: useSharedValue(0),
    x: useSharedValue(start.x),
    y: useSharedValue(start.y),
    rot: useSharedValue(start.rot),
    scale: useSharedValue(start.scale),
  };
}

function usePolaroidStil(w: PolaroidWerte) {
  return useAnimatedStyle(() => ({
    opacity: w.op.value,
    transform: [
      { translateX: w.x.value },
      { translateY: w.y.value },
      { rotate: `${w.rot.value}deg` },
      { scale: w.scale.value },
    ],
  }));
}

export type MemorySubmissionAnimationProps = {
  visible: boolean;
  onFinished: () => void;
  // Zählerstand der Reise VOR diesem Moment; die Animation rollt auf +1
  // hoch. null/undefined: der Stand ist gerade nicht zu haben, die Zahl
  // entfällt, alles andere läuft unverändert.
  zaehler?: number | null;
};

// Erfolgs-Zwischenschirm nach dem Einsenden: weisser Vollbild-Deckel, drei
// Polaroids sammeln sich zu einem Stapel, ziehen sich zusammen, der
// Standort-Pin im Akzent bestätigt mit Häkchen. Die Mechanik-Garantien folgen
// dem Haus-Muster (Versiegelung.tsx/Ausloeser.tsx): die sichtbare Animation
// läuft per Reanimated auf dem UI-Thread, `onFinished` und die Haptik hängen
// an eigenen JS-Timern, weil die Abschluss-Callbacks der Animation auf einem
// Gerät ohne aktives natives Modul (z. B. in Tests) sofort statt nach der
// Dauer feuern. `onFinished` kommt genau einmal pro visible=true, ein
// Unmount oder visible=false bricht sauber ab, ein erneutes visible=true
// startet die volle Choreografie von vorn.
export function MemorySubmissionAnimation({
  visible,
  onFinished,
  zaehler,
}: MemorySubmissionAnimationProps) {
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const fenster = useWindowDimensions();
  // Eigener RN-Animated-Zeitgeber NUR für den Digit-Roll (siehe
  // ZAEHLER_FENSTER oben); der Rest der Choreografie läuft über Reanimated.
  const [rollFortschritt] = useState(() => new RNAnimated.Value(0));

  const berge = usePolaroidWerte(POLAROIDS[0].start);
  const camper = usePolaroidWerte(POLAROIDS[1].start);
  const strand = usePolaroidWerte(POLAROIDS[2].start);
  const alleWerte = [berge, camper, strand];

  // Das «Setzen» des fertigen Stapels (Phase 2) liegt auf einem gemeinsamen
  // Eltern-Wert statt auf jedem Polaroid einzeln: ein Wert, eine Bewegung.
  const stapelScale = useSharedValue(1);
  const pinOp = useSharedValue(0);
  const pinScale = useSharedValue(0);
  const titelOp = useSharedValue(0);
  const titelY = useSharedValue(8);
  const untertitelOp = useSharedValue(0);
  const untertitelY = useSharedValue(8);
  // Bewusst nur Opacity, keine Bewegung: die Zahl steht, die einzige
  // Bewegung ist der eine Digit-Roll («ganz clean», Geräte-Abnahme).
  const zaehlerOp = useSharedValue(0);

  // onFinished darf sich zwischen Start und Ende ändern (neue Referenz bei
  // jedem Eltern-Render), ohne die laufende Choreografie neu anzustossen.
  // Anders als im älteren Haus-Muster (Versiegelung.tsx) wird der Ref im
  // Effekt statt im Render nachgeführt, das ist dieselbe Wirkung ohne den
  // react-hooks-Verstoss «Cannot access refs during render».
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  });
  // Genau-einmal-Wächter pro visible=true: der Effekt hängt (nötigerweise)
  // auch an reducedMotion, ein Wechsel mitten in der Animation lässt ihn neu
  // laufen und würde ohne die Refs Haptik oder Abschluss doppelt feuern
  // (gleiche Fix-Runde-1-Lektion wie in Versiegelung.tsx).
  const fertigGefeuertRef = useRef(false);
  const haptikGefeuertRef = useRef(false);

  useEffect(() => {
    const zuruecksetzen = () => {
      POLAROIDS.forEach((p, i) => {
        const w = alleWerte[i];
        cancelAnimation(w.op);
        cancelAnimation(w.x);
        cancelAnimation(w.y);
        cancelAnimation(w.rot);
        cancelAnimation(w.scale);
        w.op.value = 0;
        w.x.value = p.start.x;
        w.y.value = p.start.y;
        w.rot.value = p.start.rot;
        w.scale.value = p.start.scale;
      });
      for (const wert of [
        stapelScale,
        pinOp,
        pinScale,
        titelOp,
        titelY,
        untertitelOp,
        untertitelY,
        zaehlerOp,
      ]) {
        cancelAnimation(wert);
      }
      stapelScale.value = 1;
      pinOp.value = 0;
      pinScale.value = 0;
      titelOp.value = 0;
      titelY.value = 8;
      untertitelOp.value = 0;
      untertitelY.value = 8;
      zaehlerOp.value = 0;
    };

    if (!visible) {
      zuruecksetzen();
      fertigGefeuertRef.current = false;
      haptikGefeuertRef.current = false;
      return;
    }

    zuruecksetzen();
    const ease = Easing.bezier(...motion.easeSmooth);

    if (reducedMotion) {
      // Keine Einflugbewegungen: die Polaroids stehen fertig gestapelt und
      // blenden nur kurz ein und wieder aus, dann kommt die Bestätigung.
      POLAROIDS.forEach((p, i) => {
        const w = alleWerte[i];
        w.x.value = p.ende.x;
        w.y.value = p.ende.y;
        w.rot.value = p.ende.rot;
        w.scale.value = p.ende.scale;
        w.op.value = withSequence(
          withTiming(1, { duration: REDUZIERT_FADE_MS, easing: ease }),
          withDelay(REDUZIERT_FADE_MS, withTiming(0, { duration: REDUZIERT_FADE_MS, easing: ease }))
        );
      });
      pinScale.value = 1;
      pinOp.value = withDelay(REDUZIERT_PIN_MS, withTiming(1, { duration: REDUZIERT_FADE_MS, easing: ease }));
      titelOp.value = withTiming(1, { duration: REDUZIERT_FADE_MS, easing: ease });
      titelY.value = 0;
      untertitelOp.value = withTiming(1, { duration: REDUZIERT_FADE_MS, easing: ease });
      untertitelY.value = 0;
      zaehlerOp.value = withDelay(
        REDUZIERT_PIN_MS,
        withTiming(1, { duration: REDUZIERT_FADE_MS, easing: ease })
      );
    } else {
      POLAROIDS.forEach((p, i) => {
        const w = alleWerte[i];
        // Nach dem Einflug wartet jedes Polaroid bis zum gemeinsamen
        // Sammelbeginn; die Lücke ist pro Polaroid verschieden, weil Beginn
        // und Einflugdauer gestaffelt sind.
        const sammelLuecke = SAMMELN_START_MS - p.beginn - p.einflug;
        w.x.value = withSequence(
          withDelay(p.beginn, withTiming(p.ende.x, { duration: p.einflug, easing: ease })),
          withDelay(sammelLuecke, withTiming(0, { duration: SAMMELN_DAUER_MS, easing: ease }))
        );
        w.y.value = withSequence(
          withDelay(p.beginn, withTiming(p.ende.y, { duration: p.einflug, easing: ease })),
          withDelay(sammelLuecke, withTiming(0, { duration: SAMMELN_DAUER_MS, easing: ease }))
        );
        w.rot.value = withSequence(
          withDelay(p.beginn, withTiming(p.ende.rot, { duration: p.einflug, easing: ease })),
          withDelay(sammelLuecke, withTiming(0, { duration: SAMMELN_DAUER_MS, easing: ease }))
        );
        w.scale.value = withSequence(
          withDelay(p.beginn, withTiming(p.ende.scale, { duration: p.einflug, easing: ease })),
          withDelay(sammelLuecke, withTiming(SAMMEL_SCALE, { duration: SAMMELN_DAUER_MS, easing: ease }))
        );
        w.op.value = withSequence(
          withDelay(p.beginn, withTiming(1, { duration: EINBLENDEN_DAUER_MS, easing: ease })),
          withDelay(
            AUSBLENDEN_START_MS - p.beginn - EINBLENDEN_DAUER_MS,
            withTiming(0, { duration: AUSBLENDEN_DAUER_MS, easing: ease })
          )
        );
      });
      stapelScale.value = withDelay(
        SETZEN_START_MS,
        withSequence(withTiming(1.03, { duration: 100, easing: ease }), withSpring(1, motion.spring))
      );
      pinOp.value = withDelay(PIN_START_MS, withTiming(1, { duration: 120, easing: ease }));
      pinScale.value = withDelay(
        PIN_START_MS,
        withSequence(withTiming(1.1, { duration: 180, easing: ease }), withSpring(1, motion.spring))
      );
      titelOp.value = withDelay(TITEL_START_MS, withTiming(1, { duration: motion.duration.gentle, easing: ease }));
      titelY.value = withDelay(TITEL_START_MS, withTiming(0, { duration: motion.duration.gentle, easing: ease }));
      untertitelOp.value = withDelay(
        UNTERTITEL_START_MS,
        withTiming(1, { duration: motion.duration.gentle, easing: ease })
      );
      untertitelY.value = withDelay(
        UNTERTITEL_START_MS,
        withTiming(0, { duration: motion.duration.gentle, easing: ease })
      );
      // Weicher als die Polaroids (gentle statt 200 ms): der Zähler ist der
      // ruhige Schlussakkord, kein weiterer Effekt im Getümmel.
      zaehlerOp.value = withDelay(
        ZAEHLER_EINBLENDEN_MS,
        withTiming(1, { duration: motion.duration.gentle, easing: ease })
      );
    }

    // Der Digit-Roll-Zeitgeber deckt exakt den Roll ab (Start per delay,
    // Haus-Kurve direkt auf den 600 ms, siehe Kommentar bei ZAEHLER_FENSTER).
    // Reduziert: sofort auf den Endstand, die Zahl steht dann statisch
    // (unten wird ohnehin ein fester Text gezeigt).
    rollFortschritt.setValue(reducedMotion ? 1 : 0);
    const rollAnimation = reducedMotion
      ? null
      : RNAnimated.timing(rollFortschritt, {
          toValue: 1,
          delay: ZAEHLER_ROLL_START_MS,
          duration: ZAEHLER_ROLL_DAUER_MS,
          easing: RNEasing.bezier(...motion.easeSmooth),
          useNativeDriver: true,
        });
    rollAnimation?.start();

    // Haptik, wenn die Bestätigung erscheint (§5: success), und der eine
    // Abschluss-Timer. Beides bewusst als JS-Timer getrennt von der
    // UI-Thread-Animation, siehe Kommentar am Komponentenkopf.
    const gesamt = reducedMotion ? REDUZIERT_GESAMT_MS : GESAMT_MS;
    const haptikBei = reducedMotion ? REDUZIERT_PIN_MS : PIN_START_MS;
    const haptikTimer = setTimeout(() => {
      if (haptikGefeuertRef.current) return;
      haptikGefeuertRef.current = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }, haptikBei);
    const fertigTimer = setTimeout(() => {
      if (fertigGefeuertRef.current) return;
      fertigGefeuertRef.current = true;
      onFinishedRef.current();
    }, gesamt);

    return () => {
      clearTimeout(haptikTimer);
      clearTimeout(fertigTimer);
      rollAnimation?.stop();
    };
    // Die Werte-Objekte sind über useSharedValue stabil, der Effekt soll nur
    // auf Sichtbarkeit und Bewegungs-Einstellung reagieren.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reducedMotion]);

  const bergeStil = usePolaroidStil(berge);
  const camperStil = usePolaroidStil(camper);
  const strandStil = usePolaroidStil(strand);
  const polaroidStile = [bergeStil, camperStil, strandStil];

  const stapelStil = useAnimatedStyle(() => ({
    transform: [{ scale: stapelScale.value }],
  }));
  const pinStil = useAnimatedStyle(() => ({
    opacity: pinOp.value,
    transform: [{ scale: pinScale.value }],
  }));
  const titelStil = useAnimatedStyle(() => ({
    opacity: titelOp.value,
    transform: [{ translateY: titelY.value }],
  }));
  const untertitelStil = useAnimatedStyle(() => ({
    opacity: untertitelOp.value,
    transform: [{ translateY: untertitelY.value }],
  }));
  const zaehlerStil = useAnimatedStyle(() => ({
    opacity: zaehlerOp.value,
  }));

  if (!visible) return null;

  // 140–180 Punkte je nach Bildschirmbreite (ursprünglich 120–150 laut Spec,
  // nach der ersten Geräte-Abnahme bewusst eine Stufe grösser).
  const polaroidBreite = Math.min(180, Math.max(140, Math.round(fenster.width * 0.44)));
  const polaroidHoehe = Math.round(polaroidBreite * 1.2);

  return (
    // pointerEvents bleibt beim Standard «auto»: der Deckel schluckt während
    // der Animation jede Berührung des darunterliegenden Screens, auch einen
    // zweiten Tipp auf «Einsenden».
    <View
      testID="memory-animation"
      accessible
      accessibilityLabel="Moment erfolgreich eingesendet"
      style={[
        StyleSheet.absoluteFill,
        styles.deckel,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.obererRaum} />
      <View style={[styles.buehne, { height: polaroidHoehe + spacing.xxl * 2 }]}>
        <Animated.View style={[styles.mitteLage, stapelStil]}>
          {POLAROIDS.map((p, i) => (
            <Animated.View key={i} style={[styles.polaroidLage, polaroidStile[i]]}>
              <Image
                testID="memory-polaroid"
                accessible={false}
                accessibilityElementsHidden
                importantForAccessibility="no"
                source={p.quelle}
                style={{ width: polaroidBreite, height: polaroidHoehe }}
                contentFit="contain"
              />
            </Animated.View>
          ))}
        </Animated.View>
        <Animated.View testID="memory-pin" style={[styles.mitteLage, pinStil]}>
          {/* Standort-Pin ohne SVG: drei volle Ecken, eine spitze, um 45°
              gedreht, das Häkchen dreht in der Mitte zurück. */}
          <View style={styles.pinTropfen}>
            <View style={styles.pinInhalt}>
              <Check size={26} color={palette['on-accent']} strokeWidth={2.5} />
            </View>
          </View>
        </Animated.View>
        {/* Der Zähler gehört zur Bestätigung in der MITTE: er erscheint nach
            dem Pin direkt darunter (Geräte-Abnahme 2026-08-14), nicht im
            Textblock. */}
        {zaehler != null && (
          <Animated.View testID="memory-zaehler" style={[styles.zaehlerLage, zaehlerStil]}>
            {reducedMotion ? (
              <Text style={styles.zahlStatisch}>{String(zaehler + 1)}</Text>
            ) : (
              <ZaehlerRoll
                von={zaehler}
                nach={zaehler + 1}
                fortschritt={rollFortschritt}
                fenster={ZAEHLER_FENSTER}
              />
            )}
          </Animated.View>
        )}
      </View>
      <View style={styles.texte}>
        <Animated.Text style={[styles.titel, titelStil]}>Moment eingesendet</Animated.Text>
        <Animated.Text style={[styles.untertitel, untertitelStil]}>
          Dein Moment ist unterwegs und bleibt bis zum Recap versiegelt.
        </Animated.Text>
      </View>
      <View style={styles.untererRaum} />
    </View>
  );
}

const styles = StyleSheet.create({
  deckel: {
    backgroundColor: palette['bg-0'],
    alignItems: 'center',
    zIndex: 10,
    elevation: 10,
  },
  // 3:4 statt 1:1: die Bühne sitzt dadurch im oberen mittleren Bereich,
  // der Text folgt darunter mit Luft.
  obererRaum: { flex: 3 },
  untererRaum: { flex: 4 },
  buehne: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mitteLage: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  polaroidLage: {
    position: 'absolute',
  },
  pinTropfen: {
    width: 64,
    height: 64,
    backgroundColor: palette.accent,
    borderTopLeftRadius: radius.pill,
    borderTopRightRadius: radius.pill,
    borderBottomLeftRadius: radius.pill,
    transform: [{ rotate: '45deg' }],
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.s1,
  },
  pinInhalt: {
    transform: [{ rotate: '-45deg' }],
  },
  texte: {
    alignItems: 'center',
    paddingHorizontal: spacing.screen,
    marginTop: spacing.xl,
  },
  // Unter der Bühnenmitte, wo der Pin sitzt: halbe Pin-Höhe (32) plus
  // gestalteter Abstand. Mit left/right 0 statt Eltern-Zentrierung, weil ein
  // absolutes Kind mit Inset in Yoga nicht mehr zentriert wird (siehe
  // RevealInszenierung.tsx).
  zaehlerLage: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    marginTop: 32 + spacing.l,
    alignItems: 'center',
  },
  zahlStatisch: {
    ...type.display,
    color: palette['text-1'],
    textAlign: 'center',
  },
  titel: {
    ...type.h2,
    color: palette['text-1'],
    textAlign: 'center',
  },
  untertitel: {
    ...type.secondary,
    color: palette['text-2'],
    textAlign: 'center',
    marginTop: spacing.s,
  },
});
