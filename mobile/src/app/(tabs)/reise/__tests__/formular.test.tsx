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
    data: {
      id: 't1', name: 'Norwegen', start_date: '2026-08-01', end_date: '2026-08-14',
      status: 'active', owner_id: 'u1',
      member_names: ['Lea'], member_count: 1, my_post_count: 0,
    },
    error: null,
  })),
}));

// Der Kalender spannt seinen Bereich um den heutigen Tag auf. Ohne festen Tag
// hinge jeder Test hier am Systemdatum und bräche, sobald der August 2026 aus
// dem Bereich läuft. Gezielt diese eine Funktion statt jest.useFakeTimers:
// Fake Timers griffen in Animated ein, und Sheet wie PressScale animieren.
jest.mock('@/features/trips/tripDay', () => ({
  ...jest.requireActual('@/features/trips/tripDay'),
  heutigerKalendertag: () => '2026-08-12',
}));

import NeueReise from '../neu';
import ReiseBearbeiten from '../[id]/bearbeiten';
import { createTrip, updateTrip, fetchTrip } from '@/features/trips/tripsApi';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

// Scoped auf die Zeile eines Felds (Label + Input + eigener Fehlertext), damit
// Tests prüfen können, an welchem Feld ein Fehler tatsächlich landet, nicht
// nur, dass sein Text irgendwo auf dem Screen steht.
const feldZeile = (labelText: string) => {
  const feld = screen.getByLabelText(labelText);
  return within(feld.parent!.parent!);
};

beforeEach(() => jest.clearAllMocks());

// Wählt einen Zeitraum über das Sheet: zwei Tipps plus «Übernehmen», genau wie
// ein Nutzer es täte. Seit der Umstellung auf den Kalender gibt es keinen
// Textpfad mehr, den ein Test abkürzen könnte.
const zeitraumWaehlen = async (vonLabel: string, bisLabel: string) => {
  await fireEvent.press(screen.getByLabelText('Zeitraum, noch nichts gewählt'));
  await fireEvent.press(screen.getByLabelText(vonLabel));
  await fireEvent.press(screen.getByLabelText(bisLabel));
  await fireEvent.press(screen.getByLabelText('Übernehmen'));
};

test('leerer Name wird abgefangen', async () => {
  await wrap(<NeueReise />);
  await zeitraumWaehlen('1. August 2026', '14. August 2026');
  await fireEvent.press(screen.getByText('Reise anlegen'));
  expect(await screen.findByText('Gib deiner Reise einen Namen.')).toBeTruthy();
  expect(createTrip).not.toHaveBeenCalled();
});

test('fehlender Zeitraum wird am Zeitraum-Feld gemeldet', async () => {
  await wrap(<NeueReise />);
  await fireEvent.changeText(screen.getByLabelText('Name der Reise'), 'Norwegen');
  await fireEvent.press(screen.getByText('Reise anlegen'));
  expect(await screen.findByText('Trag den Zeitraum ein.')).toBeTruthy();
  expect(createTrip).not.toHaveBeenCalled();
});

test('gültige Eingabe legt an und führt zum Einladen', async () => {
  await wrap(<NeueReise />);
  await fireEvent.changeText(screen.getByLabelText('Name der Reise'), 'Norwegen');
  await zeitraumWaehlen('1. August 2026', '14. August 2026');
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
  expect(await screen.findByText('1.–14. Aug 2026')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Name der Reise'), 'Norwegen 2026');
  await fireEvent.press(screen.getByText('Speichern'));
  await waitFor(() =>
    expect(updateTrip).toHaveBeenCalledWith('t1', {
      name: 'Norwegen 2026', startDate: '2026-08-01', endDate: '2026-08-14',
    })
  );
});

// === Bearbeiten: Lesefehler und Speicherfehler sind zweierlei ===

test('bearbeiten: Lesefehler zeigt den Fehler statt eines leeren Formulars', async () => {
  (fetchTrip as jest.Mock).mockResolvedValueOnce({ data: null, error: 'Du bist gerade offline.' });
  await wrap(<ReiseBearbeiten />);
  expect(await screen.findByText('Du bist gerade offline.')).toBeTruthy();
  // Vorher stand hier ein leeres Formular, es sah aus wie eine Reise ohne
  // Namen, nicht wie ein Fehler beim Lesen.
  expect(screen.queryByLabelText('Name der Reise')).toBeNull();
  expect(screen.getByText('Nochmal versuchen')).toBeTruthy();
});

test('bearbeiten: nach «Nochmal versuchen» steht das Formular', async () => {
  (fetchTrip as jest.Mock).mockResolvedValueOnce({ data: null, error: 'Du bist gerade offline.' });
  await wrap(<ReiseBearbeiten />);
  await fireEvent.press(await screen.findByText('Nochmal versuchen'));
  await waitFor(() => expect(screen.getByLabelText('Name der Reise').props.value).toBe('Norwegen'));
});

test('bearbeiten: ein Speicherfehler landet nicht im Namensfeld', async () => {
  (updateTrip as jest.Mock).mockResolvedValueOnce({
    error: 'Die Reise konnte nicht gespeichert werden. Probier es gleich nochmal.',
  });
  await wrap(<ReiseBearbeiten />);
  await waitFor(() => expect(screen.getByLabelText('Name der Reise').props.value).toBe('Norwegen'));
  await fireEvent.press(screen.getByText('Speichern'));
  expect(await screen.findByText(/nicht gespeichert werden/)).toBeTruthy();
  expect(feldZeile('Name der Reise').queryByText(/nicht gespeichert werden/)).toBeNull();
});
