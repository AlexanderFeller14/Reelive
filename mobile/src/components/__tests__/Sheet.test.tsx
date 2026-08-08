import { render, screen, fireEvent } from '@testing-library/react-native';
import { Animated, Dimensions, Easing, StyleSheet, Text } from 'react-native';
import * as React from 'react';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { cinema, motion, palette, radius, shadow } from '@/theme/tokens';
import { MAX_HOEHE_ANTEIL, Sheet, wischUeberSchwelle } from '../Sheet';

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/theme/useReducedMotion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

// Der resolvierte translateY-Wert des äusseren (Schatten-)Knotens — Animated.View
// löst seine Animated.Value-Props beim Rendern zu einfachen Zahlen auf, deshalb
// ist das über StyleSheet.flatten direkt prüfbar, ohne Refs aus der Komponente
// herauszureichen.
function translateYVon(knoten: ReturnType<typeof screen.getByTestId>): number | undefined {
  const flach = StyleSheet.flatten(knoten.props.style) as { transform?: { translateY?: number }[] };
  return flach.transform?.find((t) => 'translateY' in t)?.translateY;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseReducedMotion.mockReturnValue(false);
});

test('unsichtbar rendert nichts', async () => {
  await wrap(
    <Sheet sichtbar={false} onSchliessen={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  expect(screen.queryByTestId('sheet-backdrop')).toBeNull();
  expect(screen.queryByText('Inhalt')).toBeNull();
});

test('sichtbar zeigt Titel und beliebigen Inhalt', async () => {
  await wrap(
    <Sheet sichtbar titel="Kommentare" onSchliessen={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  expect(screen.getByText('Kommentare')).toBeTruthy();
  expect(screen.getByText('Inhalt')).toBeTruthy();
});

test('ohne Titel bleibt die Titelzeile weg', async () => {
  await wrap(
    <Sheet sichtbar onSchliessen={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  expect(screen.queryByText('Kommentare')).toBeNull();
});

test('Tipp auf den Hintergrund ruft onSchliessen', async () => {
  const onSchliessen = jest.fn();
  await wrap(
    <Sheet sichtbar onSchliessen={onSchliessen}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  await fireEvent.press(screen.getByTestId('sheet-backdrop'));
  expect(onSchliessen).toHaveBeenCalledTimes(1);
});

test('öffnet per spring-ui (DESIGN-LANGUAGE §5), wenn Bewegung nicht reduziert ist', async () => {
  const springSpy = jest.spyOn(Animated, 'spring');
  await wrap(
    <Sheet sichtbar onSchliessen={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  expect(springSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ toValue: 0, ...motion.spring })
  );
  springSpy.mockRestore();
});

test('reduzierte Bewegung: kein Spring, nur ein 200-ms-Fade', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  const springSpy = jest.spyOn(Animated, 'spring');
  const timingSpy = jest.spyOn(Animated, 'timing');
  await wrap(
    <Sheet sichtbar onSchliessen={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  expect(springSpy).not.toHaveBeenCalled();
  expect(timingSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ toValue: 1, duration: 200 })
  );
  springSpy.mockRestore();
  timingSpy.mockRestore();
});

test('nicht reduzierte Bewegung faded den Hintergrund über 250 ms (duration-base)', async () => {
  const timingSpy = jest.spyOn(Animated, 'timing');
  await wrap(
    <Sheet sichtbar onSchliessen={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  expect(timingSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ toValue: 1, duration: motion.duration.base })
  );
  timingSpy.mockRestore();
});

// Review-Minor: beide Animated.timing-Aufrufe liefen ohne `easing` — RN nimmt
// dann seine Standardkurve statt ease-smooth (Konvention siehe Input.tsx).
test('nutzt ease-smooth für die zeitbasierten Fades, nicht die RN-Standardkurve', async () => {
  const easingSpy = jest.spyOn(Easing, 'bezier');
  await wrap(
    <Sheet sichtbar onSchliessen={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  expect(easingSpy).toHaveBeenCalledWith(...motion.easeSmooth);
  easingSpy.mockRestore();
});

// Review Important 3 (Mutationslücke): AUSGANGSPOSITION auf 0 setzen blieb
// unentdeckt, weil nur Spies geprüft wurden, nie der tatsächliche Wert.
test('öffnet von deutlich ausserhalb des sichtbaren Bereichs, nicht von der Nullposition', async () => {
  await wrap(
    <Sheet sichtbar onSchliessen={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  const schatten = screen.getByTestId('sheet-schatten');
  expect(translateYVon(schatten)).toBeGreaterThan(100);
});

// Review Important 3: `translateY.setValue(0)` im reduced-motion-Zweig löschen
// blieb bislang unentdeckt — das Sheet bliebe für reduced-motion-Nutzende
// dauerhaft unterhalb des Bildschirms, unsichtbar.
test('reduzierte Bewegung hält die Position bei 0 — kein unsichtbares Sheet', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  await wrap(
    <Sheet sichtbar onSchliessen={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  const schatten = screen.getByTestId('sheet-schatten');
  expect(translateYVon(schatten)).toBe(0);
});

test('unmount räumt sauber auf', async () => {
  const { unmount } = await wrap(
    <Sheet sichtbar onSchliessen={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  await unmount();
});

describe('DESIGN-LANGUAGE §4 — Spec-Masse, einzeln geprüft (Mutationslücken aus dem Review)', () => {
  test('Radius 24 oben, nicht radius.control', async () => {
    await wrap(
      <Sheet sichtbar onSchliessen={jest.fn()}>
        <Text>Inhalt</Text>
      </Sheet>
    );
    const panel = screen.getByTestId('sheet-panel');
    const flach = StyleSheet.flatten(panel.props.style);
    expect(flach.borderTopLeftRadius).toBe(radius.card);
    expect(flach.borderTopRightRadius).toBe(radius.card);
  });

  test('shadow-3, nicht gelöscht — und auf dem Knoten mit der sichtbaren Fläche (iOS-Schatten braucht Content)', async () => {
    await wrap(
      <Sheet sichtbar onSchliessen={jest.fn()}>
        <Text>Inhalt</Text>
      </Sheet>
    );
    const schatten = screen.getByTestId('sheet-schatten');
    const flach = StyleSheet.flatten(schatten.props.style);
    expect(flach.shadowOpacity).toBe(shadow.s3.shadowOpacity);
    expect(flach.shadowRadius).toBe(shadow.s3.shadowRadius);
    expect(flach.elevation).toBe(shadow.s3.elevation);
    expect(flach.backgroundColor).toBe(palette['bg-0']);
  });

  test('der Grabber steht in Spec-Massen (36×4, Radius 999), nicht entfernt', async () => {
    await wrap(
      <Sheet sichtbar onSchliessen={jest.fn()}>
        <Text>Inhalt</Text>
      </Sheet>
    );
    const griff = screen.getByTestId('sheet-griff');
    const flach = StyleSheet.flatten(griff.props.style);
    expect(flach.width).toBe(36);
    expect(flach.height).toBe(4);
    expect(flach.borderRadius).toBe(radius.pill);
  });

  test('nur der Griffbereich trägt die Wisch-Handler, nicht das ganze Panel', async () => {
    await wrap(
      <Sheet sichtbar onSchliessen={jest.fn()}>
        <Text>Inhalt</Text>
      </Sheet>
    );
    const griffBereich = screen.getByTestId('sheet-griff-bereich');
    expect(typeof griffBereich.props.onStartShouldSetResponder).toBe('function');
    const panel = screen.getByTestId('sheet-panel');
    expect(panel.props.onStartShouldSetResponder).toBeUndefined();
  });
});

// Review Important 2: eine Maximalhöhe lässt sich aus einem Kind heraus nicht
// nachrüsten — Task 12 (Kommentarliste) braucht sie zwingend.
describe('Review Important 2 — Maximalhöhe und Kino-Variante', () => {
  // Re-Review: `maxHeight: '85%'` war mit hoher Wahrscheinlichkeit wirkungslos
  // — `panelClip` sitzt in `schatten`, und `schatten` ist `position:'absolute'`
  // OHNE `top` und ohne explizite Höhe, hat also keine DEFINITE Höhe, gegen die
  // ein Prozentwert auflösen könnte. `react-test-renderer` führt kein echtes
  // Yoga-Layout aus — ein „ist ein Prozentstring gesetzt"-Test hätte diesen
  // Fehler NIE sehen können, mit oder ohne Layout-Engine. Der Fix (numerisch
  // aus useWindowDimensions() statt Prozent-String, siehe MAX_HOEHE_ANTEIL in
  // Sheet.tsx) macht die Wirkung dagegen direkt prüfbar: eine Zahl lässt sich
  // exakt gegen die bekannte Fenstergrösse dieser Jest-Umgebung nachrechnen,
  // unabhängig davon, ob irgendein Elternknoten je eine definite Höhe bekommt.
  test('das Panel ist auf einen Anteil der tatsächlichen Fensterhöhe begrenzt (nicht auf einen wirkungslosen Prozent-String) und klippt überlaufenden Inhalt', async () => {
    await wrap(
      <Sheet sichtbar onSchliessen={jest.fn()}>
        <Text>Inhalt</Text>
      </Sheet>
    );
    const panel = screen.getByTestId('sheet-panel');
    const flach = StyleSheet.flatten(panel.props.style);
    const erwarteteHoehe = Dimensions.get('window').height * MAX_HOEHE_ANTEIL;
    expect(typeof flach.maxHeight).toBe('number');
    expect(flach.maxHeight).toBeCloseTo(erwarteteHoehe);
    expect(flach.overflow).toBe('hidden');
  });

  test('ohne `kino` nutzt das Sheet die Licht-Palette', async () => {
    await wrap(
      <Sheet sichtbar titel="Titel" onSchliessen={jest.fn()}>
        <Text>Inhalt</Text>
      </Sheet>
    );
    const schatten = screen.getByTestId('sheet-schatten');
    expect(StyleSheet.flatten(schatten.props.style).backgroundColor).toBe(palette['bg-0']);
    expect(StyleSheet.flatten(screen.getByText('Titel').props.style).color).toBe(palette['text-1']);
  });

  test('mit `kino` nutzt das Sheet die feste Kino-Palette (cinema-1) statt useTheme()', async () => {
    await wrap(
      <Sheet sichtbar titel="Titel" kino onSchliessen={jest.fn()}>
        <Text>Inhalt</Text>
      </Sheet>
    );
    const schatten = screen.getByTestId('sheet-schatten');
    expect(StyleSheet.flatten(schatten.props.style).backgroundColor).toBe(cinema['bg-1']);
    expect(StyleSheet.flatten(screen.getByText('Titel').props.style).color).toBe(cinema['text-1']);
  });
});

// Review Important 2: ein Eingabefeld am unteren Rand (Task 12) braucht
// Tastatur-Ausweichlogik, die sich aus einem Kind heraus ebenfalls nicht
// nachrüsten lässt (das Sheet selbst ist `bottom:0`-positioniert).
test('weicht der Tastatur aus (iOS: behavior="padding", gleiche Konvention wie preview.tsx)', async () => {
  await wrap(
    <Sheet sichtbar onSchliessen={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  // `behavior` selbst ist ein Konfigurations-Prop, den KeyboardAvoidingView
  // intern konsumiert statt ihn an den gerenderten Host-Knoten weiterzureichen
  // (diese RNTL-Version exponiert auch keine react-test-renderer-Introspektion
  // wie UNSAFE_getByType mehr, um die Komponente selbst statt des Host-Knotens
  // abzufragen). Beobachtbar ist der RESOLVIERTE Effekt: mit behavior="padding"
  // rendert KeyboardAvoidingView ein `paddingBottom` in seinem eigenen Style
  // (0 ohne sichtbare Tastatur) — ohne behavior fehlt dieser Style-Key
  // vollständig (manuell gegengeprüft). jest-expo mockt Platform.OS als 'ios'.
  const wurzel = screen.getByTestId('sheet-root');
  const flach = StyleSheet.flatten(wurzel.props.style);
  expect(flach).toHaveProperty('paddingBottom');
});

// wischUeberSchwelle ist bewusst als reine Funktion exportiert (siehe Sheet.tsx) —
// eine echte Wisch-Geste über PanResponder lässt sich ohne native Touch-Historie
// nicht verlässlich simulieren (im Projekt auch sonst nirgends getan, siehe
// preview.tsx: die dortige Caption-Drag-Geste hat aus demselben Grund keinen
// eigenen Gesten-Test). Die Entscheidung selbst ist hier trotzdem lückenlos
// geprüft; der Reset nach einem Wisch-Schliessen (Review-Minor, Ein-Frame-Sprung)
// ist eine direkte Folge davon und aus demselben Grund nicht separat simulierbar.
describe('wischUeberSchwelle', () => {
  test('kurzer, langsamer Wisch schliesst nicht', () => {
    expect(wischUeberSchwelle(20, 0.1)).toBe(false);
  });

  test('ein ausreichend weiter Weg schliesst', () => {
    expect(wischUeberSchwelle(120, 0)).toBe(true);
  });

  test('ein schneller Flick schliesst auch bei kurzem Weg', () => {
    expect(wischUeberSchwelle(10, 0.8)).toBe(true);
  });

  test('genau an der Weg-Schwelle schliesst noch nicht (exklusiv)', () => {
    expect(wischUeberSchwelle(96, 0)).toBe(false);
  });

  test('genau an der Geschwindigkeits-Schwelle schliesst noch nicht (exklusiv)', () => {
    expect(wischUeberSchwelle(0, 0.5)).toBe(false);
  });
});
