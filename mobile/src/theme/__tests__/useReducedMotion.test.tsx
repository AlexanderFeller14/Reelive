import { Text } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion } from '../useReducedMotion';

function Probe() {
  const reducedMotion = useReducedMotion();
  return <Text>{String(reducedMotion)}</Text>;
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('returns true when Reduce Motion is active', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

  await render(<Probe />);

  await waitFor(() => expect(screen.getByText('true')).toBeTruthy());
});

test('returns false when Reduce Motion is off', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

  await render(<Probe />);

  await waitFor(() => expect(screen.getByText('false')).toBeTruthy());
});
