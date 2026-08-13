import { render, screen, fireEvent } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { ZoomWahl } from '../ZoomWahl';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(async () => {}) }));

// Die drei Stufen eines iPhone 17 Pro Max. Sie stehen hier als Zahlen, weil
// die Komponente sie nicht ausrechnet: sie kommen vom Gerät (zoom.ts).
const STUFEN = [0.5, 1, 4];

beforeEach(() => {
  jest.clearAllMocks();
});

test('zeigt jede Stufe, die das Gerät hergibt', async () => {
  await render(<ZoomWahl stufen={STUFEN} faktor={1} onWahl={jest.fn()} />);
  expect(screen.getByText('0,5×')).toBeTruthy();
  expect(screen.getByText('1×')).toBeTruthy();
  expect(screen.getByText('4×')).toBeTruthy();
});

test('zwischen zwei Stufen trägt die aktive den laufenden Faktor', async () => {
  // So hält es die Kamera-App, während der Pinch läuft: die Reihe bleibt
  // stehen, nur die geltende Stufe zeigt, wo man gerade ist.
  await render(<ZoomWahl stufen={STUFEN} faktor={2.3} onWahl={jest.fn()} />);
  expect(screen.getByText('2,3×')).toBeTruthy();
  expect(screen.queryByText('1×')).toBeNull();
  expect(screen.getByText('0,5×')).toBeTruthy();
});

test('ein Tipp meldet die gewählte Stufe', async () => {
  const onWahl = jest.fn();
  await render(<ZoomWahl stufen={STUFEN} faktor={1} onWahl={onWahl} />);
  fireEvent.press(screen.getByText('4×'));
  expect(onWahl).toHaveBeenCalledWith(4);
});

test('ein Tipp klickt', async () => {
  // DESIGN-LANGUAGE §5 nennt Zoom ausdrücklich bei der Haptik `selection`.
  await render(<ZoomWahl stufen={STUFEN} faktor={1} onWahl={jest.fn()} />);
  fireEvent.press(screen.getByText('0,5×'));
  expect(Haptics.selectionAsync).toHaveBeenCalled();
});

test('VoiceOver hört, welche Stufe gerade gilt', async () => {
  await render(<ZoomWahl stufen={STUFEN} faktor={4} onWahl={jest.fn()} />);
  expect(screen.getByLabelText('Zoom 4×').props.accessibilityState).toEqual(
    expect.objectContaining({ selected: true })
  );
  expect(screen.getByLabelText('Zoom 0,5×').props.accessibilityState).toEqual(
    expect.objectContaining({ selected: false })
  );
});
