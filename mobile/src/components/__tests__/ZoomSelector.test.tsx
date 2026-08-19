import { render, screen, fireEvent } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { ZoomSelector } from '../ZoomSelector';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(async () => {}) }));

// The three steps of an iPhone 17 Pro Max. They're plain numbers here
// because the component doesn't compute them: they come from the device
// (zoom.ts).
const STEPS = [0.5, 1, 4];

beforeEach(() => {
  jest.clearAllMocks();
});

test('shows every step the device provides', async () => {
  await render(<ZoomSelector steps={STEPS} factor={1} onSelect={jest.fn()} />);
  expect(screen.getByText('0,5×')).toBeTruthy();
  expect(screen.getByText('1×')).toBeTruthy();
  expect(screen.getByText('4×')).toBeTruthy();
});

test('between two steps, the active one carries the live factor', async () => {
  // That's how the Camera app does it while the pinch runs: the row stays
  // put, only the current step shows where you are right now.
  await render(<ZoomSelector steps={STEPS} factor={2.3} onSelect={jest.fn()} />);
  expect(screen.getByText('2,3×')).toBeTruthy();
  expect(screen.queryByText('1×')).toBeNull();
  expect(screen.getByText('0,5×')).toBeTruthy();
});

test('a tap reports the selected step', async () => {
  const onSelect = jest.fn();
  await render(<ZoomSelector steps={STEPS} factor={1} onSelect={onSelect} />);
  fireEvent.press(screen.getByText('4×'));
  expect(onSelect).toHaveBeenCalledWith(4);
});

test('a tap gives a haptic click', async () => {
  // DESIGN-LANGUAGE §5 explicitly names zoom under the `selection` haptic.
  await render(<ZoomSelector steps={STEPS} factor={1} onSelect={jest.fn()} />);
  fireEvent.press(screen.getByText('0,5×'));
  expect(Haptics.selectionAsync).toHaveBeenCalled();
});

test('VoiceOver hears which step currently applies', async () => {
  await render(<ZoomSelector steps={STEPS} factor={4} onSelect={jest.fn()} />);
  expect(screen.getByLabelText('Zoom 4×').props.accessibilityState).toEqual(
    expect.objectContaining({ selected: true })
  );
  expect(screen.getByLabelText('Zoom 0,5×').props.accessibilityState).toEqual(
    expect.objectContaining({ selected: false })
  );
});
