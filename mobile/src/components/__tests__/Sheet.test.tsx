import { render, screen, fireEvent } from '@testing-library/react-native';
import { Animated, Text } from 'react-native';
import * as React from 'react';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { motion } from '@/theme/tokens';
import { Sheet, wischUeberSchwelle } from '../Sheet';

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/theme/useReducedMotion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

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

test('unmount räumt sauber auf', async () => {
  const { unmount } = await wrap(
    <Sheet sichtbar onSchliessen={jest.fn()}>
      <Text>Inhalt</Text>
    </Sheet>
  );
  await unmount();
});

// wischUeberSchwelle ist bewusst als reine Funktion exportiert (siehe Sheet.tsx) —
// eine echte Wisch-Geste über PanResponder lässt sich ohne native Touch-Historie
// nicht verlässlich simulieren (im Projekt auch sonst nirgends getan, siehe
// preview.tsx: die dortige Caption-Drag-Geste hat aus demselben Grund keinen
// eigenen Gesten-Test). Die Entscheidung selbst ist hier trotzdem lückenlos geprüft.
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
