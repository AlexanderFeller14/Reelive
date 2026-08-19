import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useFocusEffect: (cb: () => void) => cb(),
  Stack: { Screen: () => null },
}));
// expo-image ist ein natives View, im Test reicht ein Platzhalter, der alle
// Props durchreicht (gleiches Muster wie uebersicht.test.tsx). Ohne Mock
// scheitert schon der Import, expo-image/src/observe.ts erwartet eine native
// Umgebung.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});
jest.mock('@/features/trips/tripsApi', () => ({ fetchTrips: jest.fn() }));

import ReiseListe from '../index';
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

const wrap = () => render(<ThemeProvider><ReiseListe /></ThemeProvider>);

beforeEach(() => jest.clearAllMocks());

const geladen = (trips: unknown[]) => ({ data: trips, error: null });
const LADEFEHLER = 'Deine Reisen konnten nicht geladen werden. Probier es gleich nochmal.';

// Abgeschlossene Reisen gehören dem Recap-Tab; hier stünden sie doppelt und
// ein Tipp führte woandershin als dort (Verwaltung statt Übersicht).
test('zeigt nur laufende Reisen, keine Recaps', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([trip, recap]));
  await wrap();
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.queryByText('Lissabon Städtetrip')).toBeNull();
  expect(screen.queryByText('Recaps')).toBeNull();
});

test('ohne Reisen lädt der leere Zustand zum Handeln ein', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([]));
  await wrap();
  expect(await screen.findByText('Noch keine Reise')).toBeTruthy();
  expect(screen.getByText(/Leg deine erste Reise an/)).toBeTruthy();
});

// «Noch keine Reise» wäre hier eine falsche Aussage: es gibt Reisen, sie sind
// nur abgeschlossen. Der Leerzustand sagt das ehrlich und zeigt den Weg.
test('nur abgeschlossene Reisen: der Leerzustand verweist auf den Recap-Tab', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([recap]));
  await wrap();
  expect(await screen.findByText('Gerade keine Reise unterwegs')).toBeTruthy();
  expect(screen.getByText(/Recap-Tab/)).toBeTruthy();
  expect(screen.getByTestId('leerzustand-camper')).toBeTruthy();
  expect(screen.queryByText('Noch keine Reise')).toBeNull();
});

test('der leere Zustand zeigt den Camper', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([]));
  await wrap();
  expect(await screen.findByTestId('leerzustand-camper')).toBeTruthy();
});

// Gegenprobe: ohne sie belegte der Test darüber nur, dass das Bild existiert,
// nicht, dass es am leeren Zustand hängt. Über einer Liste echter Reisen wäre
// der Camper blosse Deko (DESIGN-LANGUAGE §7).
test('neben echten Reisen steht kein Camper', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([trip]));
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByTestId('leerzustand-camper')).toBeNull();
});

// Das Bild trägt keine Bedeutung, die der Text nicht schon sagt. Läge es im
// Accessibility-Baum, sagte VoiceOver vor «Noch keine Reise» ein nutzloses
// «Bild» an.
test('der Camper ist für VoiceOver unsichtbar', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([]));
  await wrap();
  const bild = await screen.findByTestId('leerzustand-camper');
  expect(bild.props.accessible).toBe(false);
});

// Gegenprobe zum Test darüber: Ohne sie belegt «Noch keine Reise» nur, dass der
// Text existiert, nicht, dass er an eine Bedingung geknüpft ist. Bei einem
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
  expect(mockPush).toHaveBeenCalledWith('/trip/new');
});

// `cover` hängt am Weg, nicht an der Reise: Es sagt dem Detail, welches
// Platzhalter-Bild die angetippte Karte trug, damit dort dasselbe steht
// (platzhalterCover.ts).
test('eine Karte führt in die Reise, mit ihrem Cover-Platz', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([trip]));
  await wrap();
  await fireEvent.press(await screen.findByText('Norwegen mit dem Camper'));
  expect(mockPush).toHaveBeenCalledWith('/trip/t1?cover=0');
});
