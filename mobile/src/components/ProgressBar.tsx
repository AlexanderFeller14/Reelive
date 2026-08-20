import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Pill } from '@/components/Pill';
import { cinema, radius, spacing } from '@/theme/tokens';

// DESIGN-LANGUAGE v2 §5: "linear is forbidden (exception: progress that
// reflects real time)." This bar is EXACTLY that exception, it reflects the
// actually elapsed display duration of a moment in the story player, not a
// UI transition animation. Do NOT "fix" it to `ease-smooth`.
const PROGRESS_EASING = Easing.linear;

// A thin line, no dedicated radius special case needed, the caps come from
// `radius.pill` (§3: exactly 12/24/999).
const BAR_HEIGHT = 3;

type Props = {
  /** Total number of moments in the reel, one segment per moment. */
  count: number;
  /** Index of the moment currently shown (0-based). */
  activeIndex: number;
  /** Total duration of the active moment in ms (playerLogic.durationFor). */
  durationMs: number;
  /**
   * Time already elapsed for the active moment in ms, 0 for a freshly
   * started moment, otherwise the state frozen at pause time
   * (PlayerState.fortschritt). The bar starts at this share and keeps
   * running from there in real time, instead of filling from the start on
   * every resume.
   */
  elapsedMs: number;
  paused: boolean;
};

// One segment per moment, the active one fills in real time (Task 11 brief,
// step 1). Only ONE Animated.Value for whichever segment is active: with
// hundreds of moments, a value per segment would be needless overhead, every
// other segment is statically either full or empty anyway, the animation
// runs purely via `transform: scaleX` with `transformOrigin: 'left'` (the
// same pattern as Input.tsx), which keeps it on the UI thread
// (`useNativeDriver: true`) and doesn't violate "transform/opacity only"
// (§5), unlike the ring in ShutterButton.tsx, which needs `strokeDashoffset`
// there as a justified exception, a horizontal bar gets by entirely without a
// special path.
export function ProgressBar({ count, activeIndex, durationMs, elapsedMs, paused }: Props) {
  const [activeShare] = useState(() => new Animated.Value(0));

  useEffect(() => {
    activeShare.stopAnimation();
    const start = durationMs > 0 ? Math.min(1, Math.max(0, elapsedMs / durationMs)) : 1;
    activeShare.setValue(start);
    // Paused or already finished: stay put here, don't keep running.
    if (paused || start >= 1) return;
    Animated.timing(activeShare, {
      toValue: 1,
      duration: Math.max(0, durationMs - elapsedMs),
      easing: PROGRESS_EASING,
      useNativeDriver: true,
    }).start();
    return () => activeShare.stopAnimation();
  }, [activeIndex, durationMs, elapsedMs, paused, activeShare]);

  return (
    <View style={styles.row} testID="progress-bar">
      {Array.from({ length: count }).map((_, i) => (
        // Task 10, Phase 6: a dedicated `Pill` (blur + tint) PER segment,
        // not a single one across the whole row, which preserves exactly the
        // existing look (each segment individually a rounded pill with a
        // visible gap in between, DESIGN-LANGUAGE §4 "Pill Control"). A known
        // trade-off for VERY large `count` (see the comment on `activeShare`
        // above, "hundreds of moments"): that then means just as many native
        // blur layers side by side, a performance effect that can only be
        // judged on a device (Spec §10), deliberately not "optimized" ahead
        // of time here (a single shared blur surface would tint the gaps
        // between segments along with it and change the look).
        <Pill key={i} style={styles.track} testID={`progress-segment-${i}`}>
          {i < activeIndex && <View testID={`progress-full-${i}`} style={styles.staticFill} />}
          {i === activeIndex && (
            <Animated.View
              testID="progress-active"
              style={[
                styles.staticFill,
                { transform: [{ scaleX: activeShare }], transformOrigin: 'left' },
              ]}
            />
          )}
        </Pill>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.xs },
  track: {
    flex: 1,
    height: BAR_HEIGHT,
    borderRadius: radius.pill,
  },
  staticFill: { flex: 1, backgroundColor: cinema['text-1'] },
});
