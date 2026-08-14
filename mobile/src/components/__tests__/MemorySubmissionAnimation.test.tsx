import { render, act } from '@testing-library/react-native';
import * as React from 'react';
import { MemorySubmissionAnimation } from '../MemorySubmissionAnimation';

// Reanimated treibt die Optik auf dem UI-Thread; im Test zählt nur die
// Mechanik (Timer, Reset, A11y, Haptik). Der OFFIZIELLE Mock der Bibliothek
// ist hier unbrauchbar: er importiert react-native-reanimated/src und damit
// das native react-native-worklets-Modul, das es in Jest nicht gibt
// (loadUnpackers-Absturz). Deshalb ein Hand-Mock nach dem Muster der anderen
// nativen Fehlstellen (expo-video, react-native-maps in jest.setup.ts): die
// with*-Helfer liefern schlicht ihren Zielwert, useAnimatedStyle rechnet die
// Style-Fabrik einmal statisch aus.
jest.mock('react-native-reanimated', () => {
  const ReactActual = require('react');
  const { View, Text, Image } = require('react-native');
  const durchreichen = (props: Record<string, unknown>) =>
    ReactActual.createElement(View, props, props.children);
  return {
    __esModule: true,
    default: {
      View: durchreichen,
      Text: (props: Record<string, unknown>) => ReactActual.createElement(Text, props, props.children),
      Image: (props: Record<string, unknown>) => ReactActual.createElement(Image, props),
      createAnimatedComponent: (Komponente: unknown) => Komponente,
    },
    useSharedValue: (anfang: unknown) => ReactActual.useRef({ value: anfang }).current,
    useAnimatedStyle: (fabrik: () => object) => fabrik(),
    withTiming: (ziel: unknown) => ziel,
    withSpring: (ziel: unknown) => ziel,
    withDelay: (_ms: number, animation: unknown) => animation,
    withSequence: (...schritte: unknown[]) => schritte[schritte.length - 1],
    cancelAnimation: () => {},
    Easing: { bezier: () => ({}) },
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

// Zeitgerüst: 3600 ms Gesamtdauer, strikt sequenziell (Geräte-Abnahme:
// «Polaroids, dann Gutzeichen, dann der Count — ganz clean»): die Polaroids
// sind bei 1700 ms vollständig weg, der Pin (und mit ihm die Haptik) kommt
// erst bei 1800 ms, der Zähler erscheint ab 2300 ms stehend und rollt genau
// einmal, der Rest ist Lesezeit. Reduzierte Bewegung: nur Fades, 900 ms.
const GESAMT = 3_600;
const PIN_START = 1_800;
const REDUZIERT_GESAMT = 900;

test('unsichtbar rendert nichts und ruft onFinished nie', async () => {
  const onFinished = jest.fn();
  const { queryByTestId, unmount } = await render(
    <MemorySubmissionAnimation visible={false} onFinished={onFinished} />
  );
  expect(queryByTestId('memory-animation')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  expect(onFinished).not.toHaveBeenCalled();
  expect(mockNotificationAsync).not.toHaveBeenCalled();
  await unmount();
});

test('onFinished kommt genau einmal, nach der vollen Gesamtdauer', async () => {
  const onFinished = jest.fn();
  const { unmount } = await render(
    <MemorySubmissionAnimation visible={true} onFinished={onFinished} />
  );

  await act(async () => {
    jest.advanceTimersByTime(GESAMT - 1);
  });
  expect(onFinished).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onFinished).toHaveBeenCalledTimes(1);

  // Auch lange danach bleibt es bei genau einem Aufruf.
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  expect(onFinished).toHaveBeenCalledTimes(1);
  await unmount();
});

test('ein erneutes Rendern bei unverändert visible feuert onFinished nicht doppelt', async () => {
  const onFinished = jest.fn();
  const { rerender, unmount } = await render(
    <MemorySubmissionAnimation visible={true} onFinished={onFinished} />
  );
  await act(async () => {
    jest.advanceTimersByTime(1_000);
    rerender(<MemorySubmissionAnimation visible={true} onFinished={onFinished} />);
    jest.advanceTimersByTime(GESAMT);
  });
  expect(onFinished).toHaveBeenCalledTimes(1);
  await unmount();
});

test('visible aus und wieder an startet die Animation vollständig von vorne', async () => {
  const onFinished = jest.fn();
  const { rerender, queryByTestId, unmount } = await render(
    <MemorySubmissionAnimation visible={true} onFinished={onFinished} />
  );
  await act(async () => {
    jest.advanceTimersByTime(1_000);
    rerender(<MemorySubmissionAnimation visible={false} onFinished={onFinished} />);
  });
  // Abgebrochen: nichts mehr im Baum, kein spätes onFinished.
  expect(queryByTestId('memory-animation')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  expect(onFinished).not.toHaveBeenCalled();

  // Neustart: wieder die VOLLE Dauer, nicht der Rest der ersten Runde.
  // Rerender und Timer-Vorlauf getrennt: der Abschluss-Timer entsteht erst
  // im Effekt, und der läuft erst am Ende des act-Blocks.
  await act(async () => {
    rerender(<MemorySubmissionAnimation visible={true} onFinished={onFinished} />);
  });
  await act(async () => {
    jest.advanceTimersByTime(GESAMT - 1);
  });
  expect(onFinished).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onFinished).toHaveBeenCalledTimes(1);
  await unmount();
});

test('bei reduzierter Bewegung endet die verkürzte Fassung nach 900 ms zuverlässig', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  const onFinished = jest.fn();
  const { unmount } = await render(
    <MemorySubmissionAnimation visible={true} onFinished={onFinished} />
  );
  await act(async () => {
    jest.advanceTimersByTime(REDUZIERT_GESAMT - 1);
  });
  expect(onFinished).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onFinished).toHaveBeenCalledTimes(1);
  await unmount();
});

test('ein Unmount während der Animation ruft weder onFinished noch die Haptik nach', async () => {
  const onFinished = jest.fn();
  const { unmount } = await render(
    <MemorySubmissionAnimation visible={true} onFinished={onFinished} />
  );
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  await unmount();
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  expect(onFinished).not.toHaveBeenCalled();
  expect(mockNotificationAsync).not.toHaveBeenCalled();
});

test('die success-Haptik feuert genau einmal, wenn der Pin erscheint', async () => {
  const onFinished = jest.fn();
  const { unmount } = await render(
    <MemorySubmissionAnimation visible={true} onFinished={onFinished} />
  );
  await act(async () => {
    jest.advanceTimersByTime(PIN_START - 1);
  });
  expect(mockNotificationAsync).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockNotificationAsync).toHaveBeenCalledWith('success');
  await act(async () => {
    jest.advanceTimersByTime(GESAMT);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  await unmount();
});

test('rollt den Zähler eine Stelle hoch, wenn der Stand der Reise da ist', async () => {
  const { getByTestId, unmount } = await render(
    <MemorySubmissionAnimation visible={true} onFinished={jest.fn()} zaehler={11} />
  );
  // 11 → 12: die Zehnerstelle steht fest, die Einerstelle rollt 1 → 2
  // (Digit-Roll aus ZaehlerRoll.tsx, dort im Detail getestet).
  expect(getByTestId('memory-zaehler')).toBeTruthy();
  expect(getByTestId('zaehler-ziffer-fest-0').props.children).toBe('1');
  expect(getByTestId('zaehler-ziffer-alt-1').props.children).toBe('1');
  expect(getByTestId('zaehler-ziffer-neu-1').props.children).toBe('2');
  await act(async () => {
    jest.advanceTimersByTime(GESAMT);
  });
  await unmount();
});

test('ohne Zählerstand läuft die Animation ohne Zahl', async () => {
  const { queryByTestId, unmount } = await render(
    <MemorySubmissionAnimation visible={true} onFinished={jest.fn()} zaehler={null} />
  );
  expect(queryByTestId('memory-zaehler')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(GESAMT);
  });
  await unmount();
});

test('bei reduzierter Bewegung steht der neue Stand, ohne Roll', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  const { getByText, queryByTestId, unmount } = await render(
    <MemorySubmissionAnimation visible={true} onFinished={jest.fn()} zaehler={11} />
  );
  expect(getByText('12')).toBeTruthy();
  expect(queryByTestId('zaehler-ziffer-neu-1')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(REDUZIERT_GESAMT);
  });
  await unmount();
});

test('zeigt Titel, Untertitel, drei dekorative Polaroids und den Bestätigungs-Pin', async () => {
  const { getByText, getAllByTestId, getByTestId, unmount } = await render(
    <MemorySubmissionAnimation visible={true} onFinished={jest.fn()} />
  );
  expect(getByText('Moment eingesendet')).toBeTruthy();
  expect(getByText('Dein Moment ist unterwegs und bleibt bis zum Recap versiegelt.')).toBeTruthy();

  // includeHiddenElements: die Polaroids sind absichtlich vor der
  // Barrierefreiheit versteckt, Standard-Queries blenden genau solche
  // Elemente aus, hier sollen sie trotzdem gezählt werden.
  const polaroids = getAllByTestId('memory-polaroid', { includeHiddenElements: true });
  expect(polaroids).toHaveLength(3);
  // Dekorativ: kein Polaroid wird vom Screenreader einzeln vorgelesen.
  for (const polaroid of polaroids) {
    expect(polaroid.props.accessibilityElementsHidden).toBe(true);
  }

  expect(getByTestId('memory-pin')).toBeTruthy();
  // Der ganze Zwischenschirm meldet sich als EIN Element mit klarer Aussage.
  expect(getByTestId('memory-animation').props.accessibilityLabel).toBe(
    'Moment erfolgreich eingesendet'
  );
  await act(async () => {
    jest.advanceTimersByTime(GESAMT);
  });
  await unmount();
});
