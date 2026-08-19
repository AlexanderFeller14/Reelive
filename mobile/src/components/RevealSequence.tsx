import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Lock, LockOpen, Sparkle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { cinema, motion } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';

const REDUCED_DURATION_MS = 200;

type Props = {
  visible: boolean;
  onFinished: () => void;
};

// Five sparks with a slightly staggered start ("scatter"), so they don't
// rise as a single clump, each still reads from the SAME `progress` value,
// so there's still exactly one clock (see comment below, same principle as
// SealAnimation.tsx).
//
// Review Major 1: `offsetX`/`offsetY` below are deliberately expressed via
// `transform` (translateX/translateY), never via `left`/`top`. The parent
// (`styles.center`) centers via `alignItems`/`justifyContent: 'center'`,
// but as soon as a child with `position: 'absolute'` gets an inset
// (`left`/`top`/`right`/`bottom`), Yoga ALWAYS lets the inset win over the
// parent's alignment (react-native/ReactCommon/yoga/yoga/algorithm/
// AbsoluteLayout.cpp: `justifyAbsoluteChild`/`alignAbsoluteChild` only run
// when NO inset is set). With `left`/`top` all five sparks sat relative to
// the top-left corner of the whole screen instead of spread around the
// seal, so using only `transform` here isn't just closer to §5 ("only
// transform and opacity"), it's the only way the parent's centering
// survives at all.
//
// `offsetX`/`offsetY` sit on the 4-pt grid from §3 (even though this is a
// motion distance rather than a layout distance), SPARK_RISE below is the
// only named exception to that.
const SPARKS = [
  { offsetX: -48, offsetY: 8, startOffset: 0 },
  { offsetX: -24, offsetY: -16, startOffset: 0.07 },
  { offsetX: 8, offsetY: 12, startOffset: 0.02 },
  { offsetX: 24, offsetY: -12, startOffset: 0.1 },
  { offsetX: 48, offsetY: 4, startOffset: 0.05 },
] as const;

// How many pixels the sparks rise above their start point. Deliberately
// left outside the §3 values {4,8,12,16,24,32,48}: this is a motion
// distance, not a distance between two surfaces, the one exception in this
// file, so it's named here instead of passing silently.
const SPARK_RISE = 96;

// The second of the two explicitly allowed set pieces (DESIGN-LANGUAGE v2
// §5): "The seal breaks open, gold sparks ✦ rise (no confetti). Haptics:
// success." Structure deliberately identical to SealAnimation.tsx (the
// model per the task-9 brief): a single Animated.Value drives the scrim,
// seal, and spark choreography at once, the haptic fires exactly once per
// visible=true (a ref rather than state, a restart of the effect e.g. from
// a `reducedMotion` change mid-sequence must not fire it twice), `onFinished`
// arrives via its own `setTimeout`, because the UI-thread animation itself
// doesn't provide a reliable clock for follow-up actions (in tests without
// an active native Animated module its own completion callback fires
// immediately instead of after `duration`). Only `transform`/`opacity` are
// animated, with `useNativeDriver`, `prefers-reduced-motion` shortens it to
// a 200 ms fade.
export function RevealSequence({ visible, onFinished }: Props) {
  const reducedMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const hapticFiredRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      hapticFiredRef.current = false;
      return;
    }

    if (!hapticFiredRef.current) {
      hapticFiredRef.current = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }

    const duration = reducedMotion ? REDUCED_DURATION_MS : motion.duration.feature;
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      useNativeDriver: true,
    });
    animation.start();
    const timer = setTimeout(() => onFinishedRef.current(), duration);

    // Cleanup on unmount/effect re-run: a running animation must not fire
    // onFinished at a component that's already gone after leaving the screen.
    return () => {
      clearTimeout(timer);
      animation.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reducedMotion]);

  if (!visible) return null;

  const scrimOpacity = progress.interpolate({
    inputRange: [0, 0.15, 1],
    outputRange: [0, 1, 1],
  });
  // The closed seal: briefly visible, then it breaks open, a brisk scale
  // pop instead of a plain vanish.
  const sealOpacity = progress.interpolate({
    inputRange: [0, 0.25, 0.4],
    outputRange: [1, 1, 0],
    extrapolateRight: 'clamp',
  });
  const sealScale = progress.interpolate({
    inputRange: [0, 0.25, 0.4],
    outputRange: [1, 1, 1.3],
    extrapolateRight: 'clamp',
  });
  // The open seal comes in afterward, with the same bounce as
  // SealAnimation.tsx (0.6 → 1.15 → 1), the visual counterpart to closing.
  const openOpacity = progress.interpolate({
    inputRange: [0.3, 0.45, 1],
    outputRange: [0, 1, 1],
    extrapolateLeft: 'clamp',
  });
  const openScale = progress.interpolate({
    inputRange: [0.3, 0.45, 0.6, 1],
    outputRange: [0.6, 1.15, 1, 1],
    extrapolateLeft: 'clamp',
  });

  return (
    // Review Minor: UNLIKE SealAnimation.tsx (where only the capture preview
    // sits underneath), this overlay in the trip detail covers tappable,
    // partly destructive actions ("delete trip", "edit trip", remove-member
    // crosses). `pointerEvents="none"` would let taps through the seemingly
    // opaque overlay onto these surfaces for the whole sequence, so this is
    // explicitly "auto" here (blocks everything underneath), unlike "none"
    // there.
    <View style={StyleSheet.absoluteFill} pointerEvents="auto" testID="reveal-inszenierung">
      <Animated.View style={[StyleSheet.absoluteFill, styles.background, { opacity: scrimOpacity }]} />
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Animated.View style={[styles.icon, { opacity: sealOpacity, transform: [{ scale: sealScale }] }]}>
          <Lock size={40} color={cinema['seal-glow']} strokeWidth={1.75} />
        </Animated.View>
        <Animated.View style={[styles.icon, { opacity: openOpacity, transform: [{ scale: openScale }] }]}>
          <LockOpen size={40} color={cinema['seal-glow']} strokeWidth={1.75} />
        </Animated.View>
        {SPARKS.map((spark, i) => {
          // Each spark gets its own time window within `progress`, shifted
          // by `startOffset`, the same idea as the staggered list animations
          // in DESIGN-LANGUAGE §5 (stagger 40 ms), just here as a share of
          // the same 700-900 ms sequence instead of its own timer.
          const start = 0.3 + spark.startOffset;
          const sparkOpacity = progress.interpolate({
            inputRange: [start, start + 0.15, start + 0.35, 1],
            outputRange: [0, 1, 1, 0],
            extrapolateLeft: 'clamp',
          });
          // Starts at `offsetY` (the small vertical scatter) and rises
          // `SPARK_RISE` pixels further from there, both via `translateY`,
          // not `top` (see the comment at SPARKS above).
          const sparkTranslateY = progress.interpolate({
            inputRange: [start, 1],
            outputRange: [spark.offsetY, spark.offsetY - SPARK_RISE],
            extrapolateLeft: 'clamp',
          });
          return (
            <Animated.View
              key={i}
              style={[
                styles.spark,
                {
                  opacity: sparkOpacity,
                  // `translateX` is a fixed value here (not animated), a
                  // plain horizontal offset, combined with the animated
                  // `translateY` in the same array.
                  transform: [{ translateX: spark.offsetX }, { translateY: sparkTranslateY }],
                },
              ]}
            >
              <Sparkle size={16} color={cinema['seal-glow']} strokeWidth={1.75} />
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  background: {
    backgroundColor: cinema['bg-0'],
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    position: 'absolute',
  },
  spark: {
    position: 'absolute',
  },
});
