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

jest.useFakeTimers();

beforeEach(() => {
  jest.clearAllMocks();
  mockUseReducedMotion.mockReturnValue(false);
});

test('unsichtbar löst weder Haptik noch onFertig aus', async () => {
  const onFertig = jest.fn();
  const { unmount } = await render(<Versiegelung sichtbar={false} onFertig={onFertig} />);
  await act(async () => {
    jest.advanceTimersByTime(2_000);
  });
  expect(mockNotificationAsync).not.toHaveBeenCalled();
  expect(onFertig).not.toHaveBeenCalled();
  await unmount();
});

test('sichtbar löst die success-Haptik genau einmal aus', async () => {
  const onFertig = jest.fn();
  const { rerender, unmount } = await render(<Versiegelung sichtbar={true} onFertig={onFertig} />);
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockNotificationAsync).toHaveBeenCalledWith('success');

  // Ein erneutes Rendern bei unverändert sichtbar=true darf die Haptik nicht
  // ein zweites Mal auslösen.
  await act(async () => {
    rerender(<Versiegelung sichtbar={true} onFertig={onFertig} />);
  });
  expect(mockNotificationAsync).toHaveBeenCalledTimes(1);

  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  await unmount();
});

test('onFertig kommt nach der vollen Inszenierungsdauer (700–900 ms)', async () => {
  const onFertig = jest.fn();
  const { unmount } = await render(<Versiegelung sichtbar={true} onFertig={onFertig} />);

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
  const { unmount } = await render(<Versiegelung sichtbar={true} onFertig={onFertig} />);

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
  const { unmount } = await render(<Versiegelung sichtbar={true} onFertig={onFertig} />);
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  await unmount();
  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  expect(onFertig).not.toHaveBeenCalled();
});
