import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

jest.mock('../AuthProvider', () => ({
  useAuth: () => ({ status: 'signedIn', userId: 'uid-1', refreshProfile: jest.fn() }),
}));
jest.mock('../profileApi', () => ({
  fetchOwnProfile: jest.fn(async () => ({ id: 'uid-1', username: 'lea', display_name: 'Lea' })),
}));
const mockSignOut = jest.fn();
jest.mock('../authApi', () => ({ signOut: () => mockSignOut() }));

// expo-image ist ein natives View, im Test reicht ein Platzhalter, der alle
// Props durchreicht (gleiches Muster wie recap/__tests__/liste.test.tsx). Ohne
// Mock scheitert schon der Import, expo-image/src/observe.ts erwartet eine
// native Umgebung.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

// Task 9: kontoApi importiert transitiv @/lib/supabase (→ AsyncStorage-
// Nativmodul, in Jest nicht vorhanden, auch über jest.requireActual nicht
// umgehbar, der Import steht am Modulkopf), deshalb wie die übrigen
// Feature-Module vollständig gemockt. `zahlenText` bekommt hier eine simple,
// vorhersagbare Fassung statt der echten Wortwahl, die echte Formulierung
// (Singular/Plural, "3 Reisen mit insgesamt 128 Momenten…") ist bereits in
// features/konto/__tests__/kontoApi.test.ts vollständig abgedeckt; hier
// zählt nur, DASS profil.tsx das Ergebnis von zahlenText tatsächlich anzeigt.
const mockHoleLoeschZahlen = jest.fn();
const mockLoescheKonto = jest.fn();
jest.mock('@/features/konto/kontoApi', () => ({
  holeLoeschZahlen: () => mockHoleLoeschZahlen(),
  loescheKonto: () => mockLoescheKonto(),
  zahlenText: (z: { eigene_reisen: number }) => `ZAHLEN-TEXT (${z.eigene_reisen} Reisen)`,
}));

// Task 10: der WLAN-Schalter liest/schreibt über das Einstellungen-Modul.
// Default "aus", passend zum dokumentierten Standard in einstellungen.ts.
const mockNurUeberWlan = jest.fn(async () => false);
const mockSetzeNurUeberWlan = jest.fn(async (_wert: boolean) => {});
jest.mock('@/features/moments/einstellungen', () => ({
  nurUeberWlan: () => mockNurUeberWlan(),
  setzeNurUeberWlan: (wert: boolean) => mockSetzeNurUeberWlan(wert),
}));

// Pfad-Anpassung (Task-10-Kontext, Abweichung 2): Router-Root ist mobile/src/app/,
// nicht mobile/app/, von __tests__/ drei Ebenen hoch zu app/(tabs)/...
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

test('zeigt das Reisepass-Bild über dem Namen, stumm für Screenreader', async () => {
  await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
  await screen.findByText('Lea');
  // Dekoration: das Bild sagt nichts, was der Name darunter nicht schon sagt.
  expect(screen.getByTestId('profil-reisepass').props.accessible).toBe(false);
  // «oben» heisst: VOR der Namens-Karte im Baum, nicht bloss irgendwo auf dem
  // Screen. Der serialisierte Baum bildet die Reihenfolge der Geschwister ab,
  // «@lea» kommt darin nur in der Namens-Karte vor.
  const baum = JSON.stringify(screen.toJSON());
  expect(baum.indexOf('profil-reisepass')).toBeLessThan(baum.indexOf('@lea'));
});

test('zeigt den WLAN-Schalter mit Erklärung, was er bewirkt', async () => {
  await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
  expect(await screen.findByText('Nur über WLAN einsenden')).toBeTruthy();
  expect(
    screen.getByText('Spart mobile Daten. Deine Momente warten, bis du wieder im WLAN bist.')
  ).toBeTruthy();
  expect(screen.getByLabelText('Nur über WLAN einsenden').props.value).toBe(false);
});

test('ein Tipp auf den Schalter schreibt die Wahl in die Einstellungen', async () => {
  await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
  const schalter = await screen.findByLabelText('Nur über WLAN einsenden');
  await fireEvent(schalter, 'valueChange', true);
  expect(mockSetzeNurUeberWlan).toHaveBeenCalledWith(true);
  expect(screen.getByLabelText('Nur über WLAN einsenden').props.value).toBe(true);
});

test('ein bereits gespeichertes „Nur über WLAN" zeigt sich beim Öffnen', async () => {
  mockNurUeberWlan.mockResolvedValue(true);
  await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
  await waitFor(() => expect(screen.getByLabelText('Nur über WLAN einsenden').props.value).toBe(true));
});

// Task 9: Konto-Löschung. Fixzahlen, deckungsgleich mit dem Brief-Beispiel
// ("3 Reisen mit insgesamt 128 Momenten von 5 Personen").
const ZAHLEN_OK = {
  data: { eigene_reisen: 3, momente_in_eigenen_reisen: 128, betroffene_personen: 5, eigene_momente_anderswo: 0 },
  error: null,
};
const ZAHLEN_LEER = {
  data: { eigene_reisen: 0, momente_in_eigenen_reisen: 0, betroffene_personen: 0, eigene_momente_anderswo: 0 },
  error: null,
};

describe('Konto löschen (Task 9)', () => {
  test('steht unten, unter allem anderen, nach dem Abmelden-Knopf', async () => {
    await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
    await screen.findByText('Lea');
    expect(screen.getByTestId('konto-loeschen-oeffnen')).toBeTruthy();
    expect(screen.getByText('Konto löschen')).toBeTruthy();
  });

  test('Tippen öffnet den Dialog und lädt sofort die Zahlen', async () => {
    mockHoleLoeschZahlen.mockResolvedValue(ZAHLEN_OK);
    await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('konto-loeschen-oeffnen'));
    expect(mockHoleLoeschZahlen).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('ZAHLEN-TEXT (3 Reisen)')).toBeTruthy();
  });

  // Der Kern des Auftrags: "Ohne geladene Zahlen darf nicht bestätigt werden
  // können.", solange holeLoeschZahlen noch nicht geantwortet hat, gibt es
  // den Bestätigungsknopf im Baum schlicht nicht (kein blosses `disabled`).
  test('ohne geladene Zahlen gibt es KEINEN Bestätigungsknopf, nur einen Ladeindikator', async () => {
    mockHoleLoeschZahlen.mockReturnValue(new Promise(() => {})); // hängt absichtlich
    await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('konto-loeschen-oeffnen'));
    expect(await screen.findByTestId('loeschen-zahlen-laedt')).toBeTruthy();
    expect(screen.queryByTestId('konto-endgueltig-loeschen')).toBeNull();
  });

  test('ein Fehler beim Laden zeigt die Ursache mit Retry, keinen Bestätigungsknopf', async () => {
    mockHoleLoeschZahlen.mockResolvedValue({ data: null, error: 'kaputt' });
    await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('konto-loeschen-oeffnen'));
    expect(await screen.findByText('kaputt')).toBeTruthy();
    expect(screen.queryByTestId('konto-endgueltig-loeschen')).toBeNull();
    expect(screen.getByText('Nochmal versuchen')).toBeTruthy();
  });

  test('«Nochmal versuchen» lädt die Zahlen erneut, danach erscheint der Bestätigungsknopf', async () => {
    mockHoleLoeschZahlen
      .mockResolvedValueOnce({ data: null, error: 'kaputt' })
      .mockResolvedValueOnce(ZAHLEN_LEER);
    await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('konto-loeschen-oeffnen'));
    await screen.findByText('kaputt');
    await fireEvent.press(screen.getByText('Nochmal versuchen'));
    expect(await screen.findByTestId('konto-endgueltig-loeschen')).toBeTruthy();
    expect(mockHoleLoeschZahlen).toHaveBeenCalledTimes(2);
  });

  test('Erfolg: löscht das Konto und meldet danach ab', async () => {
    mockHoleLoeschZahlen.mockResolvedValue(ZAHLEN_LEER);
    mockLoescheKonto.mockResolvedValue({ error: null });
    await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('konto-loeschen-oeffnen'));
    await fireEvent.press(await screen.findByTestId('konto-endgueltig-loeschen'));
    await waitFor(() => expect(mockLoescheKonto).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
  });

  test('ein Fehlschlag beim Löschen zeigt die Ursache, meldet NICHT ab, der Dialog bleibt bedienbar', async () => {
    mockHoleLoeschZahlen.mockResolvedValue(ZAHLEN_LEER);
    mockLoescheKonto.mockResolvedValue({
      error: 'Dein Konto konnte nicht vollständig gelöscht werden. Probier es später noch einmal.',
    });
    await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('konto-loeschen-oeffnen'));
    await fireEvent.press(await screen.findByTestId('konto-endgueltig-loeschen'));
    expect(
      await screen.findByText('Dein Konto konnte nicht vollständig gelöscht werden. Probier es später noch einmal.')
    ).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(screen.getByTestId('konto-endgueltig-loeschen').props.accessibilityState.disabled).toBe(false);
  });

  test('ein zweiter Tipp, während die Löschung noch läuft, löst KEINEN zweiten Aufruf aus', async () => {
    mockHoleLoeschZahlen.mockResolvedValue(ZAHLEN_LEER);
    let aufloesen!: (wert: { error: null }) => void;
    mockLoescheKonto.mockReturnValue(new Promise((resolve) => { aufloesen = resolve; }));
    await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('konto-loeschen-oeffnen'));
    await fireEvent.press(await screen.findByTestId('konto-endgueltig-loeschen'));
    expect(await screen.findByTestId('konto-loeschen-laeuft')).toBeTruthy(); // Spinner statt Text
    await fireEvent.press(screen.getByTestId('konto-endgueltig-loeschen'));
    await act(async () => {
      aufloesen({ error: null });
    });
    expect(mockLoescheKonto).toHaveBeenCalledTimes(1);
  });

  test('«Abbrechen» schliesst den Dialog, ohne zu löschen oder abzumelden', async () => {
    mockHoleLoeschZahlen.mockResolvedValue(ZAHLEN_LEER);
    await render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByTestId('konto-loeschen-oeffnen'));
    await screen.findByTestId('konto-endgueltig-loeschen');
    await fireEvent.press(screen.getByText('Abbrechen'));
    expect(screen.queryByTestId('konto-endgueltig-loeschen')).toBeNull();
    expect(mockLoescheKonto).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});
