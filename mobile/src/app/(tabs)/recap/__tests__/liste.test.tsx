import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockPush = jest.fn();
// Echte Effekt-Semantik statt `(cb) => cb()`: Letzteres feuert bei JEDEM
// Rendern und läuft in eine Endlosschleife, sobald `laden()` ein frisches
// Array liefert (Falle, die in reise/__tests__/liste.test.tsx und
// detail.test.tsx bereits zweimal Zeit gekostet hat, siehe Task-10-Auftrag).
// `useEffect(cb, [cb])` bildet ab, was `useFocusEffect` in der App tatsächlich
// tut: einmal beim Fokussieren, nicht bei jedem Render.
jest.mock('expo-router', () => {
  const ReactActual = require('react');
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
    useFocusEffect: (cb: () => void | (() => void)) => ReactActual.useEffect(cb, [cb]),
    Stack: { Screen: () => null },
  };
});
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

import RecapListe from '../index';
import { fetchTrips } from '@/features/trips/tripsApi';

const aktiveReise = {
  id: 't1', name: 'Norwegen mit dem Camper', start_date: '2026-08-01', end_date: '2026-08-14',
  status: 'active' as const, owner_id: 'u1',
  member_names: ['Lea', 'Jonas'], member_count: 2, my_post_count: 7,
};
const recap = { ...aktiveReise, id: 't2', name: 'Lissabon Städtetrip', status: 'revealed' as const };
const archiv = { ...aktiveReise, id: 't3', name: 'Alte Reise nach Kreta', status: 'archived' as const };

const wrap = () => render(<ThemeProvider><RecapListe /></ThemeProvider>);

beforeEach(() => jest.clearAllMocks());

const geladen = (trips: unknown[]) => ({ data: trips, error: null });
const LADEFEHLER = 'Deine Reisen konnten nicht geladen werden. Probier es gleich nochmal.';

test('zeigt aufgedeckte und archivierte Reisen, aber keine laufende', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([aktiveReise, recap, archiv]));
  await wrap();
  expect(await screen.findByText('Lissabon Städtetrip')).toBeTruthy();
  expect(screen.getByText('Alte Reise nach Kreta')).toBeTruthy();
  expect(screen.queryByText('Norwegen mit dem Camper')).toBeNull();
});

test('ohne Recaps lädt der leere Zustand zum Handeln ein', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([aktiveReise]));
  await wrap();
  expect(await screen.findByText('Noch kein Recap')).toBeTruthy();
  expect(screen.getByText('Der erste kommt, sobald ihr eine Reise abschliesst.')).toBeTruthy();
});

test('ganz ohne Reisen ist der leere Zustand ebenfalls sichtbar', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([]));
  await wrap();
  expect(await screen.findByText('Noch kein Recap')).toBeTruthy();
});

test('der leere Zustand zeigt die Filmrolle', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([]));
  await wrap();
  expect(await screen.findByTestId('leerzustand-filmrolle')).toBeTruthy();
});

// Gegenprobe zum Test darüber: ohne sie belegte er nur, dass das Bild
// existiert, nicht, dass es am leeren Zustand hängt. Über einer Liste echter
// Recap-Karten wäre die Filmrolle blosse Deko (DESIGN-LANGUAGE §7).
test('neben echten Recaps steht keine Filmrolle', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([recap]));
  await wrap();
  await screen.findByText('Lissabon Städtetrip');
  expect(screen.queryByTestId('leerzustand-filmrolle')).toBeNull();
});

// Das Bild trägt keine Bedeutung, die der Text nicht schon sagt. Läge es im
// Accessibility-Baum, sagte VoiceOver vor «Noch kein Recap» ein nutzloses
// «Bild» an.
test('die Filmrolle ist für VoiceOver unsichtbar', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([]));
  await wrap();
  const bild = await screen.findByTestId('leerzustand-filmrolle');
  expect(bild.props.accessible).toBe(false);
});

// Gegenprobe: ohne diesen Test belegt der Test oben nur, dass der Text
// existiert, nicht, dass er an eine Bedingung geknüpft ist. Bei einem
// Ladefehler wäre «Noch kein Recap» schlicht falsch: über die Reisen der
// Person ist dann nichts bekannt.
test('ein Ladefehler zeigt die Ursache statt «Noch kein Recap»', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: LADEFEHLER });
  await wrap();
  expect(await screen.findByText(LADEFEHLER)).toBeTruthy();
  expect(screen.queryByText('Noch kein Recap')).toBeNull();
});

test('nach einem Ladefehler lädt der Knopf erneut', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: LADEFEHLER });
  await wrap();
  await screen.findByText(LADEFEHLER);

  (fetchTrips as jest.Mock).mockResolvedValue(geladen([recap]));
  await fireEvent.press(screen.getByText('Nochmal versuchen'));
  expect(await screen.findByText('Lissabon Städtetrip')).toBeTruthy();
  expect(screen.queryByText(LADEFEHLER)).toBeNull();
});

test('eine Karte führt in die Übersicht dieser Reise', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([recap]));
  await wrap();
  await fireEvent.press(await screen.findByText('Lissabon Städtetrip'));
  expect(mockPush).toHaveBeenCalledWith('/recap/t2/uebersicht');
});

// Review Task 10, Important 1: die Karte trägt hier `alsRecap`, ein Tipp
// führt tatsächlich in die Übersicht (siehe Test oben), die Pille darf hier
// also stehen (anders als auf dem Reise-Tab, siehe TripCard.test.tsx).
test('eine Recap-Karte trägt die Play-Pille', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([recap]));
  await wrap();
  expect(await screen.findByText('Recap ansehen')).toBeTruthy();
});

// Review Task 10, Important 2 (M2): `geladen &&` in der `leer`-Bedingung
// entfernt hätte «Noch kein Recap» schon WÄHREND des Ladens gezeigt, obwohl
// `trips` zu diesem Zeitpunkt nur deshalb leer ist, weil noch nichts
// angekommen ist, keine Aussage über die Daten der Person. `fetchTrips`
// bleibt hier absichtlich unaufgelöst hängen, bis der Test es selbst freigibt.
test('während des Ladens erscheint der leere Zustand nicht', async () => {
  let freigeben: (v: { data: unknown[]; error: null }) => void = () => {};
  (fetchTrips as jest.Mock).mockReturnValue(new Promise((res) => { freigeben = res; }));
  await wrap();
  expect(screen.queryByText('Noch kein Recap')).toBeNull();

  freigeben(geladen([]));
  expect(await screen.findByText('Noch kein Recap')).toBeTruthy();
});
