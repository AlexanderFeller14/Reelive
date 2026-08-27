import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

// expo-image is a native view, in the test a placeholder that passes all
// props through is enough (same pattern as TripCard.test.tsx).
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

import { TripHeroCard } from '../TripHeroCard';
import type { Face } from '@/components/Avatar';
import type { Trip } from '@/features/trips/types';

const withoutImage = (names: string[]): Face[] =>
  names.map((name) => ({ name, avatarKey: null }));

const trip: Trip = {
  id: 't1', name: 'Norwegen mit dem Camper',
  start_date: '2026-08-01', end_date: '2026-08-14',
  status: 'active', owner_id: 'u1',
  members: withoutImage(['Lea', 'Mira', 'Jonas', 'Sofia']), member_count: 4, my_post_count: 7,
};

const TODAY = '2026-08-10';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('shows name, date range, and own counter', async () => {
  await wrap(<TripHeroCard trip={trip} today={TODAY} onPress={jest.fn()} />);
  expect(screen.getByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('1.–14. Aug 2026')).toBeTruthy();
  expect(screen.getByText('7 Momente')).toBeTruthy();
});

test('carries the status badge and the remaining days', async () => {
  await wrap(<TripHeroCard trip={trip} today={TODAY} onPress={jest.fn()} />);
  expect(screen.getByText('Aktiv')).toBeTruthy();
  expect(screen.getByText('Noch 4 Tage')).toBeTruthy();
});

test('a single remaining day is counted in the singular', async () => {
  await wrap(<TripHeroCard trip={trip} today="2026-08-13" onPress={jest.fn()} />);
  expect(screen.getByText('Noch 1 Tag')).toBeTruthy();
});

test('the end day itself is the last day', async () => {
  await wrap(<TripHeroCard trip={trip} today="2026-08-14" onPress={jest.fn()} />);
  expect(screen.getByText('Letzter Tag')).toBeTruthy();
});

// A trip past its end stays `active` until the auto-reveal picks it up;
// "Letzter Tag" is closer to the truth than a negative count.
test('a trip past its end still reads Letzter Tag, not a negative count', async () => {
  await wrap(<TripHeroCard trip={trip} today="2026-08-16" onPress={jest.fn()} />);
  expect(screen.getByText('Letzter Tag')).toBeTruthy();
});

test('the people row names the first member and counts the rest', async () => {
  await wrap(<TripHeroCard trip={trip} today={TODAY} onPress={jest.fn()} />);
  expect(screen.getByText('Lea + 3 weitere')).toBeTruthy();
});

test('a solo trip names its only member without a count', async () => {
  await wrap(
    <TripHeroCard
      trip={{ ...trip, members: withoutImage(['Lea']), member_count: 1 }}
      today={TODAY}
      onPress={jest.fn()}
    />
  );
  expect(screen.getByText('Lea')).toBeTruthy();
  expect(screen.queryByText(/weitere/)).toBeNull();
});

// The stack only claims what exists: no card without a moment, the back
// card only from the second moment on.
test('without a moment no stack stands on the cover', async () => {
  await wrap(<TripHeroCard trip={{ ...trip, my_post_count: 0 }} today={TODAY} onPress={jest.fn()} />);
  expect(screen.queryByTestId('moment-stack-front')).toBeNull();
  expect(screen.queryByTestId('moment-stack-back')).toBeNull();
});

test('a single moment lies alone, without the back card', async () => {
  await wrap(<TripHeroCard trip={{ ...trip, my_post_count: 1 }} today={TODAY} onPress={jest.fn()} />);
  expect(screen.getByTestId('moment-stack-front')).toBeTruthy();
  expect(screen.queryByTestId('moment-stack-back')).toBeNull();
});

test('from the second moment on the stack shows depth', async () => {
  await wrap(<TripHeroCard trip={trip} today={TODAY} onPress={jest.fn()} />);
  expect(screen.getByTestId('moment-stack-front')).toBeTruthy();
  expect(screen.getByTestId('moment-stack-back')).toBeTruthy();
});

// The wax seal image left the list with this card (mockup 2026-08-27);
// the badge row carries the state now.
test('the wax seal image is gone from the card', async () => {
  await wrap(<TripHeroCard trip={trip} today={TODAY} onPress={jest.fn()} />);
  expect(screen.queryByTestId('wax-seal')).toBeNull();
});

test('the position picks the placeholder cover', async () => {
  await wrap(
    <>
      <TripHeroCard trip={trip} today={TODAY} position={0} onPress={jest.fn()} />
      <TripHeroCard trip={{ ...trip, id: 't2' }} today={TODAY} position={1} onPress={jest.fn()} />
    </>
  );
  const [first, second] = screen.getAllByTestId('trip-cover');
  expect(first.props.source).not.toBe(second.props.source);
});

test('tapping reports back', async () => {
  const onPress = jest.fn();
  await wrap(<TripHeroCard trip={trip} today={TODAY} onPress={onPress} />);
  await fireEvent.press(screen.getByText('Norwegen mit dem Camper'));
  expect(onPress).toHaveBeenCalled();
});
