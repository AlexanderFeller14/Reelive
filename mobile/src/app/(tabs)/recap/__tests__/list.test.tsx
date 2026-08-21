import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockPush = jest.fn();
// Real effect semantics instead of `(cb) => cb()`: the latter fires on EVERY
// render and runs into an endless loop as soon as `load()` delivers a fresh
// array (a trap that has already cost time twice, in trip/__tests__/list.test.tsx
// and detail.test.tsx). `useEffect(cb, [cb])` mirrors what `useFocusEffect`
// actually does in the app: once on focus, not on every render.
jest.mock('expo-router', () => {
  const ReactActual = require('react');
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
    useFocusEffect: (cb: () => void | (() => void)) => ReactActual.useEffect(cb, [cb]),
    Stack: { Screen: () => null },
  };
});
// expo-image is a native view; in the test a placeholder passing all props
// through is enough (same pattern as overview.test.tsx). Without the mock even
// the import fails, expo-image/src/observe.ts expects a native environment.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});
jest.mock('@/features/trips/tripsApi', () => ({ fetchTrips: jest.fn() }));

import RecapList from '../index';
import { fetchTrips } from '@/features/trips/tripsApi';

const activeTrip = {
  id: 't1', name: 'Norwegen mit dem Camper', start_date: '2026-08-01', end_date: '2026-08-14',
  status: 'active' as const, owner_id: 'u1',
  members: [
    { name: 'Lea', avatarKey: null },
    { name: 'Jonas', avatarKey: null },
  ],
  member_count: 2, my_post_count: 7,
};
const recap = { ...activeTrip, id: 't2', name: 'Lissabon Städtetrip', status: 'revealed' as const };
const archived = { ...activeTrip, id: 't3', name: 'Alte Reise nach Kreta', status: 'archived' as const };

const wrap = () => render(<ThemeProvider><RecapList /></ThemeProvider>);

beforeEach(() => jest.clearAllMocks());

const loaded = (trips: unknown[]) => ({ data: trips, error: null });
const LOAD_ERROR = 'Deine Reisen konnten nicht geladen werden. Probier es gleich nochmal.';

test('shows revealed and archived trips, but never the one still running', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([activeTrip, recap, archived]));
  await wrap();
  expect(await screen.findByText('Lissabon Städtetrip')).toBeTruthy();
  expect(screen.getByText('Alte Reise nach Kreta')).toBeTruthy();
  expect(screen.queryByText('Norwegen mit dem Camper')).toBeNull();
});

test('with no recaps yet the empty state invites you to travel', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([activeTrip]));
  await wrap();
  expect(await screen.findByText('Noch kein Recap')).toBeTruthy();
  expect(screen.getByText('Der erste kommt, sobald ihr eine Reise abschliesst.')).toBeTruthy();
});

test('without a single trip the empty state stands there just the same', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([]));
  await wrap();
  expect(await screen.findByText('Noch kein Recap')).toBeTruthy();
});

test('the empty state shows the film reel', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([]));
  await wrap();
  expect(await screen.findByTestId('empty-state-film-reel')).toBeTruthy();
});

test('beside real recaps no film reel stands', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([recap]));
  await wrap();
  await screen.findByText('Lissabon Städtetrip');
  expect(screen.queryByTestId('empty-state-film-reel')).toBeNull();
});

test('the film reel stays invisible to VoiceOver', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([]));
  await wrap();
  const image = await screen.findByTestId('empty-state-film-reel');
  expect(image.props.accessible).toBe(false);
});

test('a load error names its cause instead of claiming there is no recap yet', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: LOAD_ERROR });
  await wrap();
  expect(await screen.findByText(LOAD_ERROR)).toBeTruthy();
  expect(screen.queryByText('Noch kein Recap')).toBeNull();
});

test('after a load error the button fetches the list again', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: LOAD_ERROR });
  await wrap();
  await screen.findByText(LOAD_ERROR);

  (fetchTrips as jest.Mock).mockResolvedValue(loaded([recap]));
  await fireEvent.press(screen.getByText('Nochmal versuchen'));
  expect(await screen.findByText('Lissabon Städtetrip')).toBeTruthy();
  expect(screen.queryByText(LOAD_ERROR)).toBeNull();
});

// Task 5 (recap-show plan): the tap used to lead into the overview, a tap
// on the card now opens the player directly, without a `start` index, that
// absence is what makes the player begin at the seal instead of mid-show.
test('a tap on the recap card starts the show, without a start index', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([recap]));
  await wrap();
  fireEvent.press(await screen.findByText('Lissabon Städtetrip'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player', params: { id: 't2' },
  });
});

// The card carries `asRecap` here and a tap really does open the player
// (see the test above), so the pill and the scrim it sits on may stand
// here, unlike on the trip tab (see TripCard.test.tsx).
test('the card promises the show with a translucent pill on the cover', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([recap]));
  await wrap();
  expect(await screen.findByTestId('recap-card-play')).toBeTruthy();
  expect(screen.getByTestId('trip-cover-scrim')).toBeTruthy();
});

// `fetchTrips` deliberately hangs unresolved here until the test releases it
// itself, that is the only way to look at the screen mid-load.
test('while the list is still loading the empty state stays away', async () => {
  let release: (v: { data: unknown[]; error: null }) => void = () => {};
  (fetchTrips as jest.Mock).mockReturnValue(new Promise((res) => { release = res; }));
  await wrap();
  expect(screen.queryByText('Noch kein Recap')).toBeNull();

  release(loaded([]));
  expect(await screen.findByText('Noch kein Recap')).toBeTruthy();
});

// The cover only exists where the device occupies a top strip; the global
// mock reports insets of 0, so the device measurement is set via the spy
// pattern from player.test.tsx.
describe('status bar cover', () => {
  let insetSpy: jest.SpyInstance | undefined;

  afterEach(() => {
    insetSpy?.mockRestore();
    insetSpy = undefined;
  });

  test('the cover stands on the recap list', async () => {
    const safeAreaModule = require('react-native-safe-area-context');
    insetSpy = jest
      .spyOn(safeAreaModule, 'useSafeAreaInsets')
      .mockReturnValue({ top: 59, bottom: 0, left: 0, right: 0 });
    (fetchTrips as jest.Mock).mockResolvedValue(loaded([recap]));
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    expect(screen.getByTestId('status-bar-cover')).toBeTruthy();
    // The cover lies over the top strip, the title starts below it: it must
    // still be there. Checked here because a cover that swallows the screen
    // title would otherwise pass every other test in this file.
    expect(screen.getByText('Deine Recaps')).toBeTruthy();
  });
});
