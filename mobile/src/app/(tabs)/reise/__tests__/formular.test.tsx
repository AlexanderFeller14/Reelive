import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 't1' }),
}));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ userId: 'u1' }) }));
jest.mock('@/features/trips/tripsApi', () => ({
  createTrip: jest.fn(async () => ({ id: 'neu-1', error: null })),
  updateTrip: jest.fn(async () => ({ error: null })),
  fetchTrip: jest.fn(async () => ({
    id: 't1', name: 'Norwegen', start_date: '2026-08-01', end_date: '2026-08-14',
    status: 'active', owner_id: 'u1',
    member_names: ['Lea'], member_count: 1, my_post_count: 0,
  })),
}));

import NeueReise from '../neu';
import ReiseBearbeiten from '../[id]/bearbeiten';
import { createTrip, updateTrip } from '@/features/trips/tripsApi';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

// Scoped auf die Zeile eines Felds (Label + Input + eigener Fehlertext), damit
// Tests prüfen können, an welchem Feld ein Fehler tatsächlich landet — nicht
// nur, dass sein Text irgendwo auf dem Screen steht.
const feldZeile = (labelText: string) => {
  const feld = screen.getByLabelText(labelText);
  return within(feld.parent!.parent!);
};

beforeEach(() => jest.clearAllMocks());

test('leerer Name wird abgefangen', async () => {
  await wrap(<NeueReise />);
  await fireEvent.changeText(screen.getByLabelText('Beginn'), '01.08.2026');
  await fireEvent.changeText(screen.getByLabelText('Ende'), '14.08.2026');
  await fireEvent.press(screen.getByText('Reise anlegen'));
  expect(await screen.findByText('Gib deiner Reise einen Namen.')).toBeTruthy();
  expect(createTrip).not.toHaveBeenCalled();
});

test('Ende vor Beginn wird abgefangen — Fehler landet am Ende-Feld', async () => {
  await wrap(<NeueReise />);
  await fireEvent.changeText(screen.getByLabelText('Name der Reise'), 'Norwegen');
  await fireEvent.changeText(screen.getByLabelText('Beginn'), '14.08.2026');
  await fireEvent.changeText(screen.getByLabelText('Ende'), '01.08.2026');
  await fireEvent.press(screen.getByText('Reise anlegen'));
  const meldung = 'Das Ende darf nicht vor dem Beginn liegen.';
  expect(await feldZeile('Ende').findByText(meldung)).toBeTruthy();
  expect(feldZeile('Beginn').queryByText(meldung)).toBeNull();
  expect(createTrip).not.toHaveBeenCalled();
});

test('unlesbares Datum wird dem betroffenen Feld zugeordnet', async () => {
  await wrap(<NeueReise />);
  await fireEvent.changeText(screen.getByLabelText('Name der Reise'), 'Norwegen');
  await fireEvent.changeText(screen.getByLabelText('Beginn'), '32.13.2026');
  await fireEvent.changeText(screen.getByLabelText('Ende'), '14.08.2026');
  await fireEvent.press(screen.getByText('Reise anlegen'));
  const meldung = 'Trag den Beginn ein, z.B. 01.08.2026.';
  expect(await feldZeile('Beginn').findByText(meldung)).toBeTruthy();
  expect(feldZeile('Ende').queryByText(meldung)).toBeNull();
  expect(createTrip).not.toHaveBeenCalled();
});

test('gültige Eingabe legt an und führt zum Einladen', async () => {
  await wrap(<NeueReise />);
  await fireEvent.changeText(screen.getByLabelText('Name der Reise'), 'Norwegen');
  await fireEvent.changeText(screen.getByLabelText('Beginn'), '01.08.2026');
  await fireEvent.changeText(screen.getByLabelText('Ende'), '14.08.2026');
  await fireEvent.press(screen.getByText('Reise anlegen'));
  await waitFor(() =>
    expect(createTrip).toHaveBeenCalledWith({
      name: 'Norwegen', startDate: '2026-08-01', endDate: '2026-08-14', ownerId: 'u1',
    })
  );
  expect(mockReplace).toHaveBeenCalledWith('/reise/neu-1/einladen');
});

test('Bearbeiten kommt mit vorbelegten Werten und speichert', async () => {
  await wrap(<ReiseBearbeiten />);
  expect(await screen.findByDisplayValue('Norwegen')).toBeTruthy();
  expect(screen.getByDisplayValue('01.08.2026')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Name der Reise'), 'Norwegen 2026');
  await fireEvent.press(screen.getByText('Speichern'));
  await waitFor(() =>
    expect(updateTrip).toHaveBeenCalledWith('t1', {
      name: 'Norwegen 2026', startDate: '2026-08-01', endDate: '2026-08-14',
    })
  );
});
