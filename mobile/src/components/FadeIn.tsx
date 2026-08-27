import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing } from 'react-native';
import { motion } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';

// DESIGN-LANGUAGE §5: "lists = 40ms stagger", the rows of a list appear one
// after another, not as a block. And "prefers-reduced-motion: everything
// becomes a 200ms fade", the same value as in Sheet.tsx (module-private
// there).
const STAGGER_MS = 40;
const REDUCED_DURATION_MS = 200;

// A row that fades in. Its own component because every row needs its own
// Animated.Value: §5 requires a 40ms stagger for lists, and that's its own
// delay per row. Grew up in the map sheets (moments of a cluster, trip
// days, tiles of moments without a place) and moved here once the trip
// picker needed the same rhythm; copies eventually ran at different rhythms.
export function FadeIn({ position, children }: { position: number; children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  // `useState` with an initializer instead of `useRef(...).current`: both
  // create the value exactly once, but reading a ref while rendering is a
  // lint error (react-hooks/refs).
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    // §5: with reduced motion everything becomes a single 200ms fade, the
    // rows then appear together, without staggering. Only `opacity` is
    // animated, so it runs on the UI thread.
    Animated.timing(opacity, {
      toValue: 1,
      duration: reducedMotion ? REDUCED_DURATION_MS : motion.duration.base,
      delay: reducedMotion ? 0 : position * STAGGER_MS,
      easing: Easing.bezier(...motion.easeSmooth),
      useNativeDriver: true,
    }).start();
  }, [opacity, reducedMotion, position]);

  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}
