import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace }),
  useLocalSearchParams: () => ({ code: 'abc123' }),
}));

const mockAuth = { status: 'signedIn' as string };
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/features/trips/tripsApi', () => ({ peekInvite: jest.fn(), redeemInvite: jest.fn() }));
jest.mock('@/features/trips/inviteLink', () => ({ rememberInvite: jest.fn(async () => {}) }));

import JoinScreen from '../[code]';
import { peekInvite, redeemInvite } from '@/features/trips/tripsApi';
import { rememberInvite } from '@/features/trips/inviteLink';

const preview = {
  trip_id: 't1', name: 'Norwegen mit dem Camper', start_date: '2026-08-01',
  end_date: '2026-08-14', status: 'active' as const, member_count: 4, owner_display_name: 'Lea',
};

const wrap = () => render(<ThemeProvider><JoinScreen /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.status = 'signedIn';
  (peekInvite as jest.Mock).mockResolvedValue({ data: preview, error: null });
});

test('zeigt die Vorschau samt einladender Person', async () => {
  await wrap();
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('Lea nimmt dich mit')).toBeTruthy();
  expect(screen.getByText('1.–14. Aug 2026')).toBeTruthy();
});

test('unbekannter Code erklärt die Lage', async () => {
  (peekInvite as jest.Mock).mockResolvedValue({ data: null, error: null });
  await wrap();
  expect(await screen.findByText('Diesen Einladungslink gibt es nicht mehr.')).toBeTruthy();
  expect(screen.queryByText('Reise beitreten')).toBeNull();
});

test('abgeschlossene Reise verweist auf den Recap-Link', async () => {
  (peekInvite as jest.Mock).mockResolvedValue({ data: { ...preview, status: 'revealed' }, error: null });
  await wrap();
  expect(
    await screen.findByText('Diese Reise ist schon abgeschlossen. Frag nach dem Recap-Link.')
  ).toBeTruthy();
  expect(screen.queryByText('Reise beitreten')).toBeNull();
});

test('eingeloggt: Beitritt führt in die Reise', async () => {
  (redeemInvite as jest.Mock).mockResolvedValue({ status: 'joined', trip_id: 't1' });
  await wrap();
  await fireEvent.press(await screen.findByText('Reise beitreten'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/trip/t1'));
});

test('bereits Mitglied führt ebenfalls in die Reise', async () => {
  (redeemInvite as jest.Mock).mockResolvedValue({ status: 'already_member', trip_id: 't1' });
  await wrap();
  await fireEvent.press(await screen.findByText('Reise beitreten'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/trip/t1'));
});

test('ohne Session wird der Code gemerkt und zum Login geschickt', async () => {
  mockAuth.status = 'signedOut';
  await wrap();
  await fireEvent.press(await screen.findByText('Reise beitreten'));
  await waitFor(() => expect(rememberInvite).toHaveBeenCalledWith('abc123'));
  expect(mockReplace).toHaveBeenCalledWith('/welcome');
  expect(redeemInvite).not.toHaveBeenCalled();
});

// Der Unterschied zwischen «gibt es nicht» und «konnte nicht nachsehen»: nur
// der zweite Fall darf wiederholbar sein. Vorher sah der Gast im Funkloch den
// Satz, der die Einladung fuer erloschen erklaert, endgueltig und falsch.
test('Lesefehler zeigt den Fehler und laesst es nochmal versuchen', async () => {
  (peekInvite as jest.Mock).mockResolvedValue({ data: null, error: 'Du bist gerade offline.' });
  await wrap();
  expect(await screen.findByText('Du bist gerade offline.')).toBeTruthy();
  expect(screen.queryByText('Diesen Einladungslink gibt es nicht mehr.')).toBeNull();

  (peekInvite as jest.Mock).mockResolvedValue({ data: preview, error: null });
  await fireEvent.press(screen.getByText('Nochmal versuchen'));
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
});
