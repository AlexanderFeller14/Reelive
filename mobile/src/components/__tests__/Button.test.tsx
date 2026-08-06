import { render, screen, fireEvent } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { Button } from '../Button';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('feuert onPress', async () => {
  const onPress = jest.fn();
  await wrap(<Button variant="primary" label="Einsenden" onPress={onPress} />);
  fireEvent.press(screen.getByText('Einsenden'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('disabled feuert nicht', async () => {
  const onPress = jest.fn();
  await wrap(<Button variant="primary" label="Weiter" onPress={onPress} disabled />);
  fireEvent.press(screen.getByText('Weiter'));
  expect(onPress).not.toHaveBeenCalled();
});

test('disabled Button spielt Press-Scale-Animation nicht ab', async () => {
  const springSpy = jest.spyOn(Animated, 'spring');
  const onPress = jest.fn();
  await wrap(<Button variant="primary" label="Weiter" onPress={onPress} disabled />);
  const label = screen.getByText('Weiter');

  // Reales Pressable-`disabled` unterdrückt den Responder-Zyklus nativ — RNTL
  // simuliert das über `onStartShouldSetResponder`, deshalb kommt pressIn/pressOut
  // hier gar nicht erst beim internen Handler an (echtes Verhalten, kein Mock).
  await fireEvent(label, 'pressIn');
  await fireEvent(label, 'pressOut');
  await fireEvent.press(label);

  expect(springSpy).not.toHaveBeenCalled();
  expect(onPress).not.toHaveBeenCalled();

  springSpy.mockRestore();
});

test('loading zeigt Spinner statt Label-Interaktion', async () => {
  const onPress = jest.fn();
  await wrap(<Button variant="primary" label="Weiter" onPress={onPress} loading />);
  expect(screen.getByTestId('button-loading')).toBeTruthy();
  fireEvent.press(screen.getByTestId('button-loading'));
  expect(onPress).not.toHaveBeenCalled();
});

test('text-Variante rendert Label unterstrichen und feuert', async () => {
  const onPress = jest.fn();
  await wrap(<Button variant="text" label="Code erneut senden" onPress={onPress} />);
  const label = screen.getByText('Code erneut senden');
  expect(label.props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ textDecorationLine: 'underline' })])
  );
  fireEvent.press(label);
  expect(onPress).toHaveBeenCalledTimes(1);
});
