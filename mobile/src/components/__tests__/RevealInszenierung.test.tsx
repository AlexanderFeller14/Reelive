import { render, act, screen } from '@testing-library/react-native';
import * as React from 'react';
import { Animated } from 'react-native';
import { RevealInszenierung } from '../RevealInszenierung';
import { cinema, motion } from '@/theme/tokens';

const mockNotificationAsync = jest.fn(async (..._args: unknown[]) => {});
jest.mock('expo-haptics', () => ({
  notificationAsync: (...args: unknown[]) => mockNotificationAsync(...args),
  NotificationFeedbackType: { Success: 'success' },
}));

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/theme/useReducedMotion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

// Review Important 2: die ursprüngliche Test-Suite prüfte ausschliesslich
// Mechanik (Haptik, Timer, reduced motion), nie, OB überhaupt ein Siegel,
// ein Aufbruch oder ein einziger Funke im Baum landet. Ein lokaler Ersatz
// für die drei Icons macht genau das prüfbar: identifizierbare Platzhalter
// mit `testID`, die die tatsächlich übergebenen `color`/`size`-Props
// durchreichen, robuster als die interne SVG-Pfad-Struktur von
// lucide-react-native zu parsen, und funktioniert trotz des
// `moduleNameMapper` für `lucide-react-native` in der Jest-Konfiguration
// (jest.mock() gewinnt für den exakten Modul-Specifier).
jest.mock('lucide-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const stub = (name: string) => {
    const Component = ({ color, size }: { color?: string; size?: number }) =>
      React.createElement(View, { testID: `icon-${name}`, color, size });
    Component.displayName = name;
    return Component;
  };
  return { Lock: stub('Lock'), LockOpen: stub('LockOpen'), Sparkle: stub('Sparkle') };
});

jest.useFakeTimers();

beforeEach(() => {
  jest.clearAllMocks();
  mockUseReducedMotion.mockReturnValue(false);
});

test('unsichtbar löst weder Haptik noch onFertig aus', async () => {
  const onFertig = jest.fn();
  const { unmount } = await render(<RevealInszenierung sichtbar={false} onFertig={onFertig} />);
  await act(async () => {
    jest.advanceTimersByTime(2_000);
  });
  expect(mockNotificationAsync).not.toHaveBeenCalled();
  expect(onFertig).not.toHaveBeenCalled();
  await unmount();
});

test('sichtbar löst die success-Haptik genau einmal aus', async () => {
  const onFertig = jest.fn();
  const { rerender, unmount } = await render(<RevealInszenierung sichtbar={true} onFertig={onFertig} />);
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockNotificationAsync).toHaveBeenCalledWith('success');

  // Ein erneutes Rendern bei unverändert sichtbar=true darf die Haptik nicht
  // ein zweites Mal auslösen.
  await act(async () => {
    rerender(<RevealInszenierung sichtbar={true} onFertig={onFertig} />);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);

  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  await unmount();
});

test('ein Wechsel von prefers-reduced-motion während der Inszenierung feuert die Haptik nicht zweimal', async () => {
  const onFertig = jest.fn();
  const { rerender, unmount } = await render(<RevealInszenierung sichtbar={true} onFertig={onFertig} />);
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);

  mockUseReducedMotion.mockReturnValue(true);
  await act(async () => {
    rerender(<RevealInszenierung sichtbar={true} onFertig={onFertig} />);
  });

  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);

  await act(async () => {
    jest.advanceTimersByTime(200);
  });
  await unmount();
});

test('onFertig kommt nach der vollen Inszenierungsdauer (700–900 ms)', async () => {
  const onFertig = jest.fn();
  const { unmount } = await render(<RevealInszenierung sichtbar={true} onFertig={onFertig} />);

  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  expect(onFertig).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(onFertig).toHaveBeenCalledTimes(1);

  await unmount();
});

test('bei reduzierter Bewegung ist die Dauer ein kurzer 200-ms-Fade', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  const onFertig = jest.fn();
  const { unmount } = await render(<RevealInszenierung sichtbar={true} onFertig={onFertig} />);

  await act(async () => {
    jest.advanceTimersByTime(199);
  });
  expect(onFertig).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onFertig).toHaveBeenCalledTimes(1);

  await unmount();
});

test('ein Unmount während der Inszenierung ruft onFertig nicht mehr auf', async () => {
  const onFertig = jest.fn();
  const { unmount } = await render(<RevealInszenierung sichtbar={true} onFertig={onFertig} />);
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  await unmount();
  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  expect(onFertig).not.toHaveBeenCalled();
});

test('unsichtbar rendert nichts (kein Overlay im Baum)', async () => {
  const onFertig = jest.fn();
  const { queryByTestId, unmount } = await render(
    <RevealInszenierung sichtbar={false} onFertig={onFertig} />
  );
  expect(queryByTestId('reveal-inszenierung')).toBeNull();
  await unmount();
});

test('sichtbar rendert das Inszenierungs-Overlay', async () => {
  const onFertig = jest.fn();
  const { queryByTestId, unmount } = await render(
    <RevealInszenierung sichtbar={true} onFertig={onFertig} />
  );
  expect(queryByTestId('reveal-inszenierung')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  await unmount();
});

// === Review Important 2: die eigentliche §5-Anforderung («Siegel bricht
// auf, Gold-Funken ✦ steigen, kein Konfetti») wird jetzt tatsächlich
// geprüft, nicht nur die Mechanik drumherum. ===

test('zeigt sowohl das geschlossene (Lock) als auch das offene Siegel (LockOpen), beide in der Kino-Gold-Farbe', async () => {
  const onFertig = jest.fn();
  const { unmount } = await render(<RevealInszenierung sichtbar={true} onFertig={onFertig} />);

  const lock = screen.getByTestId('icon-Lock');
  const lockOpen = screen.getByTestId('icon-LockOpen');
  // §1: `seal-glow`, nie `accent` oder ein fremdes Hex-Literal.
  expect(lock.props.color).toBe(cinema['seal-glow']);
  expect(lockOpen.props.color).toBe(cinema['seal-glow']);

  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  await unmount();
});

test('genau fünf Gold-Funken steigen, kein Konfetti, alle in der Kino-Gold-Farbe', async () => {
  const onFertig = jest.fn();
  const { unmount } = await render(<RevealInszenierung sichtbar={true} onFertig={onFertig} />);

  const funken = screen.getAllByTestId('icon-Sparkle');
  // Weder mehr (Konfetti-artige Menge) noch weniger, und keiner davon in
  // irgendeiner anderen Farbe als seal-glow (bunte Quadrate wären hier
  // durchgerutscht).
  expect(funken).toHaveLength(5);
  funken.forEach((funke) => expect(funke.props.color).toBe(cinema['seal-glow']));

  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  await unmount();
});

// Review Major 1: die Funken sassen wegen gesetzter `left`/`top`-Insets auf
// einem `position: absolute`-Kind in der oberen linken Bildschirmecke statt
// zentriert ums Siegel verteilt, ein gesetzter Inset sticht in Yoga IMMER
// die `alignItems`/`justifyContent: center`-Ausrichtung des Elternteils aus.
// Dieser Test prüft die Bedingung strukturell: kein `left`/`top`, nur
// `transform` mit fünf UNTERSCHIEDLICHEN `translateX`-Werten (die Streuung).
test('die Funken sind ausschliesslich per transform positioniert, kein left/top, das die Zentrierung des Elternteils aussticht', async () => {
  const onFertig = jest.fn();
  const { unmount } = await render(<RevealInszenierung sichtbar={true} onFertig={onFertig} />);

  const funkenHuellen = screen.root!.queryAll(
    (i) =>
      i.type === 'View' &&
      Array.isArray((i.props.style as { transform?: unknown[] } | undefined)?.transform) &&
      (i.props.style as { transform: Record<string, unknown>[] }).transform.some(
        (t) => 'translateX' in t
      )
  );
  expect(funkenHuellen).toHaveLength(5);

  funkenHuellen.forEach((huelle) => {
    const stil = huelle.props.style as { left?: unknown; top?: unknown };
    expect(stil.left).toBeUndefined();
    expect(stil.top).toBeUndefined();
  });

  const versaetzeX = funkenHuellen.map(
    (h) => (h.props.style as { transform: { translateX: number }[] }).transform[0].translateX
  );
  expect(new Set(versaetzeX).size).toBe(5);

  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  await unmount();
});

// Review Important 2, Mutationen 4+5: fängt sowohl das Entfernen von
// `useNativeDriver: true` als auch ein nachträglich ergänztes
// `easing: Easing.linear` (§5: «linear ist verboten») in einem einzigen
// exakten Abgleich der Konfiguration ab, ein Spy auf `Animated.timing`
// selbst, unabhängig davon, ob die Animation im Testlauf je fortschreitet.
test('startet die Timing-Animation ausschliesslich mit useNativeDriver, ohne eigene Easing-Funktion', async () => {
  const timingSpy = jest.spyOn(Animated, 'timing');
  const onFertig = jest.fn();
  const { unmount } = await render(<RevealInszenierung sichtbar={true} onFertig={onFertig} />);

  expect(timingSpy).toHaveBeenCalledWith(expect.anything(), {
    toValue: 1,
    duration: motion.duration.feature,
    useNativeDriver: true,
  });

  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  await unmount();
  timingSpy.mockRestore();
});

// Review Important 2, Mutation 7: eine auf einen einzigen Wert eingefrorene
// outputRange wäre über den gerenderten Endzustand NICHT beobachtbar, im
// Testlauf bewegt sich `fortschritt._value` (useNativeDriver: true, kein
// natives Animated-Modul verbunden) ohnehin nie über 0 hinaus, jede
// Interpolation zeigt also so oder so nur ihren linken Randwert. Deshalb
// wird hier die tatsächlich übergebene Konfiguration jedes `interpolate()`-
// Aufrufs geprüft, nicht ein Render-Snapshot.
test('jede Interpolation bewegt sich tatsächlich, keine outputRange ist auf einen einzigen Wert eingefroren', async () => {
  const interpolateSpy = jest.spyOn(Animated.Value.prototype, 'interpolate');
  const onFertig = jest.fn();
  const { unmount } = await render(<RevealInszenierung sichtbar={true} onFertig={onFertig} />);

  // scrim, Siegel-zu (Opacity+Scale), Siegel-auf (Opacity+Scale) und fünf
  // Funken (je Opacity+TranslateY), 1 + 2 + 2 + 5*2 = 15 Aufrufe.
  expect(interpolateSpy.mock.calls.length).toBe(15);
  interpolateSpy.mock.calls.forEach(([config]) => {
    const outputRange = (config as { outputRange: number[] }).outputRange;
    expect(new Set(outputRange).size).toBeGreaterThan(1);
  });

  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  await unmount();
  interpolateSpy.mockRestore();
});

// Review Minor: anders als bei Versiegelung.tsx liegen hier tippbare,
// teils destruktive Aktionen unter dem Overlay (Reise löschen/bearbeiten,
// Mitglied entfernen), `pointerEvents="none"` liesse Tipps während der
// ganzen Inszenierung ungehindert durch.
test('blockiert Tipps auf darunterliegende Flächen, solange sie läuft (pointerEvents)', async () => {
  const onFertig = jest.fn();
  const { unmount } = await render(<RevealInszenierung sichtbar={true} onFertig={onFertig} />);

  expect(screen.getByTestId('reveal-inszenierung').props.pointerEvents).toBe('auto');

  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  await unmount();
});
