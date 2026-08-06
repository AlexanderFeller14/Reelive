import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { Input } from '../Input';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('reicht Eingaben durch und zeigt Fehler', async () => {
  const onChangeText = jest.fn();
  await wrap(<Input label="Username" value="" onChangeText={onChangeText} error="Dieser Username ist vergeben — probier einen anderen." />);
  fireEvent.changeText(screen.getByLabelText('Username'), 'lea');
  expect(onChangeText).toHaveBeenCalledWith('lea');
  expect(screen.getByText(/vergeben/)).toBeTruthy();
});

test('placeholder erscheint erst mit Fokus (Floating Label)', async () => {
  // Fake Timer, weil der Fokus die Label-Animation (Animated.timing) startet —
  // ohne das liefe deren Frame-Loop ausserhalb von act() weiter und würfe Warnings.
  jest.useFakeTimers();
  await wrap(
    <Input label="Handynummer" value="" onChangeText={() => {}} placeholder="+41 79 123 45 67" />
  );
  expect(screen.queryByPlaceholderText('+41 79 123 45 67')).toBeNull();
  await fireEvent(screen.getByLabelText('Handynummer'), 'focus');
  expect(screen.getByPlaceholderText('+41 79 123 45 67')).toBeTruthy();
  jest.useRealTimers();
});
