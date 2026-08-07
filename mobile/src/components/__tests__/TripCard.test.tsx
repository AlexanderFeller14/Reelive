import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
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
  await wrap(<TripCard trip={trip} onPress={jest.fn()} />);
  // Avatar trägt bis zum Bild-Upload die Initiale
  expect(screen.getByText('L')).toBeTruthy();
  expect(screen.getByText('M')).toBeTruthy();
  expect(screen.getByText('J')).toBeTruthy();
  expect(screen.getByText('S')).toBeTruthy();
});

test('ab dem fünften Mitreisenden zählt die Gruppe weiter', async () => {
  await wrap(
    <TripCard trip={{ ...trip, member_names: ['Lea', 'Mira', 'Jonas', 'Sofia', 'Ben', 'Nora'] }} onPress={jest.fn()} />
  );
  expect(screen.getByText('+2')).toBeTruthy();
});

test('laufende Reise trägt die Versiegelt-Pille', async () => {
  await wrap(<TripCard trip={trip} onPress={jest.fn()} />);
  expect(screen.getByText('Versiegelt')).toBeTruthy();
});

test('aufgedeckte Reise trägt sie nicht', async () => {
  await wrap(<TripCard trip={{ ...trip, status: 'revealed' }} onPress={jest.fn()} />);
  expect(screen.queryByText('Versiegelt')).toBeNull();
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
