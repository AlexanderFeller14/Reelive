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
// DESIGN-LANGUAGE §5: destruktive Dialoge lösen warning-Haptik aus.
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Warning: 'warning' },
}));

import ReiseDetail from '../[id]/index';
import * as Haptics from 'expo-haptics';
import { fetchTrip, fetchMembers, removeMember, deleteTrip } from '@/features/trips/tripsApi';

const trip = {
  id: 't1', name: 'Norwegen mit dem Camper', start_date: '2026-08-01', end_date: '2026-08-14',
  status: 'active' as const, owner_id: 'u1',
  member_names: ['Lea', 'Jonas'], member_count: 2, my_post_count: 0,
};
const mitglieder = [
  { user_id: 'u1', role: 'owner' as const, username: 'lea', display_name: 'Lea' },
  { user_id: 'u2', role: 'member' as const, username: 'jonas', display_name: 'Jonas' },
];
// Stabile Referenzen: der useFocusEffect-Mock ruft bei jedem Render nach, ein
// jedes Mal neues Objekt würde die Screens endlos neu rendern lassen.
const tripOk = { data: trip, error: null };
const mitgliederOk = { data: mitglieder, error: null };

const wrap = () => render(<ThemeProvider><ReiseDetail /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.userId = 'u1';
  (fetchTrip as jest.Mock).mockResolvedValue(tripOk);
  (fetchMembers as jest.Mock).mockResolvedValue(mitgliederOk);
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
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, status: 'revealed' }, error: null });
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByText('Freunde einladen')).toBeNull();
});

test('Owner löscht die Reise', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Reise löschen'));
  await waitFor(() => expect(deleteTrip).toHaveBeenCalledWith('t1'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/reise'));
});

test('Mitglied verlässt die Reise', async () => {
  mockAuth.userId = 'u2';
  await wrap();
  await fireEvent.press(await screen.findByText('Reise verlassen'));
  await waitFor(() => expect(removeMember).toHaveBeenCalledWith('t1', 'u2'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/reise'));
});

test('Löschen schlägt fehl: keine Navigation, Fehler wird gezeigt', async () => {
  (deleteTrip as jest.Mock).mockResolvedValueOnce({
    error: 'Die Reise wurde nicht gelöscht. Es gibt sie nicht mehr, oder sie gehört dir nicht.',
  });
  await wrap();
  await fireEvent.press(await screen.findByText('Reise löschen'));
  await waitFor(() => expect(deleteTrip).toHaveBeenCalledWith('t1'));
  await waitFor(() =>
    expect(Alert.alert).toHaveBeenCalledWith(
      'Nicht gelöscht',
      'Die Reise wurde nicht gelöscht. Es gibt sie nicht mehr, oder sie gehört dir nicht.'
    )
  );
  expect(mockReplace).not.toHaveBeenCalled();
});

const LADEFEHLER = 'Diese Reise konnte nicht geladen werden. Probier es gleich nochmal.';

test('ein Lesefehler erklärt sich und lässt zurück statt weiss zu bleiben', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: null, error: LADEFEHLER });
  await wrap();
  expect(await screen.findByText(LADEFEHLER)).toBeTruthy();
  // Der Stack hat keinen Header — ohne diesen Knopf gäbe es keinen Rückweg.
  await fireEvent.press(screen.getByText('Zu meinen Reisen'));
  expect(mockReplace).toHaveBeenCalledWith('/reise');
});

test('nach einem Lesefehler lädt der Knopf erneut', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: null, error: LADEFEHLER });
  await wrap();
  await screen.findByText(LADEFEHLER);

  (fetchTrip as jest.Mock).mockResolvedValue(tripOk);
  await fireEvent.press(screen.getByText('Nochmal versuchen'));
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
});

test('eine verschwundene Reise sagt das, statt einen Ladefehler zu behaupten', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: null, error: null });
  await wrap();
  expect(await screen.findByText('Diese Reise gibt es nicht mehr.')).toBeTruthy();
  expect(screen.queryByText('Nochmal versuchen')).toBeNull();
});

test('ein Fehler beim Mitgliederladen bleibt in der Sektion sichtbar', async () => {
  const meldung = 'Die Mitglieder konnten nicht geladen werden. Probier es gleich nochmal.';
  (fetchMembers as jest.Mock).mockResolvedValue({ data: [], error: meldung });
  await wrap();
  expect(await screen.findByText(meldung)).toBeTruthy();
  // Die Reise selbst kam durch und bleibt bedienbar.
  expect(screen.getByText('Norwegen mit dem Camper')).toBeTruthy();
});

test.each([
  ['Jonas entfernen', 'label'],
  ['Reise löschen', 'text'],
] as const)('destruktiver Dialog «%s» löst warning-Haptik aus', async (name, art) => {
  await wrap();
  const knopf = art === 'label' ? screen.getByLabelText(name) : await screen.findByText(name);
  await fireEvent.press(knopf);
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
});

test('«Reise verlassen» löst warning-Haptik aus', async () => {
  mockAuth.userId = 'u2';
  await wrap();
  await fireEvent.press(await screen.findByText('Reise verlassen'));
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
});

test('Haptik bleibt sparsam: kein Auslösen ohne destruktiven Dialog', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Freunde einladen'));
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});
