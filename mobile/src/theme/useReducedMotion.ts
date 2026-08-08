import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// Respektiert `prefers-reduced-motion` (DESIGN-LANGUAGE v2 §5): fragt den
// Systemzustand initial ab und abonniert Änderungen zur Laufzeit.
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    // `.catch` ist Pflicht, nicht Zierde: ein abgelehntes Promise aus einem
    // nativen Modul wird sonst zu einer unbehandelten Ablehnung, die in
    // Release-Builds als Absturz zaehlt — und das fuer eine reine
    // Komfortabfrage. Faellt sie aus, bleibt es beim Startwert `false`:
    // Bewegung an, so wie ohne die Einstellung.
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
