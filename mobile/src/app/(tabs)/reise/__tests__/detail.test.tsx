import { Alert, StyleSheet } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { palette } from '@/theme/tokens';

const mockPush = jest.fn();
const mockReplace = jest.fn();
// Review Important 3 (Task 8): `(cb) => cb()` feuerte bei JEDEM Render statt
// nur beim Fokussieren/bei geänderter Callback-Referenz, überlebte bislang
// nur, weil jeder verwendete Mock stabile Objektreferenzen zurückgab. Das
// verdeckte statt reparierte die eigentliche Lücke: `void laden()` aus dem
// Erfolgspfad von `abschliessen()` löschen blieb unbemerkt grün, weil
// ohnehin ständig neu geladen wurde. `useEffect(cb, [cb])` reproduziert die
// echte Semantik von useFocusEffect exakt, der Screen memoisiert seinen
// Callback bereits mit `useCallback([laden])`, der Effekt läuft also einmal
// beim Mount und erneut nur, wenn sich `id`/`userId` ändern. `require('react')`
// statt eines Top-Level-Imports, weil jest.mock()-Factories laut
// babel-plugin-jest-hoist keine Variablen aus dem Modul-Scope referenzieren
// dürfen, `mockRouteId` ist erlaubt, weil der Name mit "mock" beginnt.
//
// Review Important 3 (Task 9): `mockRouteId` statt eines festen `'t1'`,
// sonst bliebe unbemerkt, wenn `zumRecap()` die Reise-Kennung fest verdrahtet
// statt der tatsächlichen `id` zu verwenden (alle Fixtures heissen `t1`,
// eine hartkodierte Zeichenkette wäre unterschiedslos "richtig" gewesen).
let mockRouteId = 't1';
// Der Platz der angetippten Karte, den die Liste als `cover` mitgibt. Wie in
// der App eine Zeichenkette, Routen-Parameter sind nie Zahlen.
let mockRouteCover: string | undefined;
// Zählt die Fokus-Zyklen. Ein echter Screen wird nicht nur einmal fokussiert:
// wer ihn verlässt und zurückkehrt, löst `laden()` erneut aus, samt Cleanup
// (`aktiv.current = false`) des vorigen Laufs. `erneutFokussieren()` unten
// stellt genau das nach, indem es den Zähler hochdreht und neu rendert, das
// ändert die Effekt-Abhängigkeiten und lässt den Effekt ein zweites Mal
// laufen. Bis zur Facepile brauchte kein Test das, weil das Entfernen-X
// direkt im Screen stand und nebenbei einen zweiten laden()-Aufruf lieferte.
let mockFokusZyklus = 0;
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
    useLocalSearchParams: () => ({ id: mockRouteId, cover: mockRouteCover }),
    useFocusEffect: (cb: () => void) => useEffect(cb, [cb, mockFokusZyklus]),
  };
});

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
// Momente), nicht mehr aus trip.my_post_count, siehe Test unten, der genau
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
// vorhanden), deshalb wie die übrigen Feature-Module vollständig gemockt.
jest.mock('@/features/recap/recapApi', () => ({ revealTrip: jest.fn() }));
// Task 9: gesehen.ts ist eigens getestet (gesehen.test.ts), hier zählt nur,
// OB und WANN dieser Screen es aufruft, nicht wie es intern AsyncStorage
// benutzt.
jest.mock('@/features/recap/gesehen', () => ({
  revealGesehen: jest.fn(),
  merkeRevealGesehen: jest.fn(),
}));
// expo-image ist ein natives View, im Test reicht ein einfacher Platzhalter
// (gleiches Muster wie uebersicht.test.tsx), der alle Props durchreicht.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});
// Task 8, Phase 6: meldenApi hat ihre eigene, vollständige Testdatei
// (features/recap/__tests__/meldenApi.test.ts), hier nur Spione. urlVorrat
// liefert hier nur die Vorschau-Thumbnails für die Moderationsliste.
jest.mock('@/features/recap/meldenApi', () => ({
  fetchMeldungen: jest.fn(),
  verwirfMeldung: jest.fn(),
  entferneMoment: jest.fn(),
}));
// Nur die IO-Funktion wird gemockt. `wiederholenHilft` bleibt echt: sie ist
// die Regel, ob «Nochmal versuchen» ueberhaupt etwas ausrichten kann, und ein
// Mock davon liesse den Test genau die Zusicherung nicht mehr pruefen, um die
// es hier geht. `jest.requireActual` zieht dabei @/lib/supabase mit, deshalb
// steht dessen Mock daneben (gleiches Muster wie in player.test.tsx).
// `rpc` fuer `istRecapGeteilt` (features/teilen/linkVerwaltenApi.ts): der
// Screen fragt seit der Teilen-Benachrichtigung nach, ob der Recap gerade
// geteilt ist. Standard ist «nein», die Tests, die es anders brauchen, setzen
// `mockRpc` selbst.
const mockRpc = jest.fn<Promise<{ data: boolean | null; error: { message: string } | null }>, unknown[]>(
  async () => ({ data: false, error: null })
);
jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: jest.fn() },
    rpc: (...args: unknown[]) => mockRpc(...(args as [])),
  },
}));
jest.mock('@/features/recap/urlVorrat', () => ({
  ...jest.requireActual('@/features/recap/urlVorrat'),
  holeVorrat: jest.fn(),
}));
// Die Inszenierung selbst (Haptik, Timing, prefers-reduced-motion) ist in
// RevealInszenierung.test.tsx abgesichert. Hier steht ein steuerbarer
// Platzhalter: sichtbar rendert einen drückbaren Testknoten, ein Druck darauf
// simuliert «Inszenierung fertig» (onFertig), ohne echte Animated-Timer, die
// diese Datei (keine Fake-Timer) sonst 700–900 ms lang wirklich abwarten müsste.
jest.mock('@/components/RevealInszenierung', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    RevealInszenierung: ({ sichtbar, onFertig }: { sichtbar: boolean; onFertig: () => void }) =>
      sichtbar
        ? React.createElement(
            Pressable,
            { testID: 'reveal-inszenierung-fake', onPress: onFertig },
            React.createElement(Text, null, 'Inszenierung läuft')
          )
        : null,
  };
});

import ReiseDetail from '../[id]/index';
import * as Haptics from 'expo-haptics';
import { fetchTrip, fetchMembers, removeMember, deleteTrip } from '@/features/trips/tripsApi';
import { eigenerZaehler } from '@/features/moments/zaehler';
import * as queueDb from '@/features/moments/queueDb';
import { revealTrip } from '@/features/recap/recapApi';
import { revealGesehen, merkeRevealGesehen } from '@/features/recap/gesehen';
import { fetchMeldungen, verwirfMeldung, entferneMoment } from '@/features/recap/meldenApi';
import { holeVorrat } from '@/features/recap/urlVorrat';
import { platzhalterCover } from '@/features/trips/platzhalterCover';

const trip = {
  id: 't1', name: 'Norwegen mit dem Camper', start_date: '2026-08-01', end_date: '2026-08-14',
  status: 'active' as const, owner_id: 'u1',
  mitglieder: [
    { name: 'Lea', avatarKey: null },
    { name: 'Jonas', avatarKey: null },
  ],
  member_count: 2, my_post_count: 0,
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
// `trip`-Fixture oben, sonst würde dieser Test brüchig, sobald das echte
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

// Stellt einen erneuten Fokus DESSELBEN Screens nach: gleiche Komponenten-
// instanz, gleiche Refs, nur der Effekt läuft nochmal (siehe mockFokusZyklus).
// Ein zweites `render()` wäre ein neuer Mount und würde genau die Refs
// zurücksetzen, um die es in den Tests darunter geht.
async function erneutFokussieren() {
  mockFokusZyklus += 1;
  await screen.rerender(<ThemeProvider><ReiseDetail /></ThemeProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFokusZyklus = 0;
  // `clearAllMocks` nimmt auch die Standard-Implementierung mit, sie muss
  // deshalb hier wieder gesetzt werden, sonst liefert `rpc` undefined und
  // `istRecapGeteilt` meldete in JEDEM Test einen Fehler.
  mockRpc.mockResolvedValue({ data: false, error: null });
  mockAuth.userId = 'u1';
  mockRouteId = 't1';
  mockRouteCover = undefined;
  (fetchTrip as jest.Mock).mockResolvedValue(tripOk);
  (fetchMembers as jest.Mock).mockResolvedValue(mitgliederOk);
  (eigenerZaehler as jest.Mock).mockResolvedValue(0);
  (revealTrip as jest.Mock).mockResolvedValue({ revealed_at: '2026-08-08T00:00:00Z', error: null });
  (queueDb.alleJobs as jest.Mock).mockResolvedValue([]);
  (queueDb.verworfene as jest.Mock).mockResolvedValue(keineVerworfenen);
  // Default «schon gesehen»: die meisten bestehenden Tests in dieser Datei
  // beschäftigen sich nicht mit der Reveal-Inszenierung, mit `true` bleibt
  // ihr Bildschirm unverändert (sofort «Recap starten», kein Overlay davor).
  // Tests, die explizit die Inszenierung wollen, überschreiben das mit `false`.
  (revealGesehen as jest.Mock).mockResolvedValue(true);
  (merkeRevealGesehen as jest.Mock).mockResolvedValue(undefined);
  // Task 8, Phase 6: Default ohne offene Meldungen, die meisten bestehenden
  // Tests in dieser Datei beschäftigen sich nicht mit Moderation. Tests, die
  // das explizit wollen, überschreiben das mit eigenen Daten.
  (fetchMeldungen as jest.Mock).mockResolvedValue({ data: [], error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: { urls: new Map(), gueltigBis: 0, ausgelassen: 0 }, error: null, grund: null });
});

// Das Detail soll dasselbe Platzhalter-Cover tragen wie die Karte, auf die
// getippt wurde — sonst wechselt beim Öffnen scheinbar das Reiseziel. Die
// Liste gibt ihren Platz als `cover` mit, hier kommt er an.
test('zeigt das Cover der angetippten Karte', async () => {
  mockRouteCover = '1';
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.getByTestId('reise-cover').props.source).toBe(platzhalterCover(1));
});

// Deep Link oder gerade angelegte Reise: ohne den Parameter darf nichts
// kaputtgehen, es steht dann das erste Bild.
test('ohne cover-Parameter steht das erste Bild', async () => {
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.getByTestId('reise-cover').props.source).toBe(platzhalterCover(0));
});

test('zeigt Name und Zeitraum', async () => {
  await wrap();
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('1.–14. Aug 2026')).toBeTruthy();
});

// === Die Facepile unter dem Datum (Airbnb-Muster) ===
//
// Die Namen stehen NICHT mehr als Liste im Screen: das war eine Sektion mit
// einer Zeile pro Person zwischen Zähler und Aktionen. Oben steht jetzt eine
// Facepile, die Liste lebt im Sheet dahinter.

test('die Mitreisenden stehen als Facepile, nicht als Liste im Screen', async () => {
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  // Die Initialen der Facepile sind da …
  expect(screen.getByTestId('mitreisende-oeffnen')).toBeTruthy();
  expect(screen.getByText('L')).toBeTruthy();
  expect(screen.getByText('J')).toBeTruthy();
  // … die ausgeschriebenen Namen erst nach dem Antippen.
  expect(screen.queryByText('Lea')).toBeNull();
  expect(screen.queryByText('Jonas')).toBeNull();
});

test('die Facepile sagt vorlesbar, wie viele mitfahren', async () => {
  await wrap();
  expect(await screen.findByLabelText('Wer dabei ist, 2 Personen')).toBeTruthy();
});

test('fährt nur eine Person mit, zählt die Beschriftung im Singular', async () => {
  (fetchMembers as jest.Mock).mockResolvedValue({ data: [mitglieder[0]], error: null });
  await wrap();
  expect(await screen.findByLabelText('Wer dabei ist, 1 Person')).toBeTruthy();
});

test('Antippen öffnet die Liste der Mitreisenden', async () => {
  await wrap();
  await fireEvent.press(await screen.findByTestId('mitreisende-oeffnen'));
  expect(await screen.findByText('Lea')).toBeTruthy();
  expect(screen.getByText('Jonas')).toBeTruthy();
  expect(screen.getByText('Hat die Reise angelegt')).toBeTruthy();
  expect(screen.getByText('@jonas')).toBeTruthy();
});

// Ab der vierten Person zeigt die Facepile drei Gesichter und zählt weiter
// (Avatar.test.tsx prüft die Regel für sich), im Sheet stehen trotzdem alle.
test('bei vielen Mitreisenden zählt die Facepile weiter, das Sheet zeigt alle', async () => {
  const viele = ['Lea', 'Jonas', 'Mira', 'Sofia', 'Ben'].map((display_name, i) => ({
    user_id: `u${i + 1}`,
    role: i === 0 ? ('owner' as const) : ('member' as const),
    username: display_name.toLowerCase(),
    display_name,
  }));
  (fetchMembers as jest.Mock).mockResolvedValue({ data: viele, error: null });
  await wrap();
  expect(await screen.findByText('+2')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('mitreisende-oeffnen'));
  expect(await screen.findByText('Ben')).toBeTruthy();
  expect(screen.getByText('Sofia')).toBeTruthy();
});

test('zeigt den eigenen Zähler mit Erklärung', async () => {
  await wrap();
  expect(await screen.findByText('0')).toBeTruthy();
  expect(screen.getByText(/Momente eingefangen/)).toBeTruthy();
});

test('Owner kann vom Screen aus einladen', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Freunde einladen'));
  expect(mockPush).toHaveBeenCalledWith('/reise/t1/einladen');
});

// Kurzhand für die Tests unten: die Verwaltung steckt jetzt hinter der
// Facepile, jeder Test, der sie braucht, muss sie erst öffnen.
async function mitreisendeOeffnen() {
  await fireEvent.press(await screen.findByTestId('mitreisende-oeffnen'));
  await screen.findByText('Lea');
}

test('Owner kann im Sheet Mitglieder entfernen', async () => {
  await wrap();
  await mitreisendeOeffnen();
  await fireEvent.press(screen.getByLabelText('Jonas entfernen'));
  await waitFor(() => expect(removeMember).toHaveBeenCalledWith('t1', 'u2'));
});

test('Owner kann auch aus dem Sheet heraus einladen; es schliesst sich dabei', async () => {
  await wrap();
  await mitreisendeOeffnen();
  // Zwei Knöpfe dieses Namens im Baum, solange das Sheet offen ist: der im
  // Sheet ist der zweite (Sheets stehen als Geschwister NACH der ScrollView).
  const knoepfe = screen.getAllByText('Freunde einladen');
  expect(knoepfe).toHaveLength(2);
  await fireEvent.press(knoepfe[1]);
  expect(mockPush).toHaveBeenCalledWith('/reise/t1/einladen');
  await waitFor(() => expect(screen.queryByText('Hat die Reise angelegt')).toBeNull());
});

test('Owner kann sich selbst nicht entfernen', async () => {
  await wrap();
  await mitreisendeOeffnen();
  expect(screen.queryByLabelText('Lea entfernen')).toBeNull();
});

test('Mitglied sieht Verlassen statt Löschen', async () => {
  mockAuth.userId = 'u2';
  await wrap();
  expect(await screen.findByText('Reise verlassen')).toBeTruthy();
  expect(screen.queryByText('Reise löschen')).toBeNull();
});

// Wer die Reise nicht angelegt hat, sieht im Sheet nur die Namen: kein X, und
// auch keinen Weg, weitere Leute einzuladen.
test('Mitglied sieht im Sheet weder Entfernen noch Einladen', async () => {
  mockAuth.userId = 'u2';
  await wrap();
  await mitreisendeOeffnen();
  expect(screen.queryByLabelText('Jonas entfernen')).toBeNull();
  expect(screen.queryByLabelText('Lea entfernen')).toBeNull();
  expect(screen.queryByText('Freunde einladen')).toBeNull();
});

// Nach dem Reveal ist das Sheet eine reine Auskunft, auch für die
// Owner-Person: einladen lehnt der Server für nicht-aktive Reisen ohnehin ab,
// und wer im Recap zu sehen ist, gehört zur Reise.
test('nach dem Reveal zeigt das Sheet nur die Namen, auch der Owner-Person', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
  await wrap();
  await mitreisendeOeffnen();
  expect(screen.getByText('Jonas')).toBeTruthy();
  expect(screen.queryByLabelText('Jonas entfernen')).toBeNull();
  expect(screen.queryByText('Freunde einladen')).toBeNull();
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
  // Der Stack hat keinen Header, ohne diesen Knopf gäbe es keinen Rückweg.
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

// Der Fehler tritt an die STELLE der Facepile. Ohne ihn stünde dort stumm
// nichts, und der Screen behauptete, die Reise habe keine Mitreisenden: die
// eine Richtung, in die diese Stelle nie irren darf.
test('ein Fehler beim Mitgliederladen tritt an die Stelle der Facepile', async () => {
  const meldung = 'Die Mitglieder konnten nicht geladen werden. Probier es gleich nochmal.';
  (fetchMembers as jest.Mock).mockResolvedValue({ data: [], error: meldung });
  await wrap();
  expect(await screen.findByText(meldung)).toBeTruthy();
  expect(screen.queryByTestId('mitreisende-oeffnen')).toBeNull();
  // Die Reise selbst kam durch und bleibt bedienbar.
  expect(screen.getByText('Norwegen mit dem Camper')).toBeTruthy();
});

test('destruktiver Dialog «Jonas entfernen» löst warning-Haptik aus', async () => {
  await wrap();
  await mitreisendeOeffnen();
  await fireEvent.press(screen.getByLabelText('Jonas entfernen'));
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
});

test('destruktiver Dialog «Reise löschen» löst warning-Haptik aus', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Reise löschen'));
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
// derselben Reise, er darf nach einer Offline-Aufnahme nie beim reinen
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
// queueDb.ts). Vorher lag das im selben Promise.all wie fetchTrip/fetchMembers,
// eine Ablehnung liess `geladen` nie `true` werden, der Screen blieb ohne
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
// Konsolenzeile, die betroffene Person erfuhr nie, dass ihre Aufnahme weg ist.
test('ein dauerhaft verworfener Moment wird mit seiner Ursache erklärt', async () => {
  (queueDb.verworfene as jest.Mock).mockResolvedValue(einVerworfener);
  await wrap();

  expect(await screen.findByText('Ein Moment konnte nicht mehr eingesendet werden')).toBeTruthy();
  expect(screen.getByText(VERWORFEN_GRUND)).toBeTruthy();
  expect(queueDb.verworfene).toHaveBeenCalledWith('t1', 'u1');
});

test('die Erklärung verschwindet erst, wenn sie quittiert wurde', async () => {
  (queueDb.verworfene as jest.Mock).mockResolvedValue(einVerworfener);
  // Der echte Speicher löscht beim Quittieren, der Doppelgänger zieht nach,
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

// Review Important 3/M4 (Task 8): eine einzelne Style-Prüfung an zwei
// bekannten Knöpfen deckt nicht ab, dass IRGENDEIN anderer Knopf (z. B.
// «Reise bearbeiten» oder «Verstanden») versehentlich zusätzlich primär
// würde. Läuft über den vollständigen gerenderten Baum, nicht nur über zwei
// benannte Stellen.
//
// Review-Nachtrag (Task 9): diese Funktion ERZWINGT §7 nicht von sich aus,
// sie zählt nur, für den EINEN Baum, mit dem sie aufgerufen wird. Bis hierhin
// wurde sie nie bei offenem Sheet aufgerufen, obwohl dort (Sheet-eigenes
// «Abschliessen» + der jeweilige Screen-Primärbutton dahinter) tatsächlich
// zwei Akzentflächen gleichzeitig standen, ein realer Fund, kein
// hypothetischer. Die Tests unten rufen sie jetzt auch für den
// Sheet-offen-Fall auf (inkl. des durch Task 9 neu möglichen dritten
// Zustands «Recap starten» + offenes Sheet); vollständig ist die Abdeckung
// damit trotzdem nicht (revealed/archived/Nicht-Owner-Zustände bleiben
// ungeprüft), das ist eine bewusste Lücke, keine verdeckte.
type Baumknoten = { type?: string; props?: { style?: unknown }; children?: (Baumknoten | string)[] | null };
function zaehleAccentFlaechen(baum: unknown): number {
  let anzahl = 0;
  const besuchen = (knoten: unknown): void => {
    if (knoten == null || typeof knoten === 'string') return;
    if (Array.isArray(knoten)) {
      knoten.forEach(besuchen);
      return;
    }
    const b = knoten as Baumknoten;
    if (b.props?.style) {
      const flach = StyleSheet.flatten(b.props.style as never) as { backgroundColor?: string };
      if (flach.backgroundColor === palette.accent) anzahl += 1;
    }
    b.children?.forEach(besuchen);
  };
  besuchen(baum);
  return anzahl;
}

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

// Review M2: `laeuft` prüft exakt `status === 'active'`, eine Aufweichung auf
// `status !== 'revealed'` (Mutation) hätte den Knopf einer archivierten Reise
// angeboten, die Function hätte mit 409 abgelehnt. Kein bestehender Test
// deckte das ab.
test('Reise abschliessen fehlt bei archivierter Reise', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, status: 'archived' }, error: null });
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByText('Reise abschliessen')).toBeNull();
});

// Review-Entscheidung: vor dem Enddatum bleibt «Freunde einladen» primär (die
// Aktion, die eine laufende Reise wirklich braucht) und «Reise abschliessen»
// steht als Outline unten. Review M3: bislang prüfte kein Test die POSITION
// (nur Anwesenheit), eine Mutation, die den unteren Block unkonditional
// rendert und den oberen streicht, wäre unbemerkt geblieben. Über die
// Zeichenposition im serialisierten Baum geprüft: RNTL v14 exponiert keine
// Sibling-Order-Matcher, `JSON.stringify(toJSON())` erhält aber die
// Dokumentreihenfolge.
test('vor dem Enddatum steht «Reise abschliessen» unten als Sekundär-Button, «Freunde einladen» bleibt primär', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripVorEndeOk);
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByText('Eure Reise ist zu Ende. Zeit für den Recap.')).toBeNull();

  const abschliessen = StyleSheet.flatten(screen.getByText('Reise abschliessen').parent?.props.style);
  expect(abschliessen.borderWidth).toBe(1);
  expect(abschliessen.backgroundColor).toBe(palette['bg-0']);

  const einladen = StyleSheet.flatten(screen.getByText('Freunde einladen').parent?.props.style);
  expect(einladen.backgroundColor).toBe(palette.accent);

  // Anker ist der Momente-Zähler in der Mitte des Screens: der obere Block
  // steht davor, der untere dahinter. Bis zur Facepile stand hier «Wer dabei
  // ist», das war die Sektion in der Mitte; als Beschriftung der Facepile
  // steht derselbe Text jetzt ganz oben und taugt nicht mehr als Anker.
  const baum = JSON.stringify(screen.toJSON());
  expect(baum.indexOf('Reise abschliessen')).toBeGreaterThan(baum.indexOf('Momente eingefangen'));

  // DESIGN-LANGUAGE §7: höchstens eine Fläche trägt die Akzentfarbe.
  expect(zaehleAccentFlaechen(screen.toJSON())).toBe(1);
});

test('ab dem Enddatum rückt «Reise abschliessen» nach oben und wird zum Primär-Button, «Freunde einladen» tritt zurück', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripAmEndeOk);
  await wrap();
  expect(await screen.findByText('Eure Reise ist zu Ende. Zeit für den Recap.')).toBeTruthy();

  // getByText wirft bei mehr als einem Treffer, sichert zugleich, dass der
  // Knopf nicht gleichzeitig oben UND unten steht.
  const abschliessen = StyleSheet.flatten(screen.getByText('Reise abschliessen').parent?.props.style);
  expect(abschliessen.backgroundColor).toBe(palette.accent);

  const einladen = StyleSheet.flatten(screen.getByText('Freunde einladen').parent?.props.style);
  expect(einladen.borderWidth).toBe(1);
  expect(einladen.backgroundColor).toBe(palette['bg-0']);

  const baum = JSON.stringify(screen.toJSON());
  expect(baum.indexOf('Reise abschliessen')).toBeLessThan(baum.indexOf('Momente eingefangen'));

  expect(zaehleAccentFlaechen(screen.toJSON())).toBe(1);
});

test('Tippen auf «Reise abschliessen» öffnet das Bestätigungs-Sheet mit korrektem Text und löst warning-Haptik aus', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  expect(await screen.findByText('Reise abschliessen?')).toBeTruthy();
  // Review Important 1: die Zeile behauptet nicht mehr, dass NIEMAND mehr
  // Momente einsenden kann (posts_insert_member erlaubt Nachzügler mit
  // captured_at <= revealed_at ausdrücklich weiter, für alle Mitglieder),
  // sondern sagt ehrlich beides: keine neuen Momente, bereits aufgenommene
  // kommen noch durch.
  expect(
    screen.getByText(
      'Danach kann niemand mehr neue Momente aufnehmen. Bereits aufgenommene Momente von allen kommen noch durch, und alle sehen den Recap. Das lässt sich nicht rückgängig machen.'
    )
  ).toBeTruthy();
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
});

test('Sheet zeigt die persönliche Wartenden-Zeile nicht, wenn keine eigenen Momente warten', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  await screen.findByText('Reise abschliessen?');
  expect(screen.queryByText(/kommt noch durch, er/)).toBeNull();
  expect(screen.queryByText(/wartenden Momente kommen noch durch/)).toBeNull();
});

test('Sheet zeigt die persönliche Wartenden-Zeile im Plural, wenn mehrere eigene Momente warten', async () => {
  (queueDb.alleJobs as jest.Mock).mockResolvedValue([
    { trip_id: 't1', zustand: 'wartet' },
    { trip_id: 't1', zustand: 'wartet' },
    { trip_id: 't1', zustand: 'wartet' },
  ]);
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  expect(
    await screen.findByText('Deine 3 wartenden Momente kommen noch durch, sie sind vor der Aufdeckung entstanden.')
  ).toBeTruthy();
});

// Review Important 1: die Zahl bleibt im Singular NICHT stehen (Konvention von
// verworfenTitel(1), «Ein Moment …», nicht «1 Moment …»), und «Reveal» wurde
// durch das im Projekt sonst durchgängig verwendete «Aufdeckung» ersetzt.
test('Sheet zeigt die persönliche Wartenden-Zeile im Singular, wenn genau ein eigener Moment wartet', async () => {
  (queueDb.alleJobs as jest.Mock).mockResolvedValue([{ trip_id: 't1', zustand: 'wartet' }]);
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  expect(
    await screen.findByText('Dein wartender Moment kommt noch durch, er ist vor der Aufdeckung entstanden.')
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

test('Abschliessen ruft revealTrip auf; bei Erfolg schliesst das Sheet und lädt die Reise GENAU EIN weiteres Mal neu', async () => {
  // Stabile Referenz für den Zustand «nach dem Reveal» (siehe Kommentar bei
  // tripRevealedOk oben), mit korrigiertem useFocusEffect (Important 3) läuft
  // der Ladeweg zwar nicht mehr bei jedem Render, aber ein frisches Objekt pro
  // Aufruf wäre trotzdem ein unnötiger Rerender.
  let aufgedeckt = false;
  (fetchTrip as jest.Mock).mockImplementation(async () => (aufgedeckt ? tripRevealedOk : tripOk));
  (revealTrip as jest.Mock).mockImplementation(async () => {
    aufgedeckt = true;
    return { revealed_at: '2026-08-08T00:00:00Z', error: null };
  });
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  await screen.findByText('Reise abschliessen?');

  const ladeAufrufeVorAbschluss = (fetchTrip as jest.Mock).mock.calls.length;
  await fireEvent.press(screen.getByText('Abschliessen'));

  await waitFor(() => expect(revealTrip).toHaveBeenCalledWith('t1'));
  await waitFor(() => expect(screen.queryByText('Reise abschliessen?')).toBeNull());
  // Reise neu geladen: status ist jetzt 'revealed', der Knopf verschwindet.
  await waitFor(() => expect(screen.queryByText('Reise abschliessen')).toBeNull());
  // Review M1: mit dem korrigierten useFocusEffect-Mock lädt fetchTrip nicht
  // mehr bei jedem Render nach, dieser Test schlägt jetzt tatsächlich fehl,
  // wenn `void laden()` aus dem Erfolgspfad von `abschliessen()` gelöscht wird.
  await waitFor(() => expect((fetchTrip as jest.Mock).mock.calls.length).toBe(ladeAufrufeVorAbschluss + 1));
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
  // Sheet bleibt offen, der Knopf bleibt bedienbar, ein zweiter Versuch ist
  // immer erlaubt, weil die Function idempotent ist (Task-8-Brief).
  expect(screen.getByText('Reise abschliessen?')).toBeTruthy();
  await fireEvent.press(screen.getByText('Abschliessen'));
  await waitFor(() => expect(revealTrip).toHaveBeenCalledTimes(2));
});

// Review M5: `setRevealFehler(null)` in `abschliessenOeffnen` löschen blieb
// unbemerkt, kein Test öffnete das Sheet nach einem Fehler ein zweites Mal.
test('ein erneutes Öffnen nach einem Fehler zeigt die alte Fehlermeldung nicht mehr', async () => {
  const fehlerText = 'Die Reise konnte nicht abgeschlossen werden. Probier es gleich nochmal.';
  (revealTrip as jest.Mock).mockResolvedValue({ revealed_at: null, error: fehlerText });
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  await fireEvent.press(screen.getByText('Abschliessen'));
  await screen.findByText(fehlerText);

  await fireEvent.press(screen.getByText('Abbrechen'));
  await waitFor(() => expect(screen.queryByText('Reise abschliessen?')).toBeNull());

  await fireEvent.press(screen.getByText('Reise abschliessen'));
  await screen.findByText('Reise abschliessen?');
  expect(screen.queryByText(fehlerText)).toBeNull();
});

// === Task 9: Reveal-Entdeckung, Versprechen V6 («funktioniert auch ohne
// Push»). Kein einziger Mock in dieser Datei kennt Push oder Deep-Links,
// die Entdeckung hängt komplett am ohnehin bei jedem Fokussieren laufenden
// laden(). Genau das beweisen die folgenden Tests: sie lösen NICHTS aus
// ausser einem normalen Render/Fokus-Zyklus, und die Inszenierung erscheint
// trotzdem. ===

test('eine laufende Reise fragt revealGesehen gar nicht erst ab', async () => {
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(revealGesehen).not.toHaveBeenCalled();
  expect(screen.queryByTestId('reveal-inszenierung-fake')).toBeNull();
  expect(screen.queryByText('Recap starten')).toBeNull();
});

test('eine bereits gesehene aufgedeckte Reise zeigt sofort «Recap starten», ohne Inszenierung', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
  (revealGesehen as jest.Mock).mockResolvedValue(true);
  await wrap();
  expect(await screen.findByText('Recap starten')).toBeTruthy();
  expect(screen.queryByTestId('reveal-inszenierung-fake')).toBeNull();
  expect(revealGesehen).toHaveBeenCalledWith('t1');
  expect(merkeRevealGesehen).not.toHaveBeenCalled();
});

// Das Kernstück von V6: die App entdeckt den Reveal SELBST beim
// Fokussieren, ganz ohne Push oder Deep-Link, dieser Test tut nichts
// anderes als rendern und wartet ab.
test('eine frisch aufgedeckte, noch nie gesehene Reise spielt zuerst die Inszenierung, «Recap starten» erscheint erst danach und wird gemerkt', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
  (revealGesehen as jest.Mock).mockResolvedValue(false);
  await wrap();

  await screen.findByTestId('reveal-inszenierung-fake');
  // Solange die Inszenierung läuft, steht der Primär-Button noch NICHT da,
  // «zeigt DANACH» aus dem Task-9-Brief ist eine Reihenfolge, keine blosse
  // Koexistenz.
  expect(screen.queryByText('Recap starten')).toBeNull();
  expect(merkeRevealGesehen).not.toHaveBeenCalled();

  // Simuliert das Ende der Inszenierung (onFertig), die echte Optik/Timing
  // sind in RevealInszenierung.test.tsx abgesichert.
  await fireEvent.press(screen.getByTestId('reveal-inszenierung-fake'));

  await waitFor(() => expect(screen.queryByTestId('reveal-inszenierung-fake')).toBeNull());
  expect(await screen.findByText('Recap starten')).toBeTruthy();
  expect(merkeRevealGesehen).toHaveBeenCalledWith('t1');
});

test('«Recap starten» führt zur Recap-Übersicht dieser Reise', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
  (revealGesehen as jest.Mock).mockResolvedValue(true);
  await wrap();
  await fireEvent.press(await screen.findByText('Recap starten'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/recap/[id]/uebersicht', params: { id: 't1' } });
});

// DESIGN-LANGUAGE §7: höchstens eine Fläche trägt die Akzentfarbe, auch auf
// dem neuen Zustand nach dem Reveal, nicht nur auf den beiden schon
// bestehenden Zuständen (vor/ab Enddatum), die weiter oben geprüft werden.
test('«Recap starten» bleibt der einzige Primär-Button einer aufgedeckten Reise', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
  (revealGesehen as jest.Mock).mockResolvedValue(true);
  await wrap();
  await screen.findByText('Recap starten');
  expect(zaehleAccentFlaechen(screen.toJSON())).toBe(1);
});

test('eine archivierte Reise bekommt dieselbe Reveal-Entdeckung wie eine aufgedeckte', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, status: 'archived' as const }, error: null });
  (revealGesehen as jest.Mock).mockResolvedValue(true);
  await wrap();
  expect(await screen.findByText('Recap starten')).toBeTruthy();
  expect(revealGesehen).toHaveBeenCalledWith('t1');
});

// Beweist gleich zwei Dinge aus dem Task-9-Brief: dass die Prüfung
// tatsächlich «genau einmal» läuft, UND was bei einem gescheiterten Merken
// passiert (hier fest auf `false` gestellt, so, als hätte
// merkeRevealGesehen nie erfolgreich geschrieben). `entfernen()` liefert
// einen zweiten, von der Reveal-Entdeckung komplett unabhängigen laden()-
// Aufruf INNERHALB DESSELBEN Bildschirm-Aufrufs (der X-Knopf hängt an keiner
// Status-Bedingung), ohne `revealEntschiedenRef` würde dieser zweite Aufruf
// `revealGesehen` erneut befragen, wieder `false` bekommen und die
// Inszenierung ein zweites Mal über den längst sichtbaren «Recap
// starten»-Knopf legen.
test('ein zweiter Ladevorgang nach abgeschlossener Entscheidung fragt revealGesehen nicht nochmal ab, selbst wenn das Merken weiterhin als gescheitert gilt', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
  (revealGesehen as jest.Mock).mockResolvedValue(false);
  await wrap();

  await fireEvent.press(await screen.findByTestId('reveal-inszenierung-fake'));
  await screen.findByText('Recap starten');
  expect(revealGesehen).toHaveBeenCalledTimes(1);

  // Der zweite laden()-Aufruf kam bis zur Facepile aus dem Entfernen-X, das
  // direkt im Screen stand. Es steckt jetzt im Sheet, und das zeigt nach dem
  // Reveal keine X-Knöpfe mehr (reine Auskunft). Ein erneutes Fokussieren
  // ist ohnehin der ehrlichere Auslöser: genau so kommt der zweite Aufruf im
  // Betrieb zustande, wenn jemand den Screen verlässt und zurückkehrt.
  await erneutFokussieren();
  await waitFor(() => expect((fetchTrip as jest.Mock).mock.calls.length).toBeGreaterThan(1));

  expect(revealGesehen).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('reveal-inszenierung-fake')).toBeNull();
  expect(screen.getByText('Recap starten')).toBeTruthy();
});

// Review Important 3: der ursprüngliche einzelne Ref wurde VOR dem `await`
// gesetzt, richtig, um zwei ÜBERLAPPENDE laden()-Aufrufe (dieser Test) davon
// abzuhalten, `revealGesehen` beide gleichzeitig zu befragen. Eine
// kontrolliert unaufgelöste Promise hält den ERSTEN Aufruf mitten im Warten
// fest, während `entfernen()` (siehe Test oben) einen ZWEITEN auslöst, noch
// bevor der erste zurückkommt.
test('zwei überlappende laden()-Aufrufe fragen revealGesehen nur einmal ab (Schutz vor Nebenläufigkeit)', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
  let freigeben!: (wert: boolean) => void;
  (revealGesehen as jest.Mock).mockImplementation(
    () => new Promise<boolean>((resolve) => { freigeben = resolve; })
  );
  await wrap();
  await waitFor(() => expect(revealGesehen).toHaveBeenCalledTimes(1));

  // Der erste Aufruf (vom Mount) wartet noch auf revealGesehen(), jetzt
  // löst ein zweiter, unabhängiger laden()-Aufruf aus.
  await erneutFokussieren();
  await waitFor(() => expect((fetchTrip as jest.Mock).mock.calls.length).toBeGreaterThan(1));

  // Ohne den «läuft gerade»-Schutz (Ref-Zuweisung VOR dem await) hätte der
  // zweite Aufruf revealGesehen ein zweites Mal befragt, obwohl der erste
  // noch nicht fertig war.
  expect(revealGesehen).toHaveBeenCalledTimes(1);

  freigeben(false);
  await screen.findByTestId('reveal-inszenierung-fake');
});

// Review-Nachtrag zu Task 8 (Important 3/M4 dieser Runde): bei offenem Sheet
// stand bislang eine ZWEITE Akzentfläche im Baum, der Screen-Primärbutton
// dahinter blieb primär, während das Sheet sein eigenes «Abschliessen»
// zeigte. Der `zaehleAccentFlaechen`-Docstring behauptete das Gegenteil,
// ohne je in diesem Zustand geprüft worden zu sein.
test('bei offenem Sheet bleibt nur das «Abschliessen» im Sheet primär, der Screen-Knopf dahinter tritt zurück', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripAmEndeOk);
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  await screen.findByText('Reise abschliessen?');
  expect(zaehleAccentFlaechen(screen.toJSON())).toBe(1);
});

// Der durch Task 9 neu mögliche dritte Zustand: das Sheet steht offen (noch
// nichts hat es geschlossen), während ein UNABHÄNGIGER Ladevorgang (hier über
// `entfernen()` ausgelöst) entdeckt, dass die Reise inzwischen aufgedeckt ist,
// z. B. weil ein zweites Gerät sie abgeschlossen hat. «Recap starten»
// erscheint im Hintergrund, ohne dass DIESES Sheet je «Abschliessen» gedrückt
// hätte.
test('ein Reveal während offenem Sheet (z. B. von einem zweiten Gerät) lässt trotzdem nur eine Akzentfläche stehen', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripAmEndeOk);
  (revealGesehen as jest.Mock).mockResolvedValue(true);
  await wrap();
  await fireEvent.press(await screen.findByText('Reise abschliessen'));
  await screen.findByText('Reise abschliessen?');

  (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
  await erneutFokussieren();

  await screen.findByText('Recap starten');
  // Das Sheet bleibt offen, nichts in diesem Ablauf schliesst es automatisch.
  expect(screen.getByText('Reise abschliessen?')).toBeTruthy();
  expect(zaehleAccentFlaechen(screen.toJSON())).toBe(1);
});

// Dasselbe für das Mitreisenden-Sheet: es trägt bei laufender Reise sein
// eigenes «Freunde einladen» als Akzentfläche, der Screen-Knopf dahinter muss
// währenddessen zurücktreten (§7).
test('bei offenem Mitreisenden-Sheet trägt nur dessen «Freunde einladen» die Akzentfarbe', async () => {
  await wrap();
  await mitreisendeOeffnen();
  expect(zaehleAccentFlaechen(screen.toJSON())).toBe(1);
});

// Und ab dem Enddatum, wo «Reise abschliessen» der Primär-Button des Screens
// ist: auch der tritt zurück, nicht nur der Einladen-Knopf.
test('ab dem Enddatum tritt auch «Reise abschliessen» hinter das offene Mitreisenden-Sheet zurück', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue(tripAmEndeOk);
  await wrap();
  await mitreisendeOeffnen();
  expect(zaehleAccentFlaechen(screen.toJSON())).toBe(1);
});

// Der Gegenbeweis zum Übergang: wird die Reise aufgedeckt, während das
// Mitreisenden-Sheet offen steht, verliert das Sheet seinen Knopf und der
// Screen bekommt «Recap starten». Es bleibt bei genau einer Akzentfläche.
test('ein Reveal während offenem Mitreisenden-Sheet nimmt dem Sheet seinen Knopf', async () => {
  (revealGesehen as jest.Mock).mockResolvedValue(true);
  await wrap();
  await mitreisendeOeffnen();

  (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
  await erneutFokussieren();

  await screen.findByText('Recap starten');
  expect(screen.queryByText('Freunde einladen')).toBeNull();
  expect(zaehleAccentFlaechen(screen.toJSON())).toBe(1);
});

// Review Important 3 (Coda): «params: { id }» → «params: { id: 't1' }» wäre
// mit allen anderen Tests dieser Datei unterschiedslos grün geblieben, weil
// jede Fixture `t1` heisst. `mockRouteId` macht die Reise-Kennung für DIESEN
// einen Test bewusst anders, um zu beweisen, dass zumRecap() tatsächlich die
// übergebene `id` verwendet statt eines fest verdrahteten Werts.
test('«Recap starten» verwendet die tatsächliche Reise-Kennung, nicht fest verdrahtet «t1»', async () => {
  mockRouteId = 'reise-xyz';
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...tripRevealed, id: 'reise-xyz' }, error: null });
  (revealGesehen as jest.Mock).mockResolvedValue(true);
  await wrap();
  await fireEvent.press(await screen.findByText('Recap starten'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/uebersicht',
    params: { id: 'reise-xyz' },
  });
});

// Task 8, Phase 6: Melden und Moderation.
describe('Moderation (Task 8)', () => {
  const meldungFixture = {
    id: 'r1', post_id: 'p1', reason: 'Unpassend', created_at: '2026-08-05T09:30:00.000Z',
  };
  const erwarteteZeit = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(meldungFixture.created_at));

  test('ohne offene Meldungen zeigt der Screen gar keinen Einstiegspunkt', async () => {
    await wrap();
    await screen.findByText('Norwegen mit dem Camper');
    expect(screen.queryByTestId('moderation-oeffnen')).toBeNull();
  });

  test('die Owner-Person sieht «N gemeldete Momente», ein Mitglied ohne Owner-Rolle NICHT, selbst mit denselben Daten', async () => {
    (fetchMeldungen as jest.Mock).mockResolvedValue({ data: [meldungFixture], error: null });
    await wrap();
    expect(await screen.findByText('Ein gemeldeter Moment')).toBeTruthy();

    mockAuth.userId = 'u2'; // Jonas, kein Owner
    await wrap();
    await screen.findByText('Norwegen mit dem Camper');
    expect(screen.queryByTestId('moderation-oeffnen')).toBeNull();
  });

  test('der Singular/Plural-Text folgt der Anzahl', async () => {
    (fetchMeldungen as jest.Mock).mockResolvedValue({
      data: [meldungFixture, { ...meldungFixture, id: 'r2', post_id: 'p2' }],
      error: null,
    });
    await wrap();
    expect(await screen.findByText('2 gemeldete Momente')).toBeTruthy();
  });

  test('Tippen öffnet die Liste mit Vorschaubild, Grund und Zeitpunkt', async () => {
    (fetchMeldungen as jest.Mock).mockResolvedValue({ data: [meldungFixture], error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({
      vorrat: {
        urls: new Map([['p1', { post_id: 'p1', medium_url: 'https://cdn.example/p1.jpg', thumb_url: 'https://cdn.example/p1-thumb.jpg' }]]),
        gueltigBis: Date.now() + 999_999,
        ausgelassen: 0,
      },
      error: null,
      grund: null,
    });
    await wrap();
    await fireEvent.press(await screen.findByText('Ein gemeldeter Moment'));
    await screen.findByTestId('meldung-r1');

    expect(screen.getByText('Unpassend')).toBeTruthy();
    expect(screen.getByText(erwarteteZeit)).toBeTruthy();
    expect(screen.getByTestId('meldung-vorschau-r1').props.source).toEqual({
      uri: 'https://cdn.example/p1-thumb.jpg',
    });
  });

  test('ohne Thumbnail im Vorrat erscheint eine leere Fläche statt eines kaputten Bildes', async () => {
    (fetchMeldungen as jest.Mock).mockResolvedValue({ data: [meldungFixture], error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({
      vorrat: { urls: new Map(), gueltigBis: Date.now() + 999_999, ausgelassen: 0 },
      error: null,
      grund: null,
    });
    await wrap();
    await fireEvent.press(await screen.findByText('Ein gemeldeter Moment'));
    await screen.findByTestId('meldung-r1');
    expect(screen.queryByTestId('meldung-vorschau-r1')).toBeNull();
  });

  test('ein Ladefehler der Liste zeigt die Ursache mit Retry, keine leere Liste', async () => {
    (fetchMeldungen as jest.Mock)
      .mockResolvedValueOnce({ data: [meldungFixture], error: null }) // Startzähler
      .mockResolvedValueOnce({ data: null as unknown as [], error: 'Die Meldungen konnten nicht geladen werden. Probier es gleich nochmal.' });
    await wrap();
    await fireEvent.press(await screen.findByText('Ein gemeldeter Moment'));
    expect(
      await screen.findByText('Die Meldungen konnten nicht geladen werden. Probier es gleich nochmal.')
    ).toBeTruthy();
    expect(screen.queryByTestId('meldung-r1')).toBeNull();
  });

  test('«Meldung verwerfen» entfernt die Zeile und verringert den Zähler, der Moment selbst bleibt unberührt (kein entferneMoment-Aufruf)', async () => {
    (fetchMeldungen as jest.Mock).mockResolvedValue({ data: [meldungFixture], error: null });
    (verwirfMeldung as jest.Mock).mockResolvedValue({ error: null });
    await wrap();
    await fireEvent.press(await screen.findByText('Ein gemeldeter Moment'));
    await screen.findByTestId('meldung-r1');

    await fireEvent.press(screen.getByText('Meldung verwerfen'));
    expect(verwirfMeldung).toHaveBeenCalledWith('r1');
    expect(entferneMoment).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('meldung-r1')).toBeNull());
    expect(screen.getByText('Keine offenen Meldungen mehr.')).toBeTruthy();
    // Der Einstiegspunkt verschwindet, weil die Anzahl jetzt 0 ist.
    expect(screen.queryByTestId('moderation-oeffnen')).toBeNull();
  });

  test('ein Fehlschlag beim Verwerfen zeigt die Ursache an GENAU dieser Zeile, die Liste bleibt bestehen', async () => {
    (fetchMeldungen as jest.Mock).mockResolvedValue({ data: [meldungFixture], error: null });
    (verwirfMeldung as jest.Mock).mockResolvedValue({
      error: 'Die Meldung konnte nicht verworfen werden. Probier es gleich nochmal.',
    });
    await wrap();
    await fireEvent.press(await screen.findByText('Ein gemeldeter Moment'));
    await screen.findByTestId('meldung-r1');
    await fireEvent.press(screen.getByText('Meldung verwerfen'));
    expect(
      await screen.findByText('Die Meldung konnte nicht verworfen werden. Probier es gleich nochmal.')
    ).toBeTruthy();
    expect(screen.getByTestId('meldung-r1')).toBeTruthy();
  });

  // Alert.alert ist global gemockt (siehe Dateikopf) und ruft den
  // destruktiven Knopf sofort auf, «Moment entfernen» braucht darum keine
  // separate Bestätigungs-Simulation, exakt wie loeschen()/entfernen() oben.
  test('«Moment entfernen» fragt destruktiv nach (warning-Haptik) und entfernt danach den Moment UND die Zeile', async () => {
    (fetchMeldungen as jest.Mock).mockResolvedValue({ data: [meldungFixture], error: null });
    (entferneMoment as jest.Mock).mockResolvedValue({ error: null });
    await wrap();
    await fireEvent.press(await screen.findByText('Ein gemeldeter Moment'));
    await screen.findByTestId('meldung-r1');

    await fireEvent.press(screen.getByText('Moment entfernen'));
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
    expect(entferneMoment).toHaveBeenCalledWith('p1');
    await waitFor(() => expect(screen.queryByTestId('meldung-r1')).toBeNull());
    expect(screen.getByText('Keine offenen Meldungen mehr.')).toBeTruthy();
  });

  test('ein Fehlschlag beim Entfernen zeigt die Ursache an GENAU dieser Zeile, die Liste bleibt bestehen', async () => {
    (fetchMeldungen as jest.Mock).mockResolvedValue({ data: [meldungFixture], error: null });
    (entferneMoment as jest.Mock).mockResolvedValue({
      error: 'Der Moment konnte nicht entfernt werden. Probier es gleich nochmal.',
    });
    await wrap();
    await fireEvent.press(await screen.findByText('Ein gemeldeter Moment'));
    await screen.findByTestId('meldung-r1');
    await fireEvent.press(screen.getByText('Moment entfernen'));
    expect(
      await screen.findByText('Der Moment konnte nicht entfernt werden. Probier es gleich nochmal.')
    ).toBeTruthy();
    expect(screen.getByTestId('meldung-r1')).toBeTruthy();
  });

  test('das Öffnen lädt die Liste FRISCH, nicht den beim ersten Laden gesehenen Stand', async () => {
    (fetchMeldungen as jest.Mock)
      .mockResolvedValueOnce({ data: [meldungFixture], error: null }) // beim ersten laden()
      .mockResolvedValueOnce({
        data: [meldungFixture, { ...meldungFixture, id: 'r2', post_id: 'p2', reason: 'Zweite Meldung' }],
        error: null,
      });
    await wrap();
    await fireEvent.press(await screen.findByText('Ein gemeldeter Moment'));
    expect(await screen.findByText('Zweite Meldung')).toBeTruthy();
    expect(fetchMeldungen).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// «Dieser Recap ist geteilt», fuer ALLE Mitreisenden
// ===========================================================================
//
// Bis hierher wusste nur die Owner-Person, dass ein Link besteht: die
// SELECT-Policy auf share_links ist owner-only, und sie bleibt es, denn wer
// die Zeile liest, liest den Token. Alle anderen haben ihre Momente
// eingesendet, ohne je zu erfahren, dass sie jetzt hinter einer oeffentlichen
// URL stehen, samt den Orten. Die Auskunft kommt aus
// `public.recap_ist_geteilt` (Migration 20260810100000).
describe('der Hinweis auf einen bestehenden Teilen-Link', () => {
  test('steht da, wenn geteilt wird, samt dem Satz was der Link zeigt', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
    mockRpc.mockResolvedValue({ data: true, error: null });
    await wrap();

    expect(await screen.findByTestId('geteilt-hinweis')).toBeTruthy();
    expect(screen.getByText('Dieser Recap ist geteilt')).toBeTruthy();
    // Die Orte sind der Grund, aus dem es die Auskunft gibt.
    expect(screen.getByText(/samt den Orten/)).toBeTruthy();
  });

  test('sieht ihn auch, wer die Reise NICHT angelegt hat', async () => {
    mockAuth.userId = 'u2'; // Mitglied, nicht Owner
    (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
    mockRpc.mockResolvedValue({ data: true, error: null });
    await wrap();

    expect(await screen.findByTestId('geteilt-hinweis')).toBeTruthy();
  });

  test('ohne Link steht dort nichts, kein «nicht geteilt»-Laerm', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
    mockRpc.mockResolvedValue({ data: false, error: null });
    await wrap();
    // Auf die Antwort warten, sonst prüfte der Test nur, dass der Screen im
    // Ladezustand nichts zeigt, und wäre auch bei `data: true` grün.
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());

    expect(screen.queryByTestId('geteilt-hinweis')).toBeNull();
    expect(screen.queryByTestId('geteilt-unbekannt')).toBeNull();
  });

  // Die eine Richtung, in die diese Zeile nie irren darf: ein Netzfehler
  // beantwortet die Frage NICHT mit «nicht geteilt».
  test('faellt die Abfrage aus, sagt der Screen das, statt Entwarnung zu geben', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    await wrap();

    expect(await screen.findByTestId('geteilt-unbekannt')).toBeTruthy();
    expect(screen.queryByTestId('geteilt-hinweis')).toBeNull();
  });

  // Vor dem Reveal kann es gar keinen Link geben (share-link/verwaltung.ts
  // lehnt ab), die Abfrage waere fuer jede laufende Reise eine, die nie etwas
  // sagt.
  test('eine laufende Reise fragt gar nicht erst nach', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue(tripOk);
    await wrap();
    await screen.findByText(/Momente eingefangen/);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(screen.queryByTestId('geteilt-hinweis')).toBeNull();
  });

  test('gefragt wird nach GENAU dieser Reise', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue(tripRevealedOk);
    mockRpc.mockResolvedValue({ data: true, error: null });
    await wrap();
    await screen.findByTestId('geteilt-hinweis');

    expect(mockRpc).toHaveBeenCalledWith('recap_ist_geteilt', { p_trip_id: 't1' });
  });
});
