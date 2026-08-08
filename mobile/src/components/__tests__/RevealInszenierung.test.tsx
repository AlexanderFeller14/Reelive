import { render, act } from '@testing-library/react-native';
import * as React from 'react';
import { RevealInszenierung } from '../RevealInszenierung';

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
