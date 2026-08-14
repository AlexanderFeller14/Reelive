import { render, screen, fireEvent } from '@testing-library/react-native';
import { Animated, StyleSheet } from 'react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { palette } from '@/theme/tokens';
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

  // Reales Pressable-`disabled` unterdrückt den Responder-Zyklus nativ, RNTL
  // simuliert das über `onStartShouldSetResponder`, deshalb kommt pressIn/pressOut
  // hier gar nicht erst beim internen Handler an (echtes Verhalten, kein Mock).
  await fireEvent(label, 'pressIn');
  await fireEvent(label, 'pressOut');
  await fireEvent.press(label);

  expect(springSpy).not.toHaveBeenCalled();
  expect(onPress).not.toHaveBeenCalled();

  springSpy.mockRestore();
});

test('secondary Variante zeigt Outline mit bg-0 im Ruhezustand', async () => {
  await wrap(<Button variant="secondary" label="Abbrechen" onPress={() => {}} />);
  const label = screen.getByText('Abbrechen');
  // `.parent` ist die innere View mit den Ruhezustand-Styles (Outline, bg-0).
  const flattened = StyleSheet.flatten(label.parent?.props.style);

  expect(flattened.borderWidth).toBe(1);
  expect(flattened.backgroundColor).toBe(palette['bg-0']);
});

test('loading Button spielt Press-Scale-Animation nicht ab', async () => {
  const springSpy = jest.spyOn(Animated, 'spring');
  const onPress = jest.fn();
  await wrap(<Button variant="primary" label="Weiter" onPress={onPress} loading />);
  const spinner = screen.getByTestId('button-loading');

  // Wie bei disabled: reales Pressable-`disabled` unterdrückt den
  // Responder-Zyklus, RNTL simuliert das über `onStartShouldSetResponder`.
  await fireEvent(spinner, 'pressIn');
  await fireEvent(spinner, 'pressOut');
  await fireEvent.press(spinner);

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

// Der Speicher-Moment im Namen-Editor: nach dem Erfolg zeigt der Knopf ein
// Häkchen (Lucide Check, weiss auf accent — NIE grün, §1/§7 verbieten Grün
// als Erfolgsfarbe), bevor der Screen wechselt. Er ist dabei gesperrt, aber
// nicht ausgegraut: der Moment feiert, er deaktiviert nicht.
test('erfolg zeigt ein Häkchen statt Label und sperrt den Knopf', async () => {
  const onPress = jest.fn();
  await wrap(<Button variant="primary" label="Speichern" onPress={onPress} erfolg />);
  expect(screen.getByTestId('button-erfolg')).toBeTruthy();
  expect(screen.queryByText('Speichern')).toBeNull();
  expect(screen.queryByTestId('button-loading')).toBeNull();
  fireEvent.press(screen.getByTestId('button-erfolg'));
  expect(onPress).not.toHaveBeenCalled();
});

// «Smoother Übergang»: der Haken erscheint nicht hart, er blendet mit
// Scale + Opacity ein (§5: nur transform/opacity). Animated.View löst seine
// Werte beim Rendern zu Zahlen auf (gleiches Auslese-Muster wie
// translateYVon in Sheet.test.tsx), prüfbar ist der STARTWERT der
// Einblendung: 0/0 statt fertig dastehen.
test('der Haken startet die Einblendung bei 0, statt hart zu erscheinen', async () => {
  await wrap(<Button variant="primary" label="Speichern" onPress={jest.fn()} erfolg />);
  const haken = screen.getByTestId('button-erfolg');
  const flach = StyleSheet.flatten(haken.props.style) as {
    opacity?: number;
    transform?: { scale?: number }[];
  };
  expect(flach.opacity).toBe(0);
  expect(flach.transform?.find((t) => 'scale' in t)?.scale).toBe(0);
});
