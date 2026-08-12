import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

// expo-image ist ein natives View, im Test reicht ein Platzhalter, der alle
// Props durchreicht (gleiches Muster wie recap/__tests__/liste.test.tsx).
// Nötig, seit das Cover ein Bild trägt: ohne Mock scheitert schon der Import,
// expo-image/src/observe.ts erwartet eine native Umgebung.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

import { TripCard } from '../TripCard';
import type { Trip } from '@/features/trips/types';

const trip: Trip = {
  id: 't1', name: 'Norwegen mit dem Camper',
  start_date: '2026-08-01', end_date: '2026-08-14',
  status: 'active', owner_id: 'u1',
  member_names: ['Lea', 'Mira', 'Jonas', 'Sofia'], member_count: 4, my_post_count: 7,
};

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('zeigt Name, Zeitraum und eigenen Zähler', async () => {
  await wrap(<TripCard trip={trip} onPress={jest.fn()} />);
  expect(screen.getByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('1.–14. Aug 2026')).toBeTruthy();
  expect(screen.getByText('7 Momente')).toBeTruthy();
});

test('zeigt die Mitreisenden als überlappende Avatare', async () => {
  await wrap(<TripCard trip={{ ...trip, member_names: ['Lea', 'Mira', 'Jonas'] }} onPress={jest.fn()} />);
  // Avatar trägt bis zum Bild-Upload die Initiale
  expect(screen.getByText('L')).toBeTruthy();
  expect(screen.getByText('M')).toBeTruthy();
  expect(screen.getByText('J')).toBeTruthy();
  expect(screen.queryByTestId('avatar-rest')).toBeNull();
});

// Die Karte nutzt dieselbe Facepile wie der Reise-Detail (Avatar.test.tsx
// prüft ihre Regeln im Detail): ab der vierten Person zählt ein Rest-Kreis
// weiter, statt weitere Gesichter zu zeigen. Das Fixture hat vier
// Mitreisende, drei davon sind zu sehen.
test('ab der vierten Person zählt die Gruppe im Rest-Kreis weiter', async () => {
  await wrap(<TripCard trip={trip} onPress={jest.fn()} />);
  expect(screen.getByText('+1')).toBeTruthy();
  expect(screen.queryByText('S')).toBeNull();
});

// Zwei Karten untereinander sollen nicht dasselbe Cover tragen. Die Karte
// selbst wählt es nicht aus, sie reicht nur ihren Platz durch — geprüft wird
// hier, dass sie das überhaupt tut.
test('die Position wählt das Platzhalter-Cover', async () => {
  // Beide Karten in EINEM Render: ein zwischengeschobenes `unmount()` liesse
  // die act()-Bereiche überlappen und riss die folgenden Tests dieser Datei
  // mit.
  await wrap(
    <>
      <TripCard trip={trip} position={0} onPress={jest.fn()} />
      <TripCard trip={{ ...trip, id: 't2' }} position={1} onPress={jest.fn()} />
    </>
  );
  const [erste, zweite] = screen.getAllByTestId('reise-cover');
  expect(erste.props.source).not.toBe(zweite.props.source);
});

// Das Siegel ist ein Bild, kein Text mehr — geprüft wird deshalb sein
// Accessibility-Label. Es steht dort stellvertretend für das Wort, das die
// Pille vorher trug: Screenreader müssen den Zustand weiterhin ansagen.
test('laufende Reise trägt das Wachssiegel', async () => {
  await wrap(<TripCard trip={trip} onPress={jest.fn()} />);
  expect(screen.getByLabelText('Versiegelt')).toBeTruthy();
});

test('aufgedeckte Reise trägt es nicht', async () => {
  await wrap(<TripCard trip={{ ...trip, status: 'revealed' }} onPress={jest.fn()} />);
  expect(screen.queryByLabelText('Versiegelt')).toBeNull();
});

// Task 10: «entwickelte» Reisen (revealed/archived) tragen statt des
// Siegels eine Play-Einladung, aber NUR wenn der Aufrufer das per
// `alsRecap` ausdrücklich anfordert, Gegenprobe zum Test oben, der nur
// belegt, dass die alte Pille FEHLT, nicht dass etwas Sinnvolles an ihre
// Stelle tritt.
test('aufgedeckte Reise trägt mit alsRecap die Recap-Play-Pille', async () => {
  await wrap(<TripCard trip={{ ...trip, status: 'revealed' }} alsRecap onPress={jest.fn()} />);
  expect(screen.getByText('Recap ansehen')).toBeTruthy();
});

test('archivierte Reise trägt sie mit alsRecap ebenfalls', async () => {
  await wrap(<TripCard trip={{ ...trip, status: 'archived' }} alsRecap onPress={jest.fn()} />);
  expect(screen.getByText('Recap ansehen')).toBeTruthy();
});

test('laufende Reise trägt die Play-Pille nicht, selbst mit alsRecap', async () => {
  await wrap(<TripCard trip={trip} alsRecap onPress={jest.fn()} />);
  expect(screen.queryByText('Recap ansehen')).toBeNull();
});

// Review Task 10, Important 1: ohne `alsRecap` (der Reise-Tab lässt es weg,
// siehe reise/index.tsx) bleibt eine aufgedeckte Reise ohne jede Pille, ein
// Tipp dort führt in die Reise-Verwaltung, nicht in den Recap, «Recap
// ansehen» wäre ein Versprechen gewesen, das der Tipp nicht einlöst.
test('ohne alsRecap zeigt eine aufgedeckte Reise keine Pille', async () => {
  await wrap(<TripCard trip={{ ...trip, status: 'revealed' }} onPress={jest.fn()} />);
  expect(screen.queryByText('Recap ansehen')).toBeNull();
});

test('ohne alsRecap gilt das auch für eine archivierte Reise', async () => {
  await wrap(<TripCard trip={{ ...trip, status: 'archived' }} onPress={jest.fn()} />);
  expect(screen.queryByText('Recap ansehen')).toBeNull();
});

test('ein Moment wird im Singular gezählt', async () => {
  await wrap(<TripCard trip={{ ...trip, my_post_count: 1 }} onPress={jest.fn()} />);
  expect(screen.getByText('1 Moment')).toBeTruthy();
});

test('Antippen meldet die Reise zurück', async () => {
  const onPress = jest.fn();
  await wrap(<TripCard trip={trip} onPress={onPress} />);
  await fireEvent.press(screen.getByText('Norwegen mit dem Camper'));
  expect(onPress).toHaveBeenCalled();
});
