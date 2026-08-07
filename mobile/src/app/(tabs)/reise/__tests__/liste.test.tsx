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

const geladen = (trips: unknown[]) => ({ data: trips, error: null });
const LADEFEHLER = 'Deine Reisen konnten nicht geladen werden. Probier es gleich nochmal.';

test('zeigt laufende Reisen und Recaps getrennt', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([trip, recap]));
  await wrap();
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('Lissabon Städtetrip')).toBeTruthy();
  expect(screen.getByText('Unterwegs')).toBeTruthy();
  expect(screen.getByText('Recaps')).toBeTruthy();
});

test('ohne Reisen lädt der leere Zustand zum Handeln ein', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([]));
  await wrap();
  expect(await screen.findByText('Noch keine Reise')).toBeTruthy();
  expect(screen.getByText(/Leg deine erste Reise an/)).toBeTruthy();
  expect(screen.queryByText('Unterwegs')).toBeNull();
});

// Gegenprobe zum Test darüber: Ohne sie belegt «Noch keine Reise» nur, dass der
// Text existiert — nicht, dass er an eine Bedingung geknüpft ist. Bei einem
// Ladefehler wäre die Aussage schlicht falsch: über die Reisen des Nutzers ist
// dann nichts bekannt.
test('ein Ladefehler zeigt die Ursache statt «Noch keine Reise»', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: LADEFEHLER });
  await wrap();
  expect(await screen.findByText(LADEFEHLER)).toBeTruthy();
  expect(screen.queryByText('Noch keine Reise')).toBeNull();
});

test('nach einem Ladefehler lädt der Knopf erneut', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: LADEFEHLER });
  await wrap();
  await screen.findByText(LADEFEHLER);

  (fetchTrips as jest.Mock).mockResolvedValue(geladen([trip]));
  await fireEvent.press(screen.getByText('Nochmal versuchen'));
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.queryByText(LADEFEHLER)).toBeNull();
});

test('der Knopf führt zum Anlegen', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([]));
  await wrap();
  await waitFor(() => expect(fetchTrips).toHaveBeenCalled());
  await fireEvent.press(screen.getByLabelText('Neue Reise'));
  expect(mockPush).toHaveBeenCalledWith('/reise/neu');
});

test('eine Karte führt in die Reise', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([trip]));
  await wrap();
  await fireEvent.press(await screen.findByText('Norwegen mit dem Camper'));
  expect(mockPush).toHaveBeenCalledWith('/reise/t1');
});
