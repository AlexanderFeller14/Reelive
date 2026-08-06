import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider, useTheme } from '../ThemeProvider';

function Probe() {
  const { colors, scheme } = useTheme();
  return <Text>{`${scheme}:${colors['bg-0']}`}</Text>;
}

test('ThemeProvider ist light-only und liefert die v2-Palette', async () => {
  await render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );
  expect(screen.getByText('light:#FFFFFF')).toBeTruthy();
});
