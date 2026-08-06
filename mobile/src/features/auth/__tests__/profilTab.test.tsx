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

// Pfad-Anpassung (Task-10-Kontext, Abweichung 2): Router-Root ist mobile/src/app/,
// nicht mobile/app/ — von __tests__/ drei Ebenen hoch zu app/(tabs)/...
import ProfilScreen from '../../../app/(tabs)/profil';

test('zeigt Profildaten und meldet ab', async () => {
  await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
  expect(await screen.findByText('Lea')).toBeTruthy();
  expect(screen.getByText('@lea')).toBeTruthy();
  await fireEvent.press(screen.getByText('Abmelden'));
  await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
});
