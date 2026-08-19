import { act, fireEvent, render } from '@testing-library/react-native';
import * as React from 'react';
import { SiegelAbziehen } from '../SiegelAbziehen';
import { ABGEZOGEN_AB_MS, DAUER_MS, RASTER } from '@/features/recap/siegelPeel';

// Skia ist global in jest.setup.ts gemockt (natives Zeichen-Backend, gleiche
// Fehlstelle wie react-native-maps). Reanimated treibt den Fortschritt auf
// dem UI-Thread; im Test zählt nur die Mechanik (Tipp, Timer, Haptik, A11y),
// deshalb derselbe Hand-Mock wie in MemorySubmissionAnimation.test.tsx (der
// offizielle Mock zieht das native Worklets-Modul und stürzt in Jest ab).
jest.mock('react-native-reanimated', () => {
  const ReactActual = require('react');
  return {
    __esModule: true,
    useSharedValue: (anfang: unknown) => ReactActual.useRef({ value: anfang }).current,
    useDerivedValue: (fabrik: () => unknown) => ReactActual.useRef({ value: fabrik() }).current,
    withTiming: (ziel: unknown) => ziel,
    cancelAnimation: () => {},
    Easing: { bezier: () => ({}), linear: () => 0 },
  };
});

const mockNotificationAsync = jest.fn(async (..._args: unknown[]) => {});
jest.mock('expo-haptics', () => ({
  notificationAsync: (...args: unknown[]) => mockNotificationAsync(...args),
  NotificationFeedbackType: { Success: 'success' },
}));

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/theme/useReducedMotion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

jest.useFakeTimers();

beforeEach(() => {
  jest.clearAllMocks();
  mockUseReducedMotion.mockReturnValue(false);
});

test('steht als Knopf «Siegel abziehen» da und zeichnet Schatten und Netz in Bühnengrösse', async () => {
  const { getByRole, getByTestId } = await render(
    <SiegelAbziehen groesse={300} onAbgezogen={() => {}} testID="siegel" />
  );
  expect(getByRole('button', { name: 'Siegel abziehen' })).toBeTruthy();
  expect(getByTestId('siegel-buehne').props.style).toEqual({ width: 300, height: 300 });
  // Der Schatten liegt als Ellipse da, das Netz trägt für jede Zelle zwei
  // Dreiecke und für jeden Knoten eine Texturkoordinate.
  expect(getByTestId('skia-oval')).toBeTruthy();
  const netz = getByTestId('skia-vertices');
  expect(netz.props.indices).toHaveLength(RASTER * RASTER * 6);
  expect(netz.props.textures).toHaveLength((RASTER + 1) * (RASTER + 1));
  expect(netz.props.vertices.value).toHaveLength((RASTER + 1) * (RASTER + 1));
});

test('ein Tipp löst genau einmal die success-Haptik aus und meldet onAbgezogen erst, wenn die Bühne leer ist', async () => {
  const onAbgezogen = jest.fn();
  const { getByRole } = await render(<SiegelAbziehen groesse={300} onAbgezogen={onAbgezogen} />);
  const knopf = getByRole('button', { name: 'Siegel abziehen' });

  await act(async () => {
    fireEvent.press(knopf);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockNotificationAsync).toHaveBeenCalledWith('success');
  expect(onAbgezogen).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(ABGEZOGEN_AB_MS - 1);
  });
  expect(onAbgezogen).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onAbgezogen).toHaveBeenCalledTimes(1);

  // Danach kommt nichts mehr nach, auch nicht am Ende der vollen Dauer.
  await act(async () => {
    jest.advanceTimersByTime(DAUER_MS);
  });
  expect(onAbgezogen).toHaveBeenCalledTimes(1);
});

test('während des Abziehens ist der Knopf gesperrt: ein zweiter Tipp tut nichts', async () => {
  const onAbgezogen = jest.fn();
  const { getByRole } = await render(<SiegelAbziehen groesse={300} onAbgezogen={onAbgezogen} />);
  const knopf = getByRole('button', { name: 'Siegel abziehen' });

  await act(async () => {
    fireEvent.press(knopf);
  });
  expect(knopf.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  await act(async () => {
    fireEvent.press(knopf);
    jest.advanceTimersByTime(500);
    fireEvent.press(knopf);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);

  await act(async () => {
    jest.advanceTimersByTime(DAUER_MS);
  });
  expect(onAbgezogen).toHaveBeenCalledTimes(1);
});

test('Reduced Motion: kein Peel, ein 200-ms-Fade, dann onAbgezogen', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  const onAbgezogen = jest.fn();
  const { getByRole } = await render(<SiegelAbziehen groesse={300} onAbgezogen={onAbgezogen} />);

  await act(async () => {
    fireEvent.press(getByRole('button', { name: 'Siegel abziehen' }));
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(199);
  });
  expect(onAbgezogen).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onAbgezogen).toHaveBeenCalledTimes(1);
});

test('Unmount während des Abziehens: onAbgezogen kommt nicht mehr', async () => {
  const onAbgezogen = jest.fn();
  const { getByRole, unmount } = await render(<SiegelAbziehen groesse={300} onAbgezogen={onAbgezogen} />);
  await act(async () => {
    fireEvent.press(getByRole('button', { name: 'Siegel abziehen' }));
  });
  await unmount();
  await act(async () => {
    jest.advanceTimersByTime(DAUER_MS);
  });
  expect(onAbgezogen).not.toHaveBeenCalled();
});
