import { Alert, StyleSheet } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { palette } from '@/theme/tokens';

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
// Task 10: der Zähler kommt aus eigenerZaehler (Serverstand + wartende
// Momente), nicht mehr aus trip.my_post_count — siehe Test unten, der genau
// das absichert. Default deckungsgleich mit trip.my_post_count = 0, damit die
// bereits bestehenden Tests ohne eigene Erwartung an den Zähler unverändert
// grün bleiben.
jest.mock('@/features/moments/zaehler', () => ({ eigenerZaehler: jest.fn(async () => 0) }));
jest.mock('@/features/moments/queueDb', () => ({
  alleJobs: jest.fn(async () => []),
  // Final-Review, Important 9: dauerhaft verworfene Momente werden festgehalten
  // und hier erklärt, statt wortlos zu verschwinden.
  verworfene: jest.fn(async () => []),
  verworfeneQuittieren: jest.fn(async () => {}),
}));
// Task 8: «Reise abschliessen» ruft revealTrip auf (Task 5). Echtes recapApi
// importiert @/lib/supabase (→ AsyncStorage-Nativmodul, in Jest nicht
// vorhanden) — deshalb wie die übrigen Feature-Module vollständig gemockt.
jest.mock('@/features/recap/recapApi', () => ({ revealTrip: jest.fn() }));

import ReiseDetail from '../[id]/index';
import * as Haptics from 'expo-haptics';
import { fetchTrip, fetchMembers, removeMember, deleteTrip } from '@/features/trips/tripsApi';
import { eigenerZaehler } from '@/features/moments/zaehler';
import * as queueDb from '@/features/moments/queueDb';
import { revealTrip } from '@/features/recap/recapApi';

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
const keineVerworfenen: never[] = [];
const VERWORFEN_GRUND =
  'Dieser Moment wurde nach der Aufdeckung der Reise aufgenommen und kann nicht mehr eingesendet werden.';
const einVerworfener = [
  { id: 'p9', trip_id: 't1', author_id: 'u1', grund: VERWORFEN_GRUND, verworfen_am: 1 },
];

// Task 8: «Reise abschliessen» rückt ab dem Enddatum nach oben. Relativ zum
// echten heutigen Datum berechnet statt eines fixen Literals wie beim
// `trip`-Fixture oben — sonst würde dieser Test brüchig, sobald das echte
// Datum irgendwann den 14.08.2026 überschreitet.
const HEUTE = new Date().toISOString().slice(0, 10);
function inTagen(tage: number): string {
  return new Date(Date.now() + tage * 86_400_000).toISOString().slice(0, 10);
}
const tripVorEnde = { ...trip, end_date: inTagen(30) };
const tripVorEndeOk = { data: tripVorEnde, error: null };
const tripAmEnde = { ...trip, end_date: HEUTE };
const tripAmEndeOk = { data: tripAmEnde, error: null };
// Stabile Referenz für den Nachlade-Test unten (siehe Kommentar dort).
const tripRevealed = { ...trip, status: 'revealed' as const };
const tripRevealedOk = { data: tripRevealed, error: null };

const wrap = () => render(<ThemeProvider><ReiseDetail /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.userId = 'u1';
  (fetchTrip as jest.Mock).mockResolvedValue(tripOk);
  (fetchMembers as jest.Mock).mockResolvedValue(mitgliederOk);
  (eigenerZaehler as jest.Mock).mockResolvedValue(0);
  (revealTrip as jest.Mock).mockResolvedValue({ revealed_at: '2026-08-08T00:00:00Z', error: null });
  (queueDb.alleJobs as jest.Mock).mockResolvedValue([]);
  (queueDb.verworfene as jest.Mock).mockResolvedValue(keineVerworfenen);
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

// Task 10: der grosse Zähler zählt den Serverstand PLUS wartende Momente
// derselben Reise — er darf nach einer Offline-Aufnahme nie beim reinen
// Serverstand (hier bewusst 0 im Trip-Fixture) stehen bleiben.
test('der Zähler kommt aus eigenerZaehler, nicht aus dem rohen Serverstand', async () => {
  (eigenerZaehler as jest.Mock).mockResolvedValue(7);
  await wrap();
  expect(await screen.findByText('7')).toBeTruthy();
  expect(screen.queryByText('0')).toBeNull();
  expect(eigenerZaehler).toHaveBeenCalledWith('t1');
});

test('eine leere Warteschlange zeigt keine Warten-Zeile', async () => {
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByText(/unterwegs/)).toBeNull();
});

test('wartende Momente dieser Reise werden dezent gemeldet', async () => {
  (queueDb.alleJobs as jest.Mock).mockResolvedValue([
    { trip_id: 't1', zustand: 'wartet' },
    { trip_id: 't1', zustand: 'laeuft' },
    { trip_id: 't1', zustand: 'fertig' },
    { trip_id: 't2', zustand: 'wartet' },
  ]);
  await wrap();
  expect(await screen.findByText('2 Momente sind noch unterwegs.')).toBeTruthy();
});

test('ein einzelner wartender Moment wird im Singular gemeldet', async () => {
  (queueDb.alleJobs as jest.Mock).mockResolvedValue([{ trip_id: 't1', zustand: 'wartet' }]);
  await wrap();
  expect(await screen.findByText('1 Moment ist noch unterwegs.')).toBeTruthy();
});

// Fix-Runde 1: eigenerZaehler/queueDb.alleJobs lesen anders als fetchTrip/
// fetchMembers aus der lokalen SQLite-Warteschlange und können werfen (siehe
// queueDb.ts). Vorher lag das im selben Promise.all wie fetchTrip/fetchMembers
// — eine Ablehnung liess `geladen` nie `true` werden, der Screen blieb ohne
// jede Meldung leer. Beide Fälle einzeln nachgestellt.
test('eigenerZaehler schlägt fehl: die Reise erscheint trotzdem mit dem Serverstand', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, my_post_count: 3 }, error: null });
  (eigenerZaehler as jest.Mock).mockRejectedValue(new Error('SQLite kaputt'));
  await wrap();
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
  expect(screen.queryByText(/unterwegs/)).toBeNull();
});

test('queueDb.alleJobs schlägt fehl: die Reise erscheint trotzdem, nur ohne Warten-Zeile', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, my_post_count: 3 }, error: null });
  (queueDb.alleJobs as jest.Mock).mockRejectedValue(new Error('SQLite kaputt'));
  await wrap();
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.queryByText(/unterwegs/)).toBeNull();
});

// === Final-Review, Important 9 ===
// Spec §8 verspricht, ein nach dem Reveal aufgenommener Moment werde «mit
// Erklärung verworfen». Tatsächlich löschte der Worker den Job und schrieb eine
// Konsolenzeile — die betroffene Person erfuhr nie, dass ihre Aufnahme weg ist.
test('ein dauerhaft verworfener Moment wird mit seiner Ursache erklärt', async () => {
  (queueDb.verworfene as jest.Mock).mockResolvedValue(einVerworfener);
  await wrap();

  expect(await screen.findByText('Ein Moment konnte nicht mehr eingesendet werden')).toBeTruthy();
  expect(screen.getByText(VERWORFEN_GRUND)).toBeTruthy();
  expect(queueDb.verworfene).toHaveBeenCalledWith('t1', 'u1');
});

test('die Erklärung verschwindet erst, wenn sie quittiert wurde', async () => {
  (queueDb.verworfene as jest.Mock).mockResolvedValue(einVerworfener);
  // Der echte Speicher löscht beim Quittieren — der Doppelgänger zieht nach,
  // sonst brächte der nächste Fokus-Lauf die Meldung sofort zurück.
  (queueDb.verworfeneQuittieren as jest.Mock).mockImplementation(() => {
    (queueDb.verworfene as jest.Mock).mockResolvedValue(keineVerworfenen);
    return Promise.resolve();
  });
  await wrap();
  await screen.findByText('Ein Moment konnte nicht mehr eingesendet werden');

  await fireEvent.press(screen.getByText('Verstanden'));

  await waitFor(() =>
    expect(screen.queryByText('Ein Moment konnte nicht mehr eingesendet werden')).toBeNull()
  );
  expect(queueDb.verworfeneQuittieren).toHaveBeenCalledWith('t1', 'u1');
});

test('ohne verworfene Momente steht dort nichts', async () => {
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByText(/konnte nicht mehr eingesendet werden/)).toBeNull();
});

// Gleicher Grund wie bei alleJobs: eine beschädigte lokale Datenbank darf den
// Screen nicht leer stehen lassen.
test('queueDb.verworfene schlägt fehl: die Reise erscheint trotzdem', async () => {
  (queueDb.verworfene as jest.Mock).mockRejectedValue(new Error('SQLite kaputt'));
  await wrap();
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
});

// === Task 8: «Reise abschliessen» ===

test('Reise abschliessen fehlt für Mitglieder ohne Owner-Rolle', async () => {
  mockAuth.userId = 'u2';
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByText('Reise abschliessen')).toBeNull();
});

test('Reise abschliessen fehlt bei bereits aufgedeckter Reise', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, status: 'revealed' }, error: null });
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByText('Reise abschliessen')).toBeNull();
});

test('vor dem Enddatum steht der Knopf unten, ohne ankündigende Zeile', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripVorEndeOk);
  await wrap();
  expect(await screen.findByText('Reise abschliessen')).toBeTruthy();
  expect(screen.queryByText('Eure Reise ist zu Ende. Zeit für den Recap.')).toBeNull();
});

test('ab dem Enddatum rückt der Knopf nach oben, mit ankündigender Zeile', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripAmEndeOk);
  await wrap();
  expect(await screen.findByText('Eure Reise ist zu Ende. Zeit für den Recap.')).toBeTruthy();
  // getByText wirft bei mehr als einem Treffer — das sichert zugleich, dass
  // der Knopf nicht gleichzeitig oben UND unten steht.
  expect(screen.getByText('Reise abschliessen')).toBeTruthy();
});

test('«Freunde einladen» ist Sekundär-Button — «Reise abschliessen» bleibt der einzige Primär-Button (DESIGN-LANGUAGE §7)', async () => {
  await wrap();
  const label = await screen.findByText('Freunde einladen');
  const flattened = StyleSheet.flatten(label.parent?.props.style);
  expect(flattened.borderWidth).toBe(1);
  expect(flattened.backgroundColor).toBe(palette['bg-0']);
});

test('«Reise abschliessen» trägt die Akzent-Fläche des Primär-Buttons', async () => {
  await wrap();
  const label = await screen.findByText('Reise abschliessen');
  const flattened = StyleSheet.flatten(label.parent?.props.style);
  expect(flattened.backgroundColor).toBe(palette.accent);
});

test('Tippen auf «Reise abschliessen» öffnet das Bestätigungs-Sheet und löst warning-Haptik aus', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  expect(await screen.findByText('Reise abschliessen?')).toBeTruthy();
  expect(
    screen.getByText(/Danach kann niemand mehr Momente einsenden.*rückgängig machen\./)
  ).toBeTruthy();
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
});

test('Sheet zeigt die Wartenden-Zeile nicht, wenn keine Momente warten', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  await screen.findByText('Reise abschliessen?');
  expect(screen.queryByText(/kommen noch durch/)).toBeNull();
  expect(screen.queryByText(/kommt noch durch/)).toBeNull();
});

test('Sheet zeigt die Wartenden-Zeile im Plural, wenn mehrere Momente warten', async () => {
  (queueDb.alleJobs as jest.Mock).mockResolvedValue([
    { trip_id: 't1', zustand: 'wartet' },
    { trip_id: 't1', zustand: 'wartet' },
    { trip_id: 't1', zustand: 'wartet' },
  ]);
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  expect(
    await screen.findByText('Deine 3 wartenden Momente kommen noch durch — sie sind vor dem Reveal entstanden.')
  ).toBeTruthy();
});

test('Sheet zeigt die Wartenden-Zeile im Singular, wenn genau ein Moment wartet', async () => {
  (queueDb.alleJobs as jest.Mock).mockResolvedValue([{ trip_id: 't1', zustand: 'wartet' }]);
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  expect(
    await screen.findByText('Dein 1 wartender Moment kommt noch durch — er ist vor dem Reveal entstanden.')
  ).toBeTruthy();
});

test('Abbrechen schliesst das Sheet, ohne revealTrip aufzurufen', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  await screen.findByText('Reise abschliessen?');
  await fireEvent.press(screen.getByText('Abbrechen'));
  await waitFor(() => expect(screen.queryByText('Reise abschliessen?')).toBeNull());
  expect(revealTrip).not.toHaveBeenCalled();
});

test('Tippen auf den Hintergrund schliesst das Bestätigungs-Sheet', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  await screen.findByText('Reise abschliessen?');
  await fireEvent.press(screen.getByTestId('sheet-backdrop'));
  await waitFor(() => expect(screen.queryByText('Reise abschliessen?')).toBeNull());
});

test('Abschliessen ruft revealTrip auf; bei Erfolg schliesst das Sheet und lädt die Reise neu', async () => {
  // Stabile Referenz für den Zustand «nach dem Reveal» (siehe Kommentar bei
  // tripRevealedOk oben) — sonst würde jeder erneute Ladeversuch (der
  // useFocusEffect-Mock feuert bei jedem Render nach) ein frisches Objekt
  // liefern und den Screen endlos weiterrendern lassen.
  let aufgedeckt = false;
  (fetchTrip as jest.Mock).mockImplementation(async () => (aufgedeckt ? tripRevealedOk : tripOk));
  (revealTrip as jest.Mock).mockImplementation(async () => {
    aufgedeckt = true;
    return { revealed_at: '2026-08-08T00:00:00Z', error: null };
  });
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  await screen.findByText('Reise abschliessen?');

  await fireEvent.press(screen.getByText('Abschliessen'));

  await waitFor(() => expect(revealTrip).toHaveBeenCalledWith('t1'));
  await waitFor(() => expect(screen.queryByText('Reise abschliessen?')).toBeNull());
  // Reise neu geladen: status ist jetzt 'revealed', der Knopf verschwindet.
  await waitFor(() => expect(screen.queryByText('Reise abschliessen')).toBeNull());
});

test('ein Fehler beim Abschliessen zeigt die Ursache und lässt den Knopf bedienbar (idempotent)', async () => {
  (revealTrip as jest.Mock).mockResolvedValue({
    revealed_at: null,
    error: 'Die Reise konnte nicht abgeschlossen werden. Probier es gleich nochmal.',
  });
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  await screen.findByText('Reise abschliessen?');

  await fireEvent.press(screen.getByText('Abschliessen'));
  await waitFor(() => expect(revealTrip).toHaveBeenCalledTimes(1));
  expect(
    await screen.findByText('Die Reise konnte nicht abgeschlossen werden. Probier es gleich nochmal.')
  ).toBeTruthy();
  // Sheet bleibt offen, der Knopf bleibt bedienbar — ein zweiter Versuch ist
  // immer erlaubt, weil die Function idempotent ist (Task-8-Brief).
  expect(screen.getByText('Reise abschliessen?')).toBeTruthy();
  await fireEvent.press(screen.getByText('Abschliessen'));
  await waitFor(() => expect(revealTrip).toHaveBeenCalledTimes(2));
});
