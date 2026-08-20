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
import { CounterRoll } from './CounterRoll';

// Timeline of the success animation after submitting (spec 2026-08-14):
// Phase 1 (0-900): three polaroids fly in one after another and stack up.
// Phase 2 (900-1250): the stack holds briefly and "settles" minimally.
// Phase 3 (1250-1700): all three pull together toward the center and
// vanish, as if the memories were being gathered.
// Phase 4 (from 1800): AFTER a brief pause on the empty stage, the
// confirmation pin springs in and comes fully to rest by ~2250.
// Phase 5 (from 2300): only once the pin has settled does the trip counter
// appear below it, it STARTS on the old count and then rolls exactly once
// to the new one; the rest of the total duration is reading time.
// The phases deliberately do NOT overlap (device acceptance 2026-08-14:
// "polaroids, then the checkmark, then the count, nice and clean").
// Title and subtitle fade in from below starting at 450/600 ms and stay.
const TOTAL_MS = 3_600;
const TITLE_START_MS = 450;
const SUBTITLE_START_MS = 600;
const SETTLE_START_MS = 900;
const GATHER_START_MS = 1_250;
const GATHER_DURATION_MS = 450;
const FADE_OUT_START_MS = 1_550;
const FADE_OUT_DURATION_MS = 150;
const PIN_START_MS = 1_800;
const FADE_IN_DURATION_MS = 200;
const GATHER_SCALE = 0.2;
// The counter appears AFTER the pin has finished springing in (phase 5):
// fades in softly starting at 2300 ms, then the old count stays briefly
// readable, the digit rolls 2700-3300 ms, deliberately slow.
// The roll runs through CounterRoll.tsx on its own RN-Animated timer,
// because the component originates from the old seal choreography and is
// deliberately reused unchanged. The timer covers ONLY the roll (window
// 0 → 1), not the total duration: previously the window sat in the tail
// of RNAnimated.timing's implicit inOut curve, the digit started too early
// and crept sub-pixel by sub-pixel toward its target (device acceptance:
// "not smooth"). This way the house curve sits exactly on the roll itself.
const COUNTER_FADE_IN_MS = 2_300;
const COUNTER_ROLL_START_MS = 2_700;
const COUNTER_ROLL_END_MS = 3_300;
const COUNTER_ROLL_DURATION_MS = COUNTER_ROLL_END_MS - COUNTER_ROLL_START_MS;
const COUNTER_WINDOW = [0, 1] as const;

// Reduced motion (§5: everything becomes fades): the polaroids appear
// briefly, static, in stacked pose, then the confirmation follows right
// away, overall noticeably shortened.
const REDUCED_TOTAL_MS = 900;
const REDUCED_PIN_MS = 350;
const REDUCED_FADE_MS = 150;

type Pose = { x: number; y: number; rot: number; scale: number };
type PolaroidSpec = {
  source: number;
  start: Pose;
  end: Pose;
  delay: number;
  flyInDuration: number;
};

// Fly-in choreography per spec: mountains from the left, camper from the
// right, beach from below toward the front. The order is also the
// stacking order, the last element sits on top.
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

export type MomentSubmissionAnimationProps = {
  visible: boolean;
  onFinished: () => void;
  // Counter value of the trip BEFORE this moment; the animation rolls up
  // to +1. null/undefined: the value just isn't available right now, the
  // number is omitted, everything else runs unchanged.
  counter?: number | null;
};

// Success interstitial screen after submitting: a white full-screen cover,
// three polaroids gather into a stack, pull together, the location pin in
// accent confirms with a checkmark. The mechanical guarantees follow the
// house pattern (SealAnimation.tsx/ShutterButton.tsx): the visible
// animation runs via Reanimated on the UI thread, `onFinished` and the
// haptic hang off their own JS timers, because the animation's completion
// callbacks fire immediately instead of after the duration on a device
// without an active native module (e.g. in tests). `onFinished` arrives
// exactly once per visible=true, an unmount or visible=false aborts
// cleanly, a fresh visible=true starts the full choreography over from the
// beginning.
export function MomentSubmissionAnimation({
  visible,
  onFinished,
  counter,
}: MomentSubmissionAnimationProps) {
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const windowSize = useWindowDimensions();
  // Own RN-Animated timer ONLY for the digit roll (see the comment above
  // COUNTER_WINDOW); the rest of the choreography runs on Reanimated.
  const [rollProgress] = useState(() => new RNAnimated.Value(0));

  const mountains = usePolaroidValues(POLAROIDS[0].start);
  const camper = usePolaroidValues(POLAROIDS[1].start);
  const beach = usePolaroidValues(POLAROIDS[2].start);
  const allValues = [mountains, camper, beach];

  // The "settle" of the finished stack (phase 2) sits on one shared parent
  // value instead of on each polaroid separately: one value, one motion.
  const stackScale = useSharedValue(1);
  const pinOpacity = useSharedValue(0);
  const pinScale = useSharedValue(0);
  const titleOpacity = useSharedValue(0);
  const titleY = useSharedValue(8);
  const subtitleOpacity = useSharedValue(0);
  const subtitleY = useSharedValue(8);
  // Deliberately opacity only, no movement: the number stands still, the
  // only motion is the one digit roll ("nice and clean", device
  // acceptance).
  const counterOpacity = useSharedValue(0);

  // onFinished may change between start and end (a new reference on every
  // parent render) without restarting the running choreography. Unlike the
  // older house pattern (SealAnimation.tsx), the ref is kept in sync in an
  // effect rather than during render, same effect, without the
  // react-hooks violation "Cannot access refs during render".
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  });
  // Exactly-once guard per visible=true: the effect (necessarily) also
  // depends on reducedMotion, a change mid-animation reruns it and would,
  // without these refs, fire the haptic or the completion twice (same
  // fix-round-1 lesson as in SealAnimation.tsx).
  const finishedFiredRef = useRef(false);
  const hapticFiredRef = useRef(false);

  useEffect(() => {
    const reset = () => {
      POLAROIDS.forEach((p, i) => {
        const w = allValues[i];
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
      for (const value of [
        stackScale,
        pinOpacity,
        pinScale,
        titleOpacity,
        titleY,
        subtitleOpacity,
        subtitleY,
        counterOpacity,
      ]) {
        cancelAnimation(value);
      }
      stackScale.value = 1;
      pinOpacity.value = 0;
      pinScale.value = 0;
      titleOpacity.value = 0;
      titleY.value = 8;
      subtitleOpacity.value = 0;
      subtitleY.value = 8;
      counterOpacity.value = 0;
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
      // No fly-in motion: the polaroids stand pre-stacked and just fade in
      // and out briefly, then comes the confirmation.
      POLAROIDS.forEach((p, i) => {
        const w = allValues[i];
        w.x.value = p.end.x;
        w.y.value = p.end.y;
        w.rot.value = p.end.rot;
        w.scale.value = p.end.scale;
        w.op.value = withSequence(
          withTiming(1, { duration: REDUCED_FADE_MS, easing: ease }),
          withDelay(REDUCED_FADE_MS, withTiming(0, { duration: REDUCED_FADE_MS, easing: ease }))
        );
      });
      pinScale.value = 1;
      pinOpacity.value = withDelay(REDUCED_PIN_MS, withTiming(1, { duration: REDUCED_FADE_MS, easing: ease }));
      titleOpacity.value = withTiming(1, { duration: REDUCED_FADE_MS, easing: ease });
      titleY.value = 0;
      subtitleOpacity.value = withTiming(1, { duration: REDUCED_FADE_MS, easing: ease });
      subtitleY.value = 0;
      counterOpacity.value = withDelay(
        REDUCED_PIN_MS,
        withTiming(1, { duration: REDUCED_FADE_MS, easing: ease })
      );
    } else {
      POLAROIDS.forEach((p, i) => {
        const w = allValues[i];
        // After the fly-in, each polaroid waits until the shared gather
        // start; the gap differs per polaroid because delay and fly-in
        // duration are staggered.
        const gatherGap = GATHER_START_MS - p.delay - p.flyInDuration;
        w.x.value = withSequence(
          withDelay(p.delay, withTiming(p.end.x, { duration: p.flyInDuration, easing: ease })),
          withDelay(gatherGap, withTiming(0, { duration: GATHER_DURATION_MS, easing: ease }))
        );
        w.y.value = withSequence(
          withDelay(p.delay, withTiming(p.end.y, { duration: p.flyInDuration, easing: ease })),
          withDelay(gatherGap, withTiming(0, { duration: GATHER_DURATION_MS, easing: ease }))
        );
        w.rot.value = withSequence(
          withDelay(p.delay, withTiming(p.end.rot, { duration: p.flyInDuration, easing: ease })),
          withDelay(gatherGap, withTiming(0, { duration: GATHER_DURATION_MS, easing: ease }))
        );
        w.scale.value = withSequence(
          withDelay(p.delay, withTiming(p.end.scale, { duration: p.flyInDuration, easing: ease })),
          withDelay(gatherGap, withTiming(GATHER_SCALE, { duration: GATHER_DURATION_MS, easing: ease }))
        );
        w.op.value = withSequence(
          withDelay(p.delay, withTiming(1, { duration: FADE_IN_DURATION_MS, easing: ease })),
          withDelay(
            FADE_OUT_START_MS - p.delay - FADE_IN_DURATION_MS,
            withTiming(0, { duration: FADE_OUT_DURATION_MS, easing: ease })
          )
        );
      });
      stackScale.value = withDelay(
        SETTLE_START_MS,
        withSequence(withTiming(1.03, { duration: 100, easing: ease }), withSpring(1, motion.spring))
      );
      pinOpacity.value = withDelay(PIN_START_MS, withTiming(1, { duration: 120, easing: ease }));
      pinScale.value = withDelay(
        PIN_START_MS,
        withSequence(withTiming(1.1, { duration: 180, easing: ease }), withSpring(1, motion.spring))
      );
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
      // Softer than the polaroids (gentle instead of 200 ms): the counter
      // is the calm closing note, not another effect in the mix.
      counterOpacity.value = withDelay(
        COUNTER_FADE_IN_MS,
        withTiming(1, { duration: motion.duration.gentle, easing: ease })
      );
    }

    // The digit-roll timer covers exactly the roll (start via delay, house
    // curve directly on the 600 ms, see the comment at COUNTER_WINDOW
    // above). Reduced: straight to the final count, the number then stands
    // static (a fixed text is shown below regardless).
    rollProgress.setValue(reducedMotion ? 1 : 0);
    const rollAnimation = reducedMotion
      ? null
      : RNAnimated.timing(rollProgress, {
          toValue: 1,
          delay: COUNTER_ROLL_START_MS,
          duration: COUNTER_ROLL_DURATION_MS,
          easing: RNEasing.bezier(...motion.easeSmooth),
          useNativeDriver: true,
        });
    rollAnimation?.start();

    // Haptic when the confirmation appears (§5: success), and the one
    // completion timer. Both deliberately kept as JS timers separate from
    // the UI-thread animation, see the comment at the top of the
    // component.
    const total = reducedMotion ? REDUCED_TOTAL_MS : TOTAL_MS;
    const hapticAt = reducedMotion ? REDUCED_PIN_MS : PIN_START_MS;
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
      rollAnimation?.stop();
    };
    // The value objects are stable via useSharedValue, the effect should
    // only react to visibility and the motion setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reducedMotion]);

  const mountainsStyle = usePolaroidStyle(mountains);
  const camperStyle = usePolaroidStyle(camper);
  const beachStyle = usePolaroidStyle(beach);
  const polaroidStyles = [mountainsStyle, camperStyle, beachStyle];

  const stackStyle = useAnimatedStyle(() => ({
    transform: [{ scale: stackScale.value }],
  }));
  const pinStyle = useAnimatedStyle(() => ({
    opacity: pinOpacity.value,
    transform: [{ scale: pinScale.value }],
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleY.value }],
  }));
  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
    transform: [{ translateY: subtitleY.value }],
  }));
  const counterStyle = useAnimatedStyle(() => ({
    opacity: counterOpacity.value,
  }));

  if (!visible) return null;

  // 140-180 points depending on screen width (originally 120-150 per spec,
  // deliberately bumped up a notch after the first device acceptance).
  const polaroidWidth = Math.min(180, Math.max(140, Math.round(windowSize.width * 0.44)));
  const polaroidHeight = Math.round(polaroidWidth * 1.2);

  return (
    // pointerEvents stays at the default "auto": the cover swallows every
    // touch on the screen underneath during the animation, including a
    // second tap on the submit button.
    <View
      testID="moment-animation"
      accessible
      accessibilityLabel="Moment erfolgreich eingesendet"
      style={[
        StyleSheet.absoluteFill,
        styles.cover,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.topSpace} />
      <View style={[styles.stage, { height: polaroidHeight + spacing.xxl * 2 }]}>
        <Animated.View style={[styles.centerLayer, stackStyle]}>
          {POLAROIDS.map((p, i) => (
            <Animated.View key={i} style={[styles.polaroidLayer, polaroidStyles[i]]}>
              <Image
                testID="moment-polaroid"
                accessible={false}
                accessibilityElementsHidden
                importantForAccessibility="no"
                source={p.source}
                style={{ width: polaroidWidth, height: polaroidHeight }}
                contentFit="contain"
              />
            </Animated.View>
          ))}
        </Animated.View>
        <Animated.View testID="moment-pin" style={[styles.centerLayer, pinStyle]}>
          {/* Location pin without SVG: three full corners, one pointed,
              rotated 45°, the checkmark rotates back to level in the
              middle. */}
          <View style={styles.pinDrop}>
            <View style={styles.pinContent}>
              <Check size={26} color={palette['on-accent']} strokeWidth={2.5} />
            </View>
          </View>
        </Animated.View>
        {/* The counter belongs to the confirmation in the CENTER: it
            appears right below the pin (device acceptance 2026-08-14), not
            in the text block. */}
        {counter != null && (
          <Animated.View testID="moment-counter" style={[styles.counterLayer, counterStyle]}>
            {reducedMotion ? (
              <Text style={styles.staticNumber}>{String(counter + 1)}</Text>
            ) : (
              <CounterRoll
                from={counter}
                to={counter + 1}
                progress={rollProgress}
                progressWindow={COUNTER_WINDOW}
              />
            )}
          </Animated.View>
        )}
      </View>
      <View style={styles.textContainer}>
        <Animated.Text style={[styles.title, titleStyle]}>Moment eingesendet</Animated.Text>
        <Animated.Text style={[styles.subtitle, subtitleStyle]}>
          Dein Moment ist unterwegs und bleibt bis zum Recap versiegelt.
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
  // 3:4 instead of 1:1: this keeps the stage in the upper-middle area, the
  // text follows below with room to breathe.
  topSpace: { flex: 3 },
  bottomSpace: { flex: 4 },
  stage: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  polaroidLayer: {
    position: 'absolute',
  },
  pinDrop: {
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
  pinContent: {
    transform: [{ rotate: '-45deg' }],
  },
  textContainer: {
    alignItems: 'center',
    paddingHorizontal: spacing.screen,
    marginTop: spacing.xl,
  },
  // Below the stage center, where the pin sits: half the pin height (32)
  // plus a designed gap. With left/right 0 instead of parent centering,
  // because an absolute child with an inset no longer gets centered by
  // Yoga (see RevealSequence.tsx).
  counterLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    marginTop: 32 + spacing.l,
    alignItems: 'center',
  },
  staticNumber: {
    ...type.display,
    color: palette['text-1'],
    textAlign: 'center',
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
