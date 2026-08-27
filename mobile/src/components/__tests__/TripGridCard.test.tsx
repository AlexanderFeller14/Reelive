import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

// expo-image is a native view, in the test a placeholder that passes all
// props through is enough (same pattern as TripCard.test.tsx).
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

import { TripGridCard } from '../TripGridCard';
import type { Trip } from '@/features/trips/types';

const trip: Trip = {
  id: 't3', name: 'Island im Winter',
  start_date: '2026-09-01', end_date: '2026-09-10',
  status: 'active', owner_id: 'u1',
  members: [{ name: 'Lea', avatarKey: null }], member_count: 1, my_post_count: 0,
};

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('shows name and date range', async () => {
  await wrap(<TripGridCard trip={trip} onPress={jest.fn()} />);
  expect(screen.getByText('Island im Winter')).toBeTruthy();
  expect(screen.getByText('1.–10. Sep 2026')).toBeTruthy();
});

// Planned trips carry no state: nothing is sealed yet, no badge and no
// stack may claim otherwise.
test('carries neither badges nor a moment stack', async () => {
  await wrap(<TripGridCard trip={trip} onPress={jest.fn()} />);
  expect(screen.queryByText('Aktiv')).toBeNull();
  expect(screen.queryByTestId('moment-stack-front')).toBeNull();
  expect(screen.queryByTestId('wax-seal')).toBeNull();
});

test('the position picks the placeholder cover', async () => {
  await wrap(
    <>
      <TripGridCard trip={trip} position={0} onPress={jest.fn()} />
      <TripGridCard trip={{ ...trip, id: 't4' }} position={1} onPress={jest.fn()} />
    </>
  );
  const [first, second] = screen.getAllByTestId('trip-cover');
  expect(first.props.source).not.toBe(second.props.source);
});

test('tapping reports back', async () => {
  const onPress = jest.fn();
  await wrap(<TripGridCard trip={trip} onPress={onPress} />);
  await fireEvent.press(screen.getByText('Island im Winter'));
  expect(onPress).toHaveBeenCalled();
});
