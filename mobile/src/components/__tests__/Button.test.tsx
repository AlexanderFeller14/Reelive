import { render, screen, fireEvent } from '@testing-library/react-native';
import { Animated, StyleSheet } from 'react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { palette } from '@/theme/tokens';
import { Button } from '../Button';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('fires onPress', async () => {
  const onPress = jest.fn();
  await wrap(<Button variant="primary" label="Einsenden" onPress={onPress} />);
  fireEvent.press(screen.getByText('Einsenden'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('disabled does not fire', async () => {
  const onPress = jest.fn();
  await wrap(<Button variant="primary" label="Weiter" onPress={onPress} disabled />);
  fireEvent.press(screen.getByText('Weiter'));
  expect(onPress).not.toHaveBeenCalled();
});

test('a disabled button does not play the press-scale animation', async () => {
  const springSpy = jest.spyOn(Animated, 'spring');
  const onPress = jest.fn();
  await wrap(<Button variant="primary" label="Weiter" onPress={onPress} disabled />);
  const label = screen.getByText('Weiter');

  // A real Pressable's `disabled` suppresses the responder cycle natively,
  // RNTL simulates that via `onStartShouldSetResponder`, so pressIn/pressOut
  // never even reach the internal handler here (real behavior, not a mock).
  await fireEvent(label, 'pressIn');
  await fireEvent(label, 'pressOut');
  await fireEvent.press(label);

  expect(springSpy).not.toHaveBeenCalled();
  expect(onPress).not.toHaveBeenCalled();

  springSpy.mockRestore();
});

test('the secondary variant shows an outline with bg-0 at rest', async () => {
  await wrap(<Button variant="secondary" label="Abbrechen" onPress={() => {}} />);
  const label = screen.getByText('Abbrechen');
  // `.parent` is the inner view with the resting-state styles (outline, bg-0).
  const flattened = StyleSheet.flatten(label.parent?.props.style);

  expect(flattened.borderWidth).toBe(1);
  expect(flattened.backgroundColor).toBe(palette['bg-0']);
});

test('a loading button does not play the press-scale animation', async () => {
  const springSpy = jest.spyOn(Animated, 'spring');
  const onPress = jest.fn();
  await wrap(<Button variant="primary" label="Weiter" onPress={onPress} loading />);
  const spinner = screen.getByTestId('button-loading');

  // Same as disabled: a real Pressable's `disabled` suppresses the
  // responder cycle, RNTL simulates that via `onStartShouldSetResponder`.
  await fireEvent(spinner, 'pressIn');
  await fireEvent(spinner, 'pressOut');
  await fireEvent.press(spinner);

  expect(springSpy).not.toHaveBeenCalled();
  expect(onPress).not.toHaveBeenCalled();

  springSpy.mockRestore();
});

test('loading shows a spinner instead of label interaction', async () => {
  const onPress = jest.fn();
  await wrap(<Button variant="primary" label="Weiter" onPress={onPress} loading />);
  expect(screen.getByTestId('button-loading')).toBeTruthy();
  fireEvent.press(screen.getByTestId('button-loading'));
  expect(onPress).not.toHaveBeenCalled();
});

test('the text variant renders the label underlined and fires', async () => {
  const onPress = jest.fn();
  await wrap(<Button variant="text" label="Code erneut senden" onPress={onPress} />);
  const label = screen.getByText('Code erneut senden');
  expect(label.props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ textDecorationLine: 'underline' })])
  );
  fireEvent.press(label);
  expect(onPress).toHaveBeenCalledTimes(1);
});

// The save moment in the name editor: after success, the button shows a
// checkmark (Lucide Check, white on accent, NEVER green, §1/§7 forbid
// green as a success color), before the screen changes. It's locked
// during that, but not grayed out: the moment celebrates, it doesn't
// disable.
test('success shows a checkmark instead of the label and locks the button', async () => {
  const onPress = jest.fn();
  await wrap(<Button variant="primary" label="Speichern" onPress={onPress} success />);
  expect(screen.getByTestId('button-success')).toBeTruthy();
  expect(screen.queryByText('Speichern')).toBeNull();
  expect(screen.queryByTestId('button-loading')).toBeNull();
  fireEvent.press(screen.getByTestId('button-success'));
  expect(onPress).not.toHaveBeenCalled();
});

// "Smooth transition": the checkmark doesn't appear abruptly, it fades in
// with scale + opacity (§5: only transform/opacity). Animated.View
// resolves its values to numbers when rendering (same read-out pattern as
// translateYOf in Sheet.test.tsx), what's checkable is the START value of
// the fade-in: 0/0 instead of standing there already finished.
test('the checkmark starts its fade-in at 0, instead of appearing abruptly', async () => {
  await wrap(<Button variant="primary" label="Speichern" onPress={jest.fn()} success />);
  const checkmark = screen.getByTestId('button-success');
  const flattened = StyleSheet.flatten(checkmark.props.style) as {
    opacity?: number;
    transform?: { scale?: number }[];
  };
  expect(flattened.opacity).toBe(0);
  expect(flattened.transform?.find((t) => 'scale' in t)?.scale).toBe(0);
});
