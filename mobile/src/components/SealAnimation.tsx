import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { motion, palette, radius, spacing, type } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { CounterRoll } from './CounterRoll';

const REDUCED_DURATION_MS = 200;
// After the choreography ends, the image holds still briefly so the rolled-up
// counter stays readable, only then does onFinished fire. The afterglow is a
// still frame, not an animation, and therefore doesn't count against the
// 700-900 ms budget of the sequence (DESIGN-LANGUAGE §5).
const AFTERGLOW_MS = 500;
// At 55% of the choreography the seal closes, that's where the success
// haptic belongs (§5), not at the start.
const SEAL_CLOSE_RATIO = 0.55;
// The counter rolls up during this fraction of the choreography.
const COUNTER_WINDOW = [0.7, 0.95] as const;

// Dimensions of the drawn film reel (top view: platter, hub, three winding
// holes). All layout constants for this one drawing, deliberately kept local
// instead of in the token set.
const REEL = 72;
const HUB = 14;
const HOLE = 8;
// The three holes sit 120° apart on a circle of radius 22 around the center
// (36, 36); the values are their computed left/top corners.
const HOLE_POSITIONS = [
  { left: 32, top: 10 },
  { left: 51, top: 43 },
  { left: 13, top: 43 },
] as const;
const SEAL_SIZE = 44;
const GLOW = 120;

type Props = {
  visible: boolean;
  onFinished: () => void;
  // Still frame of the moment just submitted (photo: the saved media, video:
  // the thumbnail). Without an image the sequence runs without a shrink motif.
  imageUri?: string | null;
  // Counter value BEFORE this moment; the sequence rolls up to +1.
  // null/undefined: the value just isn't available right now, the number is omitted.
  counter?: number | null;
};

// One of the two explicitly allowed sequences (DESIGN-LANGUAGE v2 §5):
// "Moment shrinks into the film reel, seal closes, counter rolls up.
// Haptic: success." It runs in the light app look, not in cinema mode: white
// background, seal symbolism in `seal` (§1: seal symbolism ONLY on a light
// background). The mechanical guarantees: the haptic fires exactly
// once per visible=true (on seal close), `onFinished` reliably arrives
// after choreography + afterglow, only `transform`/`opacity` are animated
// with `useNativeDriver` (UI thread), `prefers-reduced-motion` shows the
// final state as a 200 ms fade.
export function SealAnimation({ visible, onFinished, imageUri, counter }: Props) {
  const reducedMotion = useReducedMotion();
  const windowSize = useWindowDimensions();
  const [progress] = useState(() => new Animated.Value(0));
  // Ref instead of a direct closure: `onFinished` may change between the start
  // and end of the animation (a new function reference on every render of the
  // parent), without that restarting the running animation.
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  // Fix round 1: the effect (necessarily) also depends on `reducedMotion`,
  // because the duration depends on it. If the system setting changes while
  // the sequence is already running (visible stays true), the effect reruns
  // and would schedule the haptic a second time for the same seal. This ref
  // remembers "already fired for this visible=true" independent of the effect
  // restart, and is only reset once the sequence goes invisible again.
  const hapticFiredRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      hapticFiredRef.current = false;
      return;
    }

    const duration = reducedMotion ? REDUCED_DURATION_MS : motion.duration.feature;
    progress.setValue(0);
    // The visuals run with useNativeDriver on the UI thread (§5) and therefore
    // independent of the JS thread; its own completion callback is therefore
    // NOT a reliable timer (on a device without an active native Animated
    // module, e.g. in tests, it fires immediately instead of after `duration`).
    // Same principle as ShutterButton.tsx: the visible animation and the
    // timers for the haptic and the follow-up action run separately.
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      useNativeDriver: true,
    });
    animation.start();

    // Haptic on seal close (§5: success on sealing). In reduced mode the fade
    // shows the closed seal immediately, so it belongs at the start there.
    // .catch(): pure garnish, must never disturb the sealing itself (same
    // pattern as ShutterButton.lightFeedback).
    const hapticDelay = reducedMotion ? 0 : Math.round(duration * SEAL_CLOSE_RATIO);
    const hapticTimer = setTimeout(() => {
      if (hapticFiredRef.current) return;
      hapticFiredRef.current = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }, hapticDelay);

    const timer = setTimeout(() => onFinishedRef.current(), duration + AFTERGLOW_MS);

    // Cleanup on unmount/effect rerun: a running sequence must not fire
    // onFinished or the haptic at a component that no longer exists after
    // leaving the screen.
    return () => {
      clearTimeout(timer);
      clearTimeout(hapticTimer);
      animation.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reducedMotion]);

  if (!visible) return null;

  // §5: with prefers-reduced-motion the choreography becomes a 200 ms fade
  // over the final state: no shrinking, no pop, no rotation, no digit roll,
  // everything stands still, only the opacity comes in.
  const scrimOpacity = reducedMotion
    ? progress
    : progress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] });

  // The moment image starts almost full-screen as a card (radius 24) and
  // shrinks into the film reel, where it fades out on arrival.
  const imageWidth = windowSize.width - 2 * spacing.screen;
  const imageHeight = Math.round(imageWidth * (windowSize.height / windowSize.width));
  const imageTargetScale = REEL / imageWidth;
  const imageScale = progress.interpolate({
    inputRange: [0, 0.05, 0.55, 1],
    outputRange: [1, 1, imageTargetScale, imageTargetScale],
  });
  const imageOpacity = progress.interpolate({
    inputRange: [0, 0.48, 0.58, 1],
    outputRange: [1, 1, 0, 0],
  });

  // The film reel appears beneath the shrinking moment, does a small pop on
  // arrival, and rotates a bit further, as if it had wound up the moment.
  const reelOpacity = reducedMotion
    ? progress
    : progress.interpolate({ inputRange: [0, 0.2, 0.4, 1], outputRange: [0, 0, 1, 1] });
  const reelScale = reducedMotion
    ? 1
    : progress.interpolate({
        inputRange: [0, 0.5, 0.62, 0.75, 1],
        outputRange: [1, 1, 1.08, 1, 1],
      });
  const reelRotation = reducedMotion
    ? '0deg'
    : progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '0deg', '40deg'] });

  // The seal closes with a pulse: the seal arrives with the same bounce as
  // before, and behind it two seal-colored circles pulse up and fade out. No
  // gradient, no colored shadow: only opacity and size. Deliberately more
  // restrained on a light background than the cinema glow.
  const sealOpacity = reducedMotion
    ? progress
    : progress.interpolate({ inputRange: [0, 0.5, 0.62, 1], outputRange: [0, 0, 1, 1] });
  const sealScale = reducedMotion
    ? 1
    : progress.interpolate({
        inputRange: [0.5, 0.62, 0.75, 1],
        outputRange: [0.6, 1.15, 1, 1],
        extrapolateLeft: 'clamp',
      });
  const glow1Opacity = reducedMotion
    ? 0
    : progress.interpolate({
        inputRange: [0, 0.5, 0.62, 0.85, 1],
        outputRange: [0, 0, 0.25, 0, 0],
      });
  const glow1Scale = progress.interpolate({
    inputRange: [0, 0.5, 0.85, 1],
    outputRange: [0.5, 0.5, 1.6, 1.6],
  });
  const glow2Opacity = reducedMotion
    ? 0
    : progress.interpolate({
        inputRange: [0, 0.58, 0.7, 0.95, 1],
        outputRange: [0, 0, 0.15, 0, 0],
      });
  const glow2Scale = progress.interpolate({
    inputRange: [0, 0.58, 0.95, 1],
    outputRange: [0.7, 0.7, 2.1, 2.1],
  });

  // The counter block sits beneath the reel and rises a small amount as it
  // appears, while the digit rolls.
  const counterOpacity = reducedMotion
    ? progress
    : progress.interpolate({ inputRange: [0, 0.6, 0.75, 1], outputRange: [0, 0, 1, 1] });
  const counterLift = reducedMotion
    ? 0
    : progress.interpolate({ inputRange: [0, 0.6, 0.85, 1], outputRange: [12, 12, 0, 0] });

  const showsNumber = counter != null;
  const after = (counter ?? 0) + 1;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="seal">
      <Animated.View style={[StyleSheet.absoluteFill, styles.background, { opacity: scrimOpacity }]} />

      {imageUri != null && !reducedMotion && (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Animated.View style={{ opacity: imageOpacity, transform: [{ scale: imageScale }] }}>
            <Image
              testID="seal-moment"
              source={{ uri: imageUri }}
              style={{ width: imageWidth, height: imageHeight, borderRadius: radius.card }}
              contentFit="cover"
            />
          </Animated.View>
        </View>
      )}

      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Animated.View style={[styles.glow, { opacity: glow1Opacity, transform: [{ scale: glow1Scale }] }]} />
        <Animated.View style={[styles.glow, { opacity: glow2Opacity, transform: [{ scale: glow2Scale }] }]} />
        <Animated.View
          testID="seal-film-reel"
          style={[styles.reel, { opacity: reelOpacity, transform: [{ scale: reelScale }] }]}
        >
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: reelRotation }] }]}>
            {HOLE_POSITIONS.map((position, i) => (
              <View key={i} style={[styles.hole, position]} />
            ))}
          </Animated.View>
          <View style={styles.hub} />
        </Animated.View>
        <Animated.View style={[styles.seal, { opacity: sealOpacity, transform: [{ scale: sealScale }] }]}>
          <Lock size={20} color={palette.seal} strokeWidth={1.75} />
        </Animated.View>
      </View>

      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Animated.View
          style={[styles.counterBlock, { opacity: counterOpacity, transform: [{ translateY: counterLift }] }]}
        >
          {showsNumber && (
            <View testID="seal-counter">
              {reducedMotion ? (
                <Text style={styles.staticNumber}>{String(after)}</Text>
              ) : (
                <CounterRoll
                  from={counter}
                  to={after}
                  progress={progress}
                  progressWindow={COUNTER_WINDOW}
                />
              )}
            </View>
          )}
          <Text style={styles.line}>Bis zum Recap versiegelt.</Text>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  background: {
    backgroundColor: palette['bg-0'],
  },
  center: {
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
  reel: {
    width: REEL,
    height: REEL,
    borderRadius: radius.pill,
    backgroundColor: palette['bg-1'],
    borderWidth: 1.5,
    borderColor: palette.seal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hub: {
    width: HUB,
    height: HUB,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: palette.seal,
  },
  hole: {
    position: 'absolute',
    width: HOLE,
    height: HOLE,
    borderRadius: radius.pill,
    backgroundColor: palette['bg-0'],
  },
  seal: {
    position: 'absolute',
    width: SEAL_SIZE,
    height: SEAL_SIZE,
    borderRadius: radius.pill,
    backgroundColor: palette['bg-0'],
    borderWidth: 1.5,
    borderColor: palette.seal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Reel (72) + gap + half the block height: the block hangs fixed beneath
  // screen center, so the shrinking moment lands exactly on the reel.
  counterBlock: {
    position: 'absolute',
    top: '50%',
    marginTop: REEL / 2 + spacing.l,
    alignItems: 'center',
  },
  staticNumber: {
    ...type.display,
    color: palette['text-1'],
    textAlign: 'center',
  },
  line: {
    ...type.secondary,
    color: palette['text-2'],
    marginTop: spacing.s,
  },
});
