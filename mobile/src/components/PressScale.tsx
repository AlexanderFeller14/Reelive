import { useRef, useState } from 'react';
import { Animated, Pressable, type PressableProps } from 'react-native';
import { motion } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';

type Props = PressableProps & { scaleTo?: number };

// Press feedback per DESIGN-LANGUAGE v2 §5: scale via spring (spring-ui),
// never opacity dimming. Buttons/tabs 0.97, borderless cards 0.98, FAB 0.94.
export function PressScale({ scaleTo = 0.97, children, onPressIn, onPressOut, ...rest }: Props) {
  const [scale] = useState(() => new Animated.Value(1));
  const reducedMotion = useReducedMotion();
  const springTo = (toValue: number) => {
    // Reduced motion (§5): scale stays at 1, no spring animation.
    // `setValue(1)` instead of a bare `return`: if someone flips the system
    // setting mid-press, `scale` already sits at 0.97, and simply bailing out
    // would have left the element permanently shrunk. This way every path
    // through this function ends at 1.
    if (reducedMotion) {
      scale.setValue(1);
      return;
    }
    Animated.spring(scale, { toValue, useNativeDriver: true, ...motion.spring }).start();
  };

  return (
    <Pressable
      {...rest}
      onPressIn={(e) => {
        springTo(scaleTo);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        springTo(1);
        onPressOut?.(e);
      }}
    >
      {(state) => (
        <Animated.View style={{ transform: [{ scale }] }}>
          {typeof children === 'function' ? children(state) : children}
        </Animated.View>
      )}
    </Pressable>
  );
}
