import { fireEvent, render, screen } from '@testing-library/react-native';
import * as React from 'react';
import { ImportTile } from '../ImportTile';

const mockImageProps = jest.fn();
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    Image: (props: Record<string, unknown>) => {
      mockImageProps(props);
      return ReactActual.createElement(View, props);
    },
  };
});

const base = {
  thumb: 'file:///a.jpg',
  kind: 'photo' as const,
  durationS: null,
  status: 'ready' as const,
  progress: 0,
  reason: null,
  onRemove: null,
  size: 100,
  testID: 'tile',
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('a ready photo shows its picture and, when removable, the x', async () => {
  const onRemove = jest.fn();
  await render(<ImportTile {...base} onRemove={onRemove} />);
  expect(mockImageProps).toHaveBeenCalledWith(expect.objectContaining({ source: { uri: 'file:///a.jpg' } }));
  fireEvent.press(screen.getByLabelText('Aus der Auswahl entfernen'));
  expect(onRemove).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('tile-status')).toBeNull();
});

test('a video without its still frame yet shows a placeholder and its length', async () => {
  await render(<ImportTile {...base} thumb={null} kind="video" durationS={12} />);
  expect(screen.getByTestId('tile-placeholder')).toBeTruthy();
  expect(screen.getByText('12 s')).toBeTruthy();
  expect(mockImageProps).not.toHaveBeenCalled();
});

test('a refused tile is dimmed, names its reason, and has no x', async () => {
  await render(<ImportTile {...base} reason="Ausserhalb der Reise" onRemove={jest.fn()} />);
  expect(screen.getByText('Ausserhalb der Reise')).toBeTruthy();
  expect(screen.queryByLabelText('Aus der Auswahl entfernen')).toBeNull();
  expect(screen.getByTestId('tile-reason')).toBeTruthy();
});

test('converting shows the percentage, preparing a spinner, done a check, failed the warning', async () => {
  const { rerender } = await render(<ImportTile {...base} status="converting" progress={0.42} />);
  expect(screen.getByText('42 %')).toBeTruthy();
  expect(screen.queryByLabelText('Aus der Auswahl entfernen')).toBeNull();

  await rerender(<ImportTile {...base} status="preparing" />);
  expect(screen.getByTestId('tile-status')).toBeTruthy();
  expect(screen.queryByText(/%$/)).toBeNull();

  await rerender(<ImportTile {...base} status="done" />);
  expect(screen.getByLabelText('Eingesendet')).toBeTruthy();

  await rerender(<ImportTile {...base} status="failed" />);
  expect(screen.getByText('Nicht gesichert')).toBeTruthy();
});
