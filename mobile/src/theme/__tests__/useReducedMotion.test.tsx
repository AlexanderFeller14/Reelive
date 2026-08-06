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

test('liefert true, wenn Reduce Motion aktiv ist', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

  await render(<Probe />);

  await waitFor(() => expect(screen.getByText('true')).toBeTruthy());
});

test('liefert false, wenn Reduce Motion aus ist', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

  await render(<Probe />);

  await waitFor(() => expect(screen.getByText('false')).toBeTruthy());
});
