import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 't1' }),
  useFocusEffect: (cb: () => void) => cb(),
}));

// Alert zeigt im Test nur einen Dialog an, ohne dass jemand tippt. Damit die
// destruktiven Pfade prüfbar sind, wird der bestätigende Knopf sofort ausgelöst.
type AlertKnopf = { text?: string; style?: string; onPress?: () => void };
jest.spyOn(Alert, 'alert').mockImplementation((_titel, _text, knoepfe) => {
  (knoepfe as AlertKnopf[] | undefined)?.find((k) => k.style === 'destructive')?.onPress?.();
});

const mockAuth = { userId: 'u1' };
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/features/trips/tripsApi', () => ({
  fetchTrip: jest.fn(),
  fetchMembers: jest.fn(),
  removeMember: jest.fn(async () => ({ error: null })),
  deleteTrip: jest.fn(async () => ({ error: null })),
}));

import ReiseDetail from '../[id]/index';
import { fetchTrip, fetchMembers, removeMember } from '@/features/trips/tripsApi';

const trip = {
  id: 't1', name: 'Norwegen mit dem Camper', start_date: '2026-08-01', end_date: '2026-08-14',
  status: 'active' as const, owner_id: 'u1',
  member_names: ['Lea', 'Jonas'], member_count: 2, my_post_count: 0,
};
const mitglieder = [
  { user_id: 'u1', role: 'owner' as const, username: 'lea', display_name: 'Lea' },
  { user_id: 'u2', role: 'member' as const, username: 'jonas', display_name: 'Jonas' },
];

const wrap = () => render(<ThemeProvider><ReiseDetail /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.userId = 'u1';
  (fetchTrip as jest.Mock).mockResolvedValue(trip);
  (fetchMembers as jest.Mock).mockResolvedValue(mitglieder);
});

test('zeigt Name, Zeitraum und Mitglieder', async () => {
  await wrap();
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('1.–14. Aug 2026')).toBeTruthy();
  expect(screen.getByText('Lea')).toBeTruthy();
  expect(screen.getByText('Jonas')).toBeTruthy();
});

test('zeigt den eigenen Zähler mit Erklärung', async () => {
  await wrap();
  expect(await screen.findByText('0')).toBeTruthy();
  expect(screen.getByText(/Momente eingefangen/)).toBeTruthy();
});

test('Owner kann einladen, bearbeiten und Mitglieder entfernen', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Freunde einladen'));
  expect(mockPush).toHaveBeenCalledWith('/reise/t1/einladen');

  await fireEvent.press(screen.getByLabelText('Jonas entfernen'));
  await waitFor(() => expect(removeMember).toHaveBeenCalledWith('t1', 'u2'));
});

test('Owner kann sich selbst nicht entfernen', async () => {
  await wrap();
  await screen.findByText('Lea');
  expect(screen.queryByLabelText('Lea entfernen')).toBeNull();
});

test('Mitglied sieht Verlassen statt Löschen', async () => {
  mockAuth.userId = 'u2';
  await wrap();
  expect(await screen.findByText('Reise verlassen')).toBeTruthy();
  expect(screen.queryByText('Reise löschen')).toBeNull();
  expect(screen.queryByLabelText('Jonas entfernen')).toBeNull();
});

test('Owner sieht Löschen statt Verlassen', async () => {
  await wrap();
  expect(await screen.findByText('Reise löschen')).toBeTruthy();
  expect(screen.queryByText('Reise verlassen')).toBeNull();
});

test('aufgedeckte Reise zeigt keinen Einladen-Knopf', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ ...trip, status: 'revealed' });
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByText('Freunde einladen')).toBeNull();
});
