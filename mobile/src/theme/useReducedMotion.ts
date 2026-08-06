import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// Respektiert `prefers-reduced-motion` (DESIGN-LANGUAGE v2 §5): fragt den
// Systemzustand initial ab und abonniert Änderungen zur Laufzeit.
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReducedMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}
