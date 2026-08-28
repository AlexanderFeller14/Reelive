import { useEffect, useRef } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
import { Sparkle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { motion, palette, spacing, type } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { TICKET_ASPECT, TICKET_MAIN_END, TICKET_PERFORATION_Y, TICKET_WAX_SHARE } from './ticketGeometry';

// Timeline of the closing interstitial (prototype C «Siegel», chosen
// 2026-08-28 out of three drafts):
// Phase 1 (0-850): three polaroids fly in one after another and stack up,
// the same fly-in the submission success uses, only quicker to the point.
// Phase 2 (900-1500): the cinema ticket rises from below and comes to a
// stop; behind it the stack pulls together and vanishes, as if the moments
// were gathered into the ticket.
// Phase 3 (1550-1800): the wax drops onto the perforation, compresses on
// impact (1750, the haptic) and settles; the ticket dips under it.
// Phase 4 (1800-2540): three gold sparks rise from the wax, staggered.
// Phase 5 (from 2100): title, then subtitle; the rest is reading time.
// The phases run back to back, never as one big overlap (same principle as
// MomentSubmissionAnimation.tsx).
const TOTAL_MS = 3_000;
const TICKET_START_MS = 900;
const TICKET_RISE_MS = 600;
const TICKET_FADE_IN_MS = 120;
const GATHER_START_MS = 900;
const GATHER_MS = 450;
const GATHER_SCALE = 0.2;
const GATHER_SINK = 40;
const POLAROID_FADE_IN_MS = 200;
const SEAL_START_MS = 1_550;
const SEAL_FADE_IN_MS = 90;
const SEAL_PRESS_MS = 110;
// When the wax hits the ticket: the end of its compression, the ticket's
// dip and the haptic all hang off this one moment.
const SEAL_LANDS_MS = SEAL_START_MS + SEAL_FADE_IN_MS + SEAL_PRESS_MS;
const TICKET_DIP_MS = 120;
const SPARK_START_MS = 1_800;
const SPARK_STAGGER_MS = 70;
const SPARK_MS = 600;
const SPARK_RISE_IN_MS = 210;
const TITLE_START_MS = 2_100;
const SUBTITLE_START_MS = 2_300;

// Reduced motion (§5: everything becomes fades): ticket and wax simply
// appear in their final pose, the text follows, overall much shorter.
const REDUCED_TOTAL_MS = 900;
const REDUCED_FADE_MS = 200;
const REDUCED_SEAL_MS = 100;
const REDUCED_TITLE_MS = 250;
const REDUCED_SUBTITLE_MS = 450;

// Wax scale on the way down: oversized while it is still «in the air»,
// pressed flat on impact, back to its resting size via the house spring.
const SEAL_AIR_SCALE = 1.8;
const SEAL_TOUCH_SCALE = 1.5;
const SEAL_PRESSED_SCALE = 0.94;
const TICKET_DIP_SCALE = 0.985;
const SPARK_START_SCALE = 0.6;
// How far the sparks rise above the wax. A motion distance, not a layout
// one, hence outside the §3 spacing values, named here on purpose (same
// exception RevealSequence.tsx makes for SPARK_RISE).
const SPARK_RISE = 76;
const SPARK_PEAK = 28;
const SPARK_SIZE = 24;

type Pose = { x: number; y: number; rot: number; scale: number };
type PolaroidSpec = {
  source: number;
  start: Pose;
  end: Pose;
  delay: number;
  flyInDuration: number;
};

// The same three polaroids and poses as the submission success
// (MomentSubmissionAnimation.tsx), deliberately a copy rather than a shared
// constant: each interstitial gets tuned on the device on its own, and a
// tweak to one must not quietly move the other.
const POLAROIDS: PolaroidSpec[] = [
  {
    source: require('../../assets/images/memory-polaroid-mountains.png'),
    start: { x: -160, y: 40, rot: -20, scale: 0.65 },
    end: { x: -44, y: -8, rot: -10, scale: 0.95 },
    delay: 0,
    flyInDuration: 500,
  },
  {
    source: require('../../assets/images/memory-polaroid-camper.png'),
    start: { x: 160, y: 45, rot: 20, scale: 0.65 },
    end: { x: 44, y: -4, rot: 10, scale: 0.95 },
    delay: 150,
    flyInDuration: 500,
  },
  {
    source: require('../../assets/images/memory-polaroid-beach.png'),
    start: { x: 0, y: 150, rot: 7, scale: 0.65 },
    end: { x: 0, y: 16, rot: 2, scale: 1 },
    delay: 300,
    flyInDuration: 550,
  },
];

// Spark offsets around the wax, relative to the perforation centre, on the
// §3 grid; each spark rises from there.
const SPARKS = [
  { offsetX: -48, offsetY: -16 },
  { offsetX: 0, offsetY: -28 },
  { offsetX: 48, offsetY: -12 },
] as const;

const TICKET_ASSET = require('../../assets/images/reelive-kino-ticket.png');
const SEAL_ASSET = require('../../assets/images/rotes-brief-wachssiegel-transparent.png');

type PolaroidValues = {
  op: SharedValue<number>;
  x: SharedValue<number>;
  y: SharedValue<number>;
  rot: SharedValue<number>;
  scale: SharedValue<number>;
};

function usePolaroidValues(start: Pose): PolaroidValues {
  return {
    op: useSharedValue(0),
    x: useSharedValue(start.x),
    y: useSharedValue(start.y),
    rot: useSharedValue(start.rot),
    scale: useSharedValue(start.scale),
  };
}

function usePolaroidStyle(w: PolaroidValues) {
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

type SparkValues = {
  op: SharedValue<number>;
  y: SharedValue<number>;
  scale: SharedValue<number>;
};

function useSparkValues(): SparkValues {
  return { op: useSharedValue(0), y: useSharedValue(0), scale: useSharedValue(SPARK_START_SCALE) };
}

function useSparkStyle(s: SparkValues) {
  return useAnimatedStyle(() => ({
    opacity: s.op.value,
    transform: [{ translateY: s.y.value }, { scale: s.scale.value }],
  }));
}

export type TripClosedAnimationProps = {
  visible: boolean;
  onFinished: () => void;
  // The trip's name on the ticket: the same line the recap letter carries,
  // so the interstitial and the letter read as one object.
  title: string;
  // Formatted date span under the name; null while it isn't known.
  range?: string | null;
};

// Closing interstitial after the owner finished a trip early: a white
// full-screen cover, three polaroids gather behind the cinema ticket, the
// wax seal lands on its perforation, gold sparks rise. The mechanical
// guarantees follow the house pattern (MomentSubmissionAnimation.tsx): the
// visible animation runs via Reanimated on the UI thread, `onFinished` and
// the haptic hang off their own JS timers (the animation's completion
// callbacks fire immediately instead of after the duration on a device
// without an active native module, e.g. in tests), `onFinished` arrives
// exactly once per visible=true, an unmount or visible=false aborts cleanly,
// a fresh visible=true starts the full choreography over from the beginning.
export function TripClosedAnimation({ visible, onFinished, title, range }: TripClosedAnimationProps) {
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const windowSize = useWindowDimensions();

  const mountains = usePolaroidValues(POLAROIDS[0].start);
  const camper = usePolaroidValues(POLAROIDS[1].start);
  const beach = usePolaroidValues(POLAROIDS[2].start);
  const polaroidValues = [mountains, camper, beach];

  const ticketOpacity = useSharedValue(0);
  const ticketY = useSharedValue(0);
  const ticketScale = useSharedValue(1);
  const sealOpacity = useSharedValue(0);
  const sealScale = useSharedValue(SEAL_AIR_SCALE);
  const sparkA = useSparkValues();
  const sparkB = useSparkValues();
  const sparkC = useSparkValues();
  const sparkValues = [sparkA, sparkB, sparkC];
  const titleOpacity = useSharedValue(0);
  const titleY = useSharedValue(8);
  const subtitleOpacity = useSharedValue(0);
  const subtitleY = useSharedValue(8);

  // The ticket rises from half a screen below its resting place; measured
  // here instead of in the effect, so a rotation mid-run doesn't move it.
  const riseDistance = Math.round(windowSize.height * 0.5);

  // onFinished may change between start and end (a new reference on every
  // parent render) without restarting the running choreography.
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  });
  // Exactly-once guards per visible=true: the effect also depends on
  // reducedMotion, a change mid-animation reruns it and would, without
  // these refs, fire the haptic or the completion twice.
  const finishedFiredRef = useRef(false);
  const hapticFiredRef = useRef(false);

  useEffect(() => {
    const reset = () => {
      POLAROIDS.forEach((p, i) => {
        const w = polaroidValues[i];
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
      sparkValues.forEach((s) => {
        cancelAnimation(s.op);
        cancelAnimation(s.y);
        cancelAnimation(s.scale);
        s.op.value = 0;
        s.y.value = 0;
        s.scale.value = SPARK_START_SCALE;
      });
      for (const value of [
        ticketOpacity,
        ticketY,
        ticketScale,
        sealOpacity,
        sealScale,
        titleOpacity,
        titleY,
        subtitleOpacity,
        subtitleY,
      ]) {
        cancelAnimation(value);
      }
      ticketOpacity.value = 0;
      ticketY.value = riseDistance;
      ticketScale.value = 1;
      sealOpacity.value = 0;
      sealScale.value = SEAL_AIR_SCALE;
      titleOpacity.value = 0;
      titleY.value = 8;
      subtitleOpacity.value = 0;
      subtitleY.value = 8;
    };

    if (!visible) {
      reset();
      finishedFiredRef.current = false;
      hapticFiredRef.current = false;
      return;
    }

    reset();
    const ease = Easing.bezier(...motion.easeSmooth);

    if (reducedMotion) {
      // No flight, no drop: the ticket already stands with the wax on it,
      // both just fade in, then the text. The polaroids stay away.
      ticketY.value = 0;
      ticketOpacity.value = withTiming(1, { duration: REDUCED_FADE_MS, easing: ease });
      sealScale.value = 1;
      sealOpacity.value = withDelay(REDUCED_SEAL_MS, withTiming(1, { duration: REDUCED_FADE_MS, easing: ease }));
      titleY.value = 0;
      titleOpacity.value = withDelay(REDUCED_TITLE_MS, withTiming(1, { duration: REDUCED_FADE_MS, easing: ease }));
      subtitleY.value = 0;
      subtitleOpacity.value = withDelay(
        REDUCED_SUBTITLE_MS,
        withTiming(1, { duration: REDUCED_FADE_MS, easing: ease })
      );
    } else {
      POLAROIDS.forEach((p, i) => {
        const w = polaroidValues[i];
        // After the fly-in, each polaroid waits until the shared gather
        // start; the gap differs per polaroid because delay and fly-in
        // duration are staggered.
        const gatherGap = GATHER_START_MS - p.delay - p.flyInDuration;
        w.x.value = withSequence(
          withDelay(p.delay, withTiming(p.end.x, { duration: p.flyInDuration, easing: ease })),
          withDelay(gatherGap, withTiming(p.end.x * GATHER_SCALE, { duration: GATHER_MS, easing: ease }))
        );
        w.y.value = withSequence(
          withDelay(p.delay, withTiming(p.end.y, { duration: p.flyInDuration, easing: ease })),
          withDelay(
            gatherGap,
            withTiming(p.end.y * GATHER_SCALE + GATHER_SINK, { duration: GATHER_MS, easing: ease })
          )
        );
        w.rot.value = withSequence(
          withDelay(p.delay, withTiming(p.end.rot, { duration: p.flyInDuration, easing: ease })),
          withDelay(gatherGap, withTiming(p.end.rot * GATHER_SCALE, { duration: GATHER_MS, easing: ease }))
        );
        w.scale.value = withSequence(
          withDelay(p.delay, withTiming(p.end.scale, { duration: p.flyInDuration, easing: ease })),
          withDelay(gatherGap, withTiming(GATHER_SCALE, { duration: GATHER_MS, easing: ease }))
        );
        w.op.value = withSequence(
          withDelay(p.delay, withTiming(1, { duration: POLAROID_FADE_IN_MS, easing: ease })),
          withDelay(
            GATHER_START_MS - p.delay - POLAROID_FADE_IN_MS,
            withTiming(0, { duration: GATHER_MS, easing: ease })
          )
        );
      });

      ticketOpacity.value = withDelay(TICKET_START_MS, withTiming(1, { duration: TICKET_FADE_IN_MS, easing: ease }));
      ticketY.value = withDelay(TICKET_START_MS, withTiming(0, { duration: TICKET_RISE_MS, easing: ease }));
      // The dip under the landing wax: a quick press, then the house spring
      // brings the ticket back.
      ticketScale.value = withDelay(
        SEAL_LANDS_MS,
        withSequence(
          withTiming(TICKET_DIP_SCALE, { duration: TICKET_DIP_MS, easing: ease }),
          withSpring(1, motion.spring)
        )
      );

      sealOpacity.value = withDelay(SEAL_START_MS, withTiming(1, { duration: SEAL_FADE_IN_MS, easing: ease }));
      sealScale.value = withDelay(
        SEAL_START_MS,
        withSequence(
          withTiming(SEAL_TOUCH_SCALE, { duration: SEAL_FADE_IN_MS, easing: ease }),
          withTiming(SEAL_PRESSED_SCALE, { duration: SEAL_PRESS_MS, easing: ease }),
          withSpring(1, motion.spring)
        )
      );

      sparkValues.forEach((s, i) => {
        const start = SPARK_START_MS + i * SPARK_STAGGER_MS;
        s.op.value = withDelay(
          start,
          withSequence(
            withTiming(1, { duration: SPARK_RISE_IN_MS, easing: ease }),
            withTiming(0, { duration: SPARK_MS - SPARK_RISE_IN_MS, easing: ease })
          )
        );
        s.y.value = withDelay(
          start,
          withSequence(
            withTiming(-SPARK_PEAK, { duration: SPARK_RISE_IN_MS, easing: ease }),
            withTiming(-SPARK_RISE, { duration: SPARK_MS - SPARK_RISE_IN_MS, easing: ease })
          )
        );
        s.scale.value = withDelay(start, withTiming(1, { duration: SPARK_RISE_IN_MS, easing: ease }));
      });

      titleOpacity.value = withDelay(TITLE_START_MS, withTiming(1, { duration: motion.duration.gentle, easing: ease }));
      titleY.value = withDelay(TITLE_START_MS, withTiming(0, { duration: motion.duration.gentle, easing: ease }));
      subtitleOpacity.value = withDelay(
        SUBTITLE_START_MS,
        withTiming(1, { duration: motion.duration.gentle, easing: ease })
      );
      subtitleY.value = withDelay(
        SUBTITLE_START_MS,
        withTiming(0, { duration: motion.duration.gentle, easing: ease })
      );
    }

    // Haptic when the wax lands (§5: success), and the one completion timer.
    // Both deliberately JS timers separate from the UI-thread animation, see
    // the comment at the top of the component.
    const total = reducedMotion ? REDUCED_TOTAL_MS : TOTAL_MS;
    const hapticAt = reducedMotion ? REDUCED_SEAL_MS : SEAL_LANDS_MS;
    const hapticTimer = setTimeout(() => {
      if (hapticFiredRef.current) return;
      hapticFiredRef.current = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }, hapticAt);
    const finishedTimer = setTimeout(() => {
      if (finishedFiredRef.current) return;
      finishedFiredRef.current = true;
      onFinishedRef.current();
    }, total);

    return () => {
      clearTimeout(hapticTimer);
      clearTimeout(finishedTimer);
    };
    // The value objects are stable via useSharedValue, the effect should
    // only react to visibility and the motion setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reducedMotion]);

  const mountainsStyle = usePolaroidStyle(mountains);
  const camperStyle = usePolaroidStyle(camper);
  const beachStyle = usePolaroidStyle(beach);
  const polaroidStyles = [mountainsStyle, camperStyle, beachStyle];
  const sparkStyleA = useSparkStyle(sparkA);
  const sparkStyleB = useSparkStyle(sparkB);
  const sparkStyleC = useSparkStyle(sparkC);
  const sparkStyles = [sparkStyleA, sparkStyleB, sparkStyleC];

  const ticketStyle = useAnimatedStyle(() => ({
    opacity: ticketOpacity.value,
    transform: [{ translateY: ticketY.value }, { scale: ticketScale.value }],
  }));
  const sealStyle = useAnimatedStyle(() => ({
    opacity: sealOpacity.value,
    transform: [{ scale: sealScale.value }],
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleY.value }],
  }));
  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
    transform: [{ translateY: subtitleY.value }],
  }));

  if (!visible) return null;

  // Ticket about half the screen wide (180-220 points), the wax derives its
  // size from it, exactly as the recap letter does, so the two never drift.
  const ticketWidth = Math.min(220, Math.max(180, Math.round(windowSize.width * 0.5)));
  const ticketHeight = Math.round(ticketWidth / TICKET_ASPECT);
  const sealSize = Math.round(ticketWidth * TICKET_WAX_SHARE);
  const perforationY = ticketHeight * TICKET_PERFORATION_Y;
  // Same sizing as the submission success, the polaroids are the same props.
  const polaroidWidth = Math.min(180, Math.max(140, Math.round(windowSize.width * 0.44)));
  const polaroidHeight = Math.round(polaroidWidth * 1.2);

  const decorative = {
    accessible: false,
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no' as const,
  };

  return (
    // pointerEvents stays at the default "auto": the cover swallows every
    // touch on the screen underneath during the animation.
    <View
      testID="trip-closed-animation"
      accessible
      accessibilityLabel="Reise abgeschlossen, euer Recap ist bereit"
      style={[
        StyleSheet.absoluteFill,
        styles.cover,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.topSpace} />
      <View style={[styles.stage, { height: ticketHeight + spacing.xl }]}>
        {POLAROIDS.map((p, i) => (
          <Animated.View key={i} style={[styles.layer, polaroidStyles[i]]}>
            <Image
              testID="trip-closed-polaroid"
              {...decorative}
              source={p.source}
              style={{ width: polaroidWidth, height: polaroidHeight }}
              contentFit="contain"
            />
          </Animated.View>
        ))}
        {/* The ticket sits in front of the polaroids: they gather BEHIND it. */}
        <Animated.View testID="trip-closed-ticket" style={[styles.layer, ticketStyle]}>
          <View style={{ width: ticketWidth, height: ticketHeight }}>
            {/* The picture IS the card: frame, embossing, perforation and
                stub all come from the asset, no surface of our own. */}
            <Image {...decorative} source={TICKET_ASSET} style={StyleSheet.absoluteFill} contentFit="fill" />
            <View style={styles.inner}>
              <Text style={[type.bodyMedium, styles.chapter]}>Dein Recap</Text>
              <View style={styles.titleWrap}>
                <Text
                  style={[type.display, styles.tripTitle]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.35}
                >
                  {title}
                </Text>
              </View>
              {range ? (
                <Text testID="trip-closed-range" style={[type.body, styles.range]}>
                  {range}
                </Text>
              ) : null}
            </View>
            {/* Centred on the perforation, where the recap letter carries
                the wax later; `left: 50%` plus a negative margin instead of
                parent centering, because an absolute child with an inset is
                no longer centred by Yoga (see RevealSequence.tsx). */}
            <Animated.View
              testID="trip-closed-seal"
              style={[
                styles.wax,
                {
                  width: sealSize,
                  height: sealSize,
                  marginLeft: -sealSize / 2,
                  top: perforationY - sealSize / 2,
                },
                sealStyle,
              ]}
            >
              <Image {...decorative} source={SEAL_ASSET} style={StyleSheet.absoluteFill} contentFit="contain" />
            </Animated.View>
            {SPARKS.map((s, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.spark,
                  { marginLeft: s.offsetX - SPARK_SIZE / 2, top: perforationY + s.offsetY - SPARK_SIZE / 2 },
                  sparkStyles[i],
                ]}
              >
                <Sparkle size={SPARK_SIZE} color={palette.seal} strokeWidth={1.75} />
              </Animated.View>
            ))}
          </View>
        </Animated.View>
      </View>
      <View style={styles.textContainer}>
        <Animated.Text style={[styles.title, titleStyle]}>Reise abgeschlossen</Animated.Text>
        <Animated.Text style={[styles.subtitle, subtitleStyle]}>
          Alle Momente sind drin. Euer Recap ist bereit.
        </Animated.Text>
      </View>
      <View style={styles.bottomSpace} />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    backgroundColor: palette['bg-0'],
    alignItems: 'center',
    zIndex: 10,
    elevation: 10,
  },
  // 3:4 like the submission success: the stage sits in the upper-middle
  // area, the text follows below with room to breathe.
  topSpace: { flex: 3 },
  bottomSpace: { flex: 4 },
  stage: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  layer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The lines live in the ticket's main compartment, above the perforation,
  // the same staging as the recap letter (SealedLetter.tsx).
  inner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: `${TICKET_MAIN_END * 100}%`,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: '11%',
  },
  chapter: { color: palette['text-2'], letterSpacing: 3.5 },
  titleWrap: { alignSelf: 'stretch', marginTop: spacing.s },
  tripTitle: { color: palette['text-1'], textAlign: 'center' },
  range: { color: palette['text-2'], marginTop: spacing.base },
  wax: { position: 'absolute', left: '50%' },
  spark: { position: 'absolute', left: '50%' },
  textContainer: {
    alignItems: 'center',
    paddingHorizontal: spacing.screen,
    marginTop: spacing.xl,
  },
  title: {
    ...type.h2,
    color: palette['text-1'],
    textAlign: 'center',
  },
  subtitle: {
    ...type.secondary,
    color: palette['text-2'],
    textAlign: 'center',
    marginTop: spacing.s,
  },
});
