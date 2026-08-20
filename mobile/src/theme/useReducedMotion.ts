import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// Respects `prefers-reduced-motion` (DESIGN-LANGUAGE v2 §5): reads the system
// state once at the start and subscribes to changes at runtime.
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    // `.catch` is mandatory, not decoration: a rejected promise from a native
    // module otherwise turns into an unhandled rejection, which counts as a
    // crash in release builds, and that for a pure comfort query. If the query
    // fails, the initial value `false` stands: motion on, just like without the
    // setting.
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReducedMotion(enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}
