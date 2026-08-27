import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

// expo-image is a native view, in the test a placeholder that passes all
// props through is enough (same pattern as TripHeroCard.test.tsx).
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

import { AddTripRow, TripRow } from '../TripRow';
import type { CachedTrip } from '@/features/trips/tripsCache';

const trip: CachedTrip = {
  id: 't1',
  name: 'Norwegen mit dem Camper',
  start_date: '2026-08-01',
  end_date: '2026-08-14',
  status: 'active',
  my_post_count: 7,
};

const TODAY = '2026-08-10';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('shows name, date range, remaining days and own counter', async () => {
  await wrap(<TripRow trip={trip} today={TODAY} position={0} onPress={jest.fn()} />);
  expect(screen.getByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('1.–14. Aug 2026')).toBeTruthy();
  expect(screen.getByText('Noch 4 Tage · 7 Momente')).toBeTruthy();
});

test('a single moment is counted in the singular', async () => {
  await wrap(<TripRow trip={{ ...trip, my_post_count: 1 }} today={TODAY} position={0} onPress={jest.fn()} />);
  expect(screen.getByText('Noch 4 Tage · 1 Moment')).toBeTruthy();
});

// The picker invites: a 0 reads as "nothing yet", not as a score.
test('without a moment the third line says so instead of showing a 0', async () => {
  await wrap(<TripRow trip={{ ...trip, my_post_count: 0 }} today={TODAY} position={0} onPress={jest.fn()} />);
  expect(screen.getByText('Noch 4 Tage · Noch kein Moment')).toBeTruthy();
});

test('the end day itself is the last day', async () => {
  await wrap(<TripRow trip={trip} today="2026-08-14" position={0} onPress={jest.fn()} />);
  expect(screen.getByText('Letzter Tag · 7 Momente')).toBeTruthy();
});

test('the whole row is the button and carries the trip as its name', async () => {
  const onPress = jest.fn();
  await wrap(<TripRow trip={trip} today={TODAY} position={0} onPress={onPress} />);
  await fireEvent.press(screen.getByRole('button', { name: /^Norwegen mit dem Camper/ }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('only a selected row reports itself as selected', async () => {
  await wrap(<TripRow trip={trip} today={TODAY} position={0} selected onPress={jest.fn()} />);
  expect(screen.getByRole('button', { name: /^Norwegen/, selected: true })).toBeTruthy();
});

test('an unselected row is not marked', async () => {
  await wrap(<TripRow trip={trip} today={TODAY} position={0} onPress={jest.fn()} />);
  expect(screen.queryByRole('button', { name: /^Norwegen/, selected: true })).toBeNull();
});

test('the add row explains itself and fires its action', async () => {
  const onPress = jest.fn();
  await wrap(<AddTripRow onPress={onPress} />);
  expect(screen.getByText('Wenn keine der Reisen passt')).toBeTruthy();
  await fireEvent.press(screen.getByText('Neue Reise anlegen'));
  expect(onPress).toHaveBeenCalledTimes(1);
});
