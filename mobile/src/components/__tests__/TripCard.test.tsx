import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

// expo-image is a native view, in the test a placeholder that passes all
// props through is enough (same pattern as recap/__tests__/list.test.tsx).
// Needed since the cover carries an image: without the mock, even the
// import fails, expo-image/src/observe.ts expects a native environment.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

import { TripCard } from '../TripCard';
import type { Face } from '@/components/Avatar';
import type { Trip } from '@/features/trips/types';

// The existing tests work with names; this bridge keeps them readable
// unchanged, instead of padding every call out with `{ name: ..., avatarKey: null }`.
const withoutImage = (names: string[]): Face[] =>
  names.map((name) => ({ name, avatarKey: null }));

const trip: Trip = {
  id: 't1', name: 'Norwegen mit dem Camper',
  start_date: '2026-08-01', end_date: '2026-08-14',
  status: 'active', owner_id: 'u1',
  members: withoutImage(['Lea', 'Mira', 'Jonas', 'Sofia']), member_count: 4, my_post_count: 7,
};

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('shows name, date range, and own counter', async () => {
  await wrap(<TripCard trip={trip} onPress={jest.fn()} />);
  expect(screen.getByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('1.–14. Aug 2026')).toBeTruthy();
  expect(screen.getByText('7 Momente')).toBeTruthy();
});

test('shows fellow travelers as overlapping avatars', async () => {
  await wrap(<TripCard trip={{ ...trip, members: withoutImage(['Lea', 'Mira', 'Jonas']) }} onPress={jest.fn()} />);
  // Avatar carries the initial until the image upload
  expect(screen.getByText('L')).toBeTruthy();
  expect(screen.getByText('M')).toBeTruthy();
  expect(screen.getByText('J')).toBeTruthy();
  expect(screen.queryByTestId('avatar-rest')).toBeNull();
});

// The card uses the same facepile as the trip detail (Avatar.test.tsx
// checks its rules in detail): from the fourth person on, a rest circle
// keeps counting instead of showing more faces. The fixture has four
// fellow travelers, three of them are visible.
test('from the fourth person on, the group keeps counting in the rest circle', async () => {
  await wrap(<TripCard trip={trip} onPress={jest.fn()} />);
  expect(screen.getByText('+1')).toBeTruthy();
  expect(screen.queryByText('S')).toBeNull();
});

// Two cards stacked shouldn't carry the same cover. The card itself
// doesn't pick it, it only passes its position through, checked here is
// that it actually does that.
test('the position picks the placeholder cover', async () => {
  // Both cards in ONE render: an interspersed `unmount()` would let the
  // act() regions overlap and drag the following tests in this file down
  // with it.
  await wrap(
    <>
      <TripCard trip={trip} position={0} onPress={jest.fn()} />
      <TripCard trip={{ ...trip, id: 't2' }} position={1} onPress={jest.fn()} />
    </>
  );
  const [first, second] = screen.getAllByTestId('reise-cover');
  expect(first.props.source).not.toBe(second.props.source);
});

// The seal is an image now, no longer text, so its accessibility label is
// what gets checked. It stands in for the word the pill used to carry:
// screen readers must still announce the state.
test('an ongoing trip carries the wax seal', async () => {
  await wrap(<TripCard trip={trip} onPress={jest.fn()} />);
  expect(screen.getByLabelText('Versiegelt')).toBeTruthy();
});

test('a revealed trip does not carry it', async () => {
  await wrap(<TripCard trip={{ ...trip, status: 'revealed' }} onPress={jest.fn()} />);
  expect(screen.queryByLabelText('Versiegelt')).toBeNull();
});

// Task 10: "developed" trips (revealed/archived) carry a play invitation
// instead of the seal, but ONLY if the caller explicitly requests it via
// `asRecap`, the counter-proof to the test above, which only shows that
// the old pill is MISSING, not that something meaningful takes its place.
test('a revealed trip carries the recap play pill with asRecap', async () => {
  await wrap(<TripCard trip={{ ...trip, status: 'revealed' }} asRecap onPress={jest.fn()} />);
  expect(screen.getByText('Recap ansehen')).toBeTruthy();
});

test('an archived trip carries it too, with asRecap', async () => {
  await wrap(<TripCard trip={{ ...trip, status: 'archived' }} asRecap onPress={jest.fn()} />);
  expect(screen.getByText('Recap ansehen')).toBeTruthy();
});

test('an ongoing trip does not carry the play pill, even with asRecap', async () => {
  await wrap(<TripCard trip={trip} asRecap onPress={jest.fn()} />);
  expect(screen.queryByText('Recap ansehen')).toBeNull();
});

// Review Task 10, Important 1: without `asRecap` (the trip tab leaves it
// out, see reise/index.tsx), a revealed trip stays without any pill, a tap
// there leads into trip management, not the recap, "view recap" would
// have been a promise the tap doesn't keep.
test('without asRecap, a revealed trip shows no pill', async () => {
  await wrap(<TripCard trip={{ ...trip, status: 'revealed' }} onPress={jest.fn()} />);
  expect(screen.queryByText('Recap ansehen')).toBeNull();
});

test('without asRecap, the same holds for an archived trip', async () => {
  await wrap(<TripCard trip={{ ...trip, status: 'archived' }} onPress={jest.fn()} />);
  expect(screen.queryByText('Recap ansehen')).toBeNull();
});

test('a single moment is counted in the singular', async () => {
  await wrap(<TripCard trip={{ ...trip, my_post_count: 1 }} onPress={jest.fn()} />);
  expect(screen.getByText('1 Moment')).toBeTruthy();
});

test('tapping reports the trip back', async () => {
  const onPress = jest.fn();
  await wrap(<TripCard trip={trip} onPress={onPress} />);
  await fireEvent.press(screen.getByText('Norwegen mit dem Camper'));
  expect(onPress).toHaveBeenCalled();
});
