import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { Fab } from '../Fab';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('shows the label', async () => {
  await wrap(<Fab label="Neue Reise" onPress={jest.fn()} />);
  expect(screen.getByText('Neue Reise')).toBeTruthy();
});

test('tapping calls onPress', async () => {
  const onPress = jest.fn();
  await wrap(<Fab label="Neue Reise" onPress={onPress} />);
  await fireEvent.press(screen.getByLabelText('Neue Reise'));
  expect(onPress).toHaveBeenCalled();
});
