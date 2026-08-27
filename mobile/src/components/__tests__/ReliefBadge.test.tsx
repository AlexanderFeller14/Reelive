import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ReliefBadge } from '../ReliefBadge';

test('renders its content and carries the testID', async () => {
  await render(
    <ReliefBadge testID="badge">
      <Text>Aktiv</Text>
    </ReliefBadge>
  );
  expect(screen.getByTestId('badge')).toBeTruthy();
  expect(screen.getByText('Aktiv')).toBeTruthy();
});
