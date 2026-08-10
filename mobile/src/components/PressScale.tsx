import { useRef } from 'react';
import { Animated, Pressable, type PressableProps } from 'react-native';
import { motion } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';

type Props = PressableProps & { scaleTo?: number };

// Press-Feedback gemäss DESIGN-LANGUAGE v2 §5: Scale per Spring (spring-ui),
// nie Opacity-Dimmen. Buttons/Tabs 0.97, randlose Karten 0.98, FAB 0.94.
export function PressScale({ scaleTo = 0.97, children, onPressIn, onPressOut, ...rest }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();
  const springTo = (toValue: number) => {
    // Reduced Motion (§5): Scale bleibt bei 1, keine Spring-Animation.
    // `setValue(1)` statt eines blossen `return`: schaltet jemand die
    // Systemeinstellung mitten im Druck um, steht `scale` bereits auf 0.97,
    // ein reines Aussteigen haette das Element dauerhaft geschrumpft stehen
    // lassen. So endet jeder Weg durch diese Funktion bei 1.
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
