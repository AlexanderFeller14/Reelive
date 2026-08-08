import { render, screen, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { cinema, palette } from '@/theme/tokens';
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
  await wrap(
    <Input label="Handynummer" value="" onChangeText={() => {}} placeholder="+41 79 123 45 67" />
  );
  expect(screen.queryByPlaceholderText('+41 79 123 45 67')).toBeNull();
  // await nötig: fireEvent ist in dieser RNTL-Version async und flusht den
  // State-Update erst nach dem await (React 19 + RNTL v14).
  await fireEvent(screen.getByLabelText('Handynummer'), 'focus');
  expect(screen.getByPlaceholderText('+41 79 123 45 67')).toBeTruthy();
});

// Phase-5-Final-Review, Punkt 4: ohne den `kino`-Schalter zog dieses Input
// über `useTheme()` zwingend die Licht-Palette — eine weisse Box mit
// `#222222`-Text mitten im Kinosaal (Kommentar-Sheet des Recap-Players).
// Gleiches Testmuster wie Sheet.test.tsx ("ohne/mit `kino`").
test('ohne `kino` nutzt das Feld die Licht-Palette', async () => {
  await wrap(<Input label="Kommentar" value="" onChangeText={() => {}} />);
  const box = screen.getByLabelText('Kommentar').parent;
  expect(StyleSheet.flatten(box!.props.style).backgroundColor).toBe(palette['bg-0']);
  expect(StyleSheet.flatten(screen.getByLabelText('Kommentar').props.style).color).toBe(palette['text-1']);
});

test('mit `kino` nutzt das Feld die feste Kino-Palette statt useTheme()', async () => {
  await wrap(<Input label="Kommentar" value="" onChangeText={() => {}} kino />);
  const box = screen.getByLabelText('Kommentar').parent;
  expect(StyleSheet.flatten(box!.props.style).backgroundColor).toBe(cinema['bg-1']);
  expect(StyleSheet.flatten(screen.getByLabelText('Kommentar').props.style).color).toBe(cinema['text-1']);
});
