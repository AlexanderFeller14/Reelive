import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

test('Jest rendert React-Native-Komponenten', async () => {
  await render(<Text>Reelive</Text>);
  expect(screen.getByText('Reelive')).toBeTruthy();
});
