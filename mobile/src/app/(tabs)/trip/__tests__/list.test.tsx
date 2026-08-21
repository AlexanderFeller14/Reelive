import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useFocusEffect: (cb: () => void) => cb(),
  Stack: { Screen: () => null },
}));
// expo-image is a native view, in the test a placeholder that passes all props
// through is enough (same pattern as overview.test.tsx). Without the mock even
// the import fails, expo-image/src/observe.ts expects a native environment.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});
jest.mock('@/features/trips/tripsApi', () => ({ fetchTrips: jest.fn() }));
// The section split derives «planned» from the real clock via
// todaysCalendarDay(); pinned here so the fixtures below never age out of
// their group. Everything else in the module stays real.
jest.mock('@/features/trips/tripDay', () => ({
  ...jest.requireActual('@/features/trips/tripDay'),
  todaysCalendarDay: () => '2026-08-10',
}));

import TripList from '../index';
import { fetchTrips } from '@/features/trips/tripsApi';

const trip = {
  id: 't1', name: 'Norwegen mit dem Camper', start_date: '2026-08-01', end_date: '2026-08-14',
  status: 'active' as const, owner_id: 'u1',
  members: [
    { name: 'Lea', avatarKey: null },
    { name: 'Jonas', avatarKey: null },
  ],
  member_count: 2, my_post_count: 7,
};
const recap = { ...trip, id: 't2', name: 'Lissabon Städtetrip', status: 'revealed' as const };
const planned = {
  ...trip, id: 't3', name: 'Island im Winter', start_date: '2026-09-01', end_date: '2026-09-10',
};

const wrap = () => render(<ThemeProvider><TripList /></ThemeProvider>);

beforeEach(() => jest.clearAllMocks());

const loaded = (trips: unknown[]) => ({ data: trips, error: null });
const LOAD_ERROR = 'Deine Reisen konnten nicht geladen werden. Probier es gleich nochmal.';

test('shows only ongoing trips, revealed ones belong to the recap tab', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip, recap]));
  await wrap();
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.queryByText('Lissabon Städtetrip')).toBeNull();
  expect(screen.queryByText('Recaps')).toBeNull();
});

test('without a single trip the empty state invites you to act', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([]));
  await wrap();
  expect(await screen.findByText('Noch keine Reise')).toBeTruthy();
  expect(screen.getByText(/Leg deine erste Reise an/)).toBeTruthy();
});

test('with only finished trips the empty state points to the recap tab instead of claiming there is none', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([recap]));
  await wrap();
  expect(await screen.findByText('Gerade keine Reise unterwegs')).toBeTruthy();
  expect(screen.getByText(/Recap-Tab/)).toBeTruthy();
  expect(screen.getByTestId('empty-state-camper')).toBeTruthy();
  expect(screen.queryByText('Noch keine Reise')).toBeNull();
});

test('the empty state shows the camper', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([]));
  await wrap();
  expect(await screen.findByTestId('empty-state-camper')).toBeTruthy();
});

test('next to real trips no camper stands, it would be mere decoration there', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip]));
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByTestId('empty-state-camper')).toBeNull();
});

test('the camper stays invisible to VoiceOver, the text below already says it', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([]));
  await wrap();
  const image = await screen.findByTestId('empty-state-camper');
  expect(image.props.accessible).toBe(false);
});

test('a load error names its cause instead of claiming there is no trip yet', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: LOAD_ERROR });
  await wrap();
  expect(await screen.findByText(LOAD_ERROR)).toBeTruthy();
  expect(screen.queryByText('Noch keine Reise')).toBeNull();
});

test('after a load error the button loads once more', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: LOAD_ERROR });
  await wrap();
  await screen.findByText(LOAD_ERROR);

  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip]));
  await fireEvent.press(screen.getByText('Nochmal versuchen'));
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.queryByText(LOAD_ERROR)).toBeNull();
});

test('a retry that fails again hands the button back instead of a dead spinner', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: LOAD_ERROR });
  await wrap();
  await screen.findByText(LOAD_ERROR);

  await fireEvent.press(screen.getByText('Nochmal versuchen'));
  expect(await screen.findByText('Nochmal versuchen')).toBeTruthy();
  expect(screen.queryByTestId('button-loading')).toBeNull();
});

test('the floating button leads to creating a trip', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([]));
  await wrap();
  await waitFor(() => expect(fetchTrips).toHaveBeenCalled());
  await fireEvent.press(screen.getByLabelText('Neue Reise'));
  expect(mockPush).toHaveBeenCalledWith('/trip/new');
});

test('tapping a card opens the trip and hands its cover slot along', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip]));
  await wrap();
  await fireEvent.press(await screen.findByText('Norwegen mit dem Camper'));
  expect(mockPush).toHaveBeenCalledWith('/trip/t1?cover=0');
});

test('without planned trips the list stays plain, no section titles', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip]));
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByText('Aktiv')).toBeNull();
  expect(screen.queryByText('Geplant')).toBeNull();
});

test('a planned trip splits the list into Aktiv above and Geplant below', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([planned, trip]));
  await wrap();
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('Island im Winter')).toBeTruthy();
  const titles = screen.getAllByText(/^(Aktiv|Geplant)$/).map((n) => n.props.children);
  expect(titles).toEqual(['Aktiv', 'Geplant']);
});

test('with only planned trips the Geplant section stands alone, no empty state', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([planned, recap]));
  await wrap();
  expect(await screen.findByText('Island im Winter')).toBeTruthy();
  expect(screen.getByText('Geplant')).toBeTruthy();
  expect(screen.queryByText('Aktiv')).toBeNull();
  expect(screen.queryByText('Gerade keine Reise unterwegs')).toBeNull();
  expect(screen.queryByTestId('empty-state-camper')).toBeNull();
});

test('a planned card continues the cover slots after the running ones', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([planned, trip]));
  await wrap();
  await fireEvent.press(await screen.findByText('Island im Winter'));
  expect(mockPush).toHaveBeenCalledWith('/trip/t3?cover=1');
});

// The cover only exists where the device occupies a top strip; the global
// mock reports insets of 0, so the device measurement is set via the spy
// pattern from player.test.tsx.
describe('status bar cover', () => {
  let insetSpy: jest.SpyInstance;

  afterEach(() => insetSpy.mockRestore());

  test('an opaque surface backs the status bar, scrolled content never shows behind it', async () => {
    const safeAreaModule = require('react-native-safe-area-context');
    insetSpy = jest
      .spyOn(safeAreaModule, 'useSafeAreaInsets')
      .mockReturnValue({ top: 59, bottom: 0, left: 0, right: 0 });
    (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip]));
    await wrap();
    await screen.findByText('Norwegen mit dem Camper');
    expect(screen.getByTestId('status-bar-cover')).toBeTruthy();
  });
});
