import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 't1' }),
}));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ userId: 'u1' }) }));
jest.mock('@/features/trips/tripsApi', () => ({
  createTrip: jest.fn(async () => ({ id: 'new-1', error: null })),
  updateTrip: jest.fn(async () => ({ error: null })),
  fetchTrip: jest.fn(async () => ({
    data: {
      id: 't1', name: 'Norwegen', start_date: '2026-08-01', end_date: '2026-08-14',
      status: 'active', owner_id: 'u1',
      member_names: ['Lea'], member_count: 1, my_post_count: 0,
    },
    error: null,
  })),
}));

// The calendar spans its range around today. Without a fixed day every test
// here would hang on the system date and break as soon as August 2026 runs out
// of the range. Deliberately just this one function instead of
// jest.useFakeTimers: fake timers reach into Animated, and both Sheet and
// PressScale animate.
jest.mock('@/features/trips/tripDay', () => ({
  ...jest.requireActual('@/features/trips/tripDay'),
  todaysCalendarDay: () => '2026-08-12',
}));

import NewTrip from '../new';
import EditTrip from '../[id]/edit';
import { createTrip, updateTrip, fetchTrip } from '@/features/trips/tripsApi';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

const fieldRow = (labelText: string) => {
  const field = screen.getByLabelText(labelText);
  return within(field.parent!.parent!);
};

beforeEach(() => jest.clearAllMocks());

const selectDateRange = async (fromLabel: string, toLabel: string) => {
  await fireEvent.press(screen.getByLabelText('Zeitraum, noch nichts gewählt'));
  await fireEvent.press(screen.getByLabelText(fromLabel));
  await fireEvent.press(screen.getByLabelText(toLabel));
  await fireEvent.press(screen.getByLabelText('Übernehmen'));
};

test('an empty name is caught before anything is created', async () => {
  await wrap(<NewTrip />);
  await selectDateRange('1. August 2026', '14. August 2026');
  await fireEvent.press(screen.getByText('Reise anlegen'));
  expect(await screen.findByText('Gib deiner Reise einen Namen.')).toBeTruthy();
  expect(createTrip).not.toHaveBeenCalled();
});

test('a missing date range is reported at the date range field', async () => {
  await wrap(<NewTrip />);
  await fireEvent.changeText(screen.getByLabelText('Name der Reise'), 'Norwegen');
  await fireEvent.press(screen.getByText('Reise anlegen'));
  expect(await screen.findByText('Trag den Zeitraum ein.')).toBeTruthy();
  expect(createTrip).not.toHaveBeenCalled();
});

test('valid input creates the trip and moves straight on to inviting', async () => {
  await wrap(<NewTrip />);
  await fireEvent.changeText(screen.getByLabelText('Name der Reise'), 'Norwegen');
  await selectDateRange('1. August 2026', '14. August 2026');
  await fireEvent.press(screen.getByText('Reise anlegen'));
  await waitFor(() =>
    expect(createTrip).toHaveBeenCalledWith({
      name: 'Norwegen', startDate: '2026-08-01', endDate: '2026-08-14', ownerId: 'u1',
    })
  );
  expect(mockReplace).toHaveBeenCalledWith('/trip/new-1/invite');
});

test('editing arrives with the stored values filled in and saves them', async () => {
  await wrap(<EditTrip />);
  expect(await screen.findByDisplayValue('Norwegen')).toBeTruthy();
  expect(await screen.findByText('1.–14. Aug 2026')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Name der Reise'), 'Norwegen 2026');
  await fireEvent.press(screen.getByText('Speichern'));
  await waitFor(() =>
    expect(updateTrip).toHaveBeenCalledWith('t1', {
      name: 'Norwegen 2026', startDate: '2026-08-01', endDate: '2026-08-14',
    })
  );
});

// === Editing: a read error and a save error are two different things ===

test('editing: a read error shows the cause instead of an empty form', async () => {
  (fetchTrip as jest.Mock).mockResolvedValueOnce({ data: null, error: 'Du bist gerade offline.' });
  await wrap(<EditTrip />);
  expect(await screen.findByText('Du bist gerade offline.')).toBeTruthy();
  expect(screen.queryByLabelText('Name der Reise')).toBeNull();
  expect(screen.getByText('Nochmal versuchen')).toBeTruthy();
});

test('editing: after tapping retry the form stands there filled in', async () => {
  (fetchTrip as jest.Mock).mockResolvedValueOnce({ data: null, error: 'Du bist gerade offline.' });
  await wrap(<EditTrip />);
  await fireEvent.press(await screen.findByText('Nochmal versuchen'));
  await waitFor(() => expect(screen.getByLabelText('Name der Reise').props.value).toBe('Norwegen'));
});

test('editing: a save error does not land in the name field, it says nothing about the name', async () => {
  (updateTrip as jest.Mock).mockResolvedValueOnce({
    error: 'Die Reise konnte nicht gespeichert werden. Probier es gleich nochmal.',
  });
  await wrap(<EditTrip />);
  await waitFor(() => expect(screen.getByLabelText('Name der Reise').props.value).toBe('Norwegen'));
  await fireEvent.press(screen.getByText('Speichern'));
  expect(await screen.findByText(/nicht gespeichert werden/)).toBeTruthy();
  expect(fieldRow('Name der Reise').queryByText(/nicht gespeichert werden/)).toBeNull();
});

// The cover only exists where the device occupies a top strip; the global
// mock reports insets of 0, so the device measurement is set via the spy
// pattern from player.test.tsx. Both forms sit in a KeyboardAvoidingView,
// which shifts them up under the status bar while typing.
describe('status bar cover', () => {
  let insetSpy: jest.SpyInstance;

  beforeEach(() => {
    const safeAreaModule = require('react-native-safe-area-context');
    insetSpy = jest
      .spyOn(safeAreaModule, 'useSafeAreaInsets')
      .mockReturnValue({ top: 59, bottom: 0, left: 0, right: 0 });
  });

  afterEach(() => insetSpy.mockRestore());

  test('the cover stands while creating a trip', async () => {
    await wrap(<NewTrip />);
    expect(screen.getByTestId('status-bar-cover')).toBeTruthy();
  });

  test('the cover stands while editing a trip', async () => {
    await wrap(<EditTrip />);
    await screen.findByDisplayValue('Norwegen');
    expect(screen.getByTestId('status-bar-cover')).toBeTruthy();
  });
});
