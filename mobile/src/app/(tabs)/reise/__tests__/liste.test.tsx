import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useFocusEffect: (cb: () => void) => cb(),
  Stack: { Screen: () => null },
}));
jest.mock('@/features/trips/tripsApi', () => ({ fetchTrips: jest.fn() }));

import ReiseListe from '../index';
import { fetchTrips } from '@/features/trips/tripsApi';

const trip = {
  id: 't1', name: 'Norwegen mit dem Camper', start_date: '2026-08-01', end_date: '2026-08-14',
  status: 'active' as const, owner_id: 'u1',
  member_names: ['Lea', 'Jonas'], member_count: 2, my_post_count: 7,
};
const recap = { ...trip, id: 't2', name: 'Lissabon Städtetrip', status: 'revealed' as const };

const wrap = () => render(<ThemeProvider><ReiseListe /></ThemeProvider>);

beforeEach(() => jest.clearAllMocks());

test('zeigt laufende Reisen und Recaps getrennt', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue([trip, recap]);
  await wrap();
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('Lissabon Städtetrip')).toBeTruthy();
  expect(screen.getByText('Unterwegs')).toBeTruthy();
  expect(screen.getByText('Recaps')).toBeTruthy();
});

test('ohne Reisen lädt der leere Zustand zum Handeln ein', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue([]);
  await wrap();
  expect(await screen.findByText('Noch keine Reise')).toBeTruthy();
  expect(screen.getByText(/Leg deine erste Reise an/)).toBeTruthy();
  expect(screen.queryByText('Unterwegs')).toBeNull();
});

test('der Knopf führt zum Anlegen', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue([]);
  await wrap();
  await waitFor(() => expect(fetchTrips).toHaveBeenCalled());
  await fireEvent.press(screen.getByLabelText('Neue Reise'));
  expect(mockPush).toHaveBeenCalledWith('/reise/neu');
});

test('eine Karte führt in die Reise', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue([trip]);
  await wrap();
  await fireEvent.press(await screen.findByText('Norwegen mit dem Camper'));
  expect(mockPush).toHaveBeenCalledWith('/reise/t1');
});
