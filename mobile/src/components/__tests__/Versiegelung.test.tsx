import { render, act } from '@testing-library/react-native';
import * as React from 'react';
import { Versiegelung } from '../Versiegelung';

const mockNotificationAsync = jest.fn(async (..._args: unknown[]) => {});
jest.mock('expo-haptics', () => ({
  notificationAsync: (...args: unknown[]) => mockNotificationAsync(...args),
  NotificationFeedbackType: { Success: 'success' },
}));

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/theme/useReducedMotion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

// expo-image ist ein natives View und lässt sich in Jest nicht laden; der
// Platzhalter reicht die Props durch (gleiches Muster wie vorschau.test.tsx).
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

jest.useFakeTimers();

beforeEach(() => {
  jest.clearAllMocks();
  mockUseReducedMotion.mockReturnValue(false);
});

// Zeitgerüst der Inszenierung: 800 ms Choreografie (motion.duration.feature),
// die Haptik feuert beim Siegelschluss bei 55 % davon (440 ms), danach stehen
// 500 ms Nachklang, damit der hochgerollte Zähler lesbar ist, erst dann kommt
// onFertig. Bei reduzierter Bewegung: 200-ms-Fade + derselbe Nachklang.
const DAUER = 800;
const SIEGELSCHLUSS = 440;
const NACHKLANG = 500;
const REDUZIERT = 200;

test('unsichtbar löst weder Haptik noch onFertig aus', async () => {
  const onFertig = jest.fn();
  const { unmount } = await render(<Versiegelung sichtbar={false} onFertig={onFertig} />);
  await act(async () => {
    jest.advanceTimersByTime(3_000);
  });
  expect(mockNotificationAsync).not.toHaveBeenCalled();
  expect(onFertig).not.toHaveBeenCalled();
  await unmount();
});

test('die success-Haptik feuert genau einmal, beim Siegelschluss statt beim Start', async () => {
  const onFertig = jest.fn();
  const { rerender, unmount } = await render(<Versiegelung sichtbar={true} onFertig={onFertig} />);

  // Beim Start passiert noch nichts: das Siegel ist noch gar nicht zu.
  expect(mockNotificationAsync).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(SIEGELSCHLUSS);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockNotificationAsync).toHaveBeenCalledWith('success');

  // Ein erneutes Rendern bei unverändert sichtbar=true darf die Haptik nicht
  // ein zweites Mal auslösen.
  await act(async () => {
    rerender(<Versiegelung sichtbar={true} onFertig={onFertig} />);
    jest.advanceTimersByTime(DAUER + NACHKLANG);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  await unmount();
});

// Fix-Runde 1 (übernommen aus der alten Fassung): ein Wechsel von
// prefers-reduced-motion, während die Inszenierung schon läuft, lässt den
// Effekt neu laufen (die Dauer hängt daran). Der Ref-Schutz muss die Haptik
// weiterhin auf genau einmal pro Siegel begrenzen, egal wann der Wechsel kommt.
test('ein Wechsel von prefers-reduced-motion nach dem Siegelschluss feuert die Haptik nicht zweimal', async () => {
  const onFertig = jest.fn();
  const { rerender, unmount } = await render(<Versiegelung sichtbar={true} onFertig={onFertig} />);
  await act(async () => {
    jest.advanceTimersByTime(SIEGELSCHLUSS);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);

  mockUseReducedMotion.mockReturnValue(true);
  await act(async () => {
    rerender(<Versiegelung sichtbar={true} onFertig={onFertig} />);
    jest.advanceTimersByTime(REDUZIERT + NACHKLANG);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  await unmount();
});

test('ein Wechsel zu reduzierter Bewegung vor dem Siegelschluss feuert die Haptik einmal, nicht doppelt', async () => {
  const onFertig = jest.fn();
  const { rerender, unmount } = await render(<Versiegelung sichtbar={true} onFertig={onFertig} />);
  await act(async () => {
    jest.advanceTimersByTime(100);
  });
  expect(mockNotificationAsync).not.toHaveBeenCalled();

  mockUseReducedMotion.mockReturnValue(true);
  await act(async () => {
    rerender(<Versiegelung sichtbar={true} onFertig={onFertig} />);
    jest.advanceTimersByTime(REDUZIERT + NACHKLANG);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  await unmount();
});

test('onFertig kommt erst nach Choreografie plus Nachklang', async () => {
  const onFertig = jest.fn();
  const { unmount } = await render(<Versiegelung sichtbar={true} onFertig={onFertig} />);

  await act(async () => {
    jest.advanceTimersByTime(DAUER + NACHKLANG - 1);
  });
  expect(onFertig).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onFertig).toHaveBeenCalledTimes(1);

  await unmount();
});

test('bei reduzierter Bewegung bleibt es ein kurzer Fade, der Nachklang zum Lesen bleibt', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  const onFertig = jest.fn();
  const { unmount } = await render(<Versiegelung sichtbar={true} onFertig={onFertig} />);

  await act(async () => {
    jest.advanceTimersByTime(REDUZIERT + NACHKLANG - 1);
  });
  expect(onFertig).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onFertig).toHaveBeenCalledTimes(1);

  await unmount();
});

test('ein Unmount während der Inszenierung ruft weder onFertig noch die Haptik nach', async () => {
  const onFertig = jest.fn();
  const { unmount } = await render(<Versiegelung sichtbar={true} onFertig={onFertig} />);
  await act(async () => {
    jest.advanceTimersByTime(100);
  });
  await unmount();
  await act(async () => {
    jest.advanceTimersByTime(3_000);
  });
  expect(onFertig).not.toHaveBeenCalled();
  expect(mockNotificationAsync).not.toHaveBeenCalled();
});

test('zeigt das übergebene Moment-Bild, das in die Filmrolle schrumpft', async () => {
  const { getByTestId, unmount } = await render(
    <Versiegelung sichtbar={true} onFertig={jest.fn()} bildUri="file:///momente/m1.jpg" />
  );
  expect(getByTestId('versiegelung-moment')).toBeTruthy();
  expect(getByTestId('versiegelung-filmrolle')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(DAUER + NACHKLANG);
  });
  await unmount();
});

test('ohne Bild läuft die Inszenierung trotzdem, nur ohne Moment-Bild', async () => {
  const { queryByTestId, getByTestId, unmount } = await render(
    <Versiegelung sichtbar={true} onFertig={jest.fn()} />
  );
  expect(queryByTestId('versiegelung-moment')).toBeNull();
  expect(getByTestId('versiegelung-filmrolle')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(DAUER + NACHKLANG);
  });
  await unmount();
});

test('rollt den Zähler eine Stelle hoch und zeigt die Versiegelt-Zeile', async () => {
  const { getByTestId, getByText, unmount } = await render(
    <Versiegelung sichtbar={true} onFertig={jest.fn()} zaehler={11} />
  );
  // 11 → 12: die Zehnerstelle steht fest, die Einerstelle rollt 1 → 2.
  expect(getByTestId('zaehler-ziffer-fest-0').props.children).toBe('1');
  expect(getByTestId('zaehler-ziffer-alt-1').props.children).toBe('1');
  expect(getByTestId('zaehler-ziffer-neu-1').props.children).toBe('2');
  expect(getByText('Bis zum Recap versiegelt.')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(DAUER + NACHKLANG);
  });
  await unmount();
});

test('ohne Zählerstand entfällt die Zahl, die Versiegelt-Zeile bleibt', async () => {
  const { queryByTestId, getByText, unmount } = await render(
    <Versiegelung sichtbar={true} onFertig={jest.fn()} zaehler={null} />
  );
  expect(queryByTestId('versiegelung-zaehler')).toBeNull();
  expect(getByText('Bis zum Recap versiegelt.')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(DAUER + NACHKLANG);
  });
  await unmount();
});
