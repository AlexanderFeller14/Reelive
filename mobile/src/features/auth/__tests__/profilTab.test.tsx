import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

jest.mock('../AuthProvider', () => ({
  useAuth: () => ({ status: 'signedIn', userId: 'uid-1', refreshProfile: jest.fn() }),
}));
jest.mock('../profileApi', () => ({
  fetchOwnProfile: jest.fn(async () => ({ id: 'uid-1', username: 'lea', display_name: 'Lea' })),
}));
const mockSignOut = jest.fn();
jest.mock('../authApi', () => ({ signOut: () => mockSignOut() }));

// Task 10: der WLAN-Schalter liest/schreibt über das Einstellungen-Modul.
// Default "aus", passend zum dokumentierten Standard in einstellungen.ts.
const mockNurUeberWlan = jest.fn(async () => false);
const mockSetzeNurUeberWlan = jest.fn(async (_wert: boolean) => {});
jest.mock('@/features/moments/einstellungen', () => ({
  nurUeberWlan: () => mockNurUeberWlan(),
  setzeNurUeberWlan: (wert: boolean) => mockSetzeNurUeberWlan(wert),
}));

// Pfad-Anpassung (Task-10-Kontext, Abweichung 2): Router-Root ist mobile/src/app/,
// nicht mobile/app/ — von __tests__/ drei Ebenen hoch zu app/(tabs)/...
import ProfilScreen from '../../../app/(tabs)/profil';

beforeEach(() => {
  jest.clearAllMocks();
  mockNurUeberWlan.mockResolvedValue(false);
});

test('zeigt Profildaten und meldet ab', async () => {
  await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
  expect(await screen.findByText('Lea')).toBeTruthy();
  expect(screen.getByText('@lea')).toBeTruthy();
  await fireEvent.press(screen.getByText('Abmelden'));
  await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
});

test('zeigt den WLAN-Schalter mit Erklärung, was er bewirkt', async () => {
  await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
  expect(await screen.findByText('Nur über WLAN senden')).toBeTruthy();
  expect(
    screen.getByText('Spart mobile Daten — deine Momente warten, bis du wieder im WLAN bist.')
  ).toBeTruthy();
  expect(screen.getByLabelText('Nur über WLAN senden').props.value).toBe(false);
});

test('ein Tipp auf den Schalter schreibt die Wahl in die Einstellungen', async () => {
  await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
  const schalter = await screen.findByLabelText('Nur über WLAN senden');
  await fireEvent(schalter, 'valueChange', true);
  expect(mockSetzeNurUeberWlan).toHaveBeenCalledWith(true);
  expect(screen.getByLabelText('Nur über WLAN senden').props.value).toBe(true);
});

test('ein bereits gespeichertes „Nur über WLAN" zeigt sich beim Öffnen', async () => {
  mockNurUeberWlan.mockResolvedValue(true);
  await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
  await waitFor(() => expect(screen.getByLabelText('Nur über WLAN senden').props.value).toBe(true));
});
