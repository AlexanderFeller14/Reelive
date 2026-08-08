import { render, screen, fireEvent, within } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { palette } from '@/theme/tokens';
import type { MedienUrl } from '@/features/recap/urlVorrat';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
// Steuerbar wie in uebersicht.test.tsx: nur so lässt sich der replace-Zweig
// von zurueck() überhaupt erreichen — mit einem hart auf `true` verdrahteten
// canGoBack bliebe er toter Code aus Test-Sicht.
let mockKannZurueck = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: () => mockKannZurueck }),
  useLocalSearchParams: () => ({ id: 't1' }),
}));
jest.mock('@/features/recap/recapApi', () => ({ fetchRecapMomente: jest.fn() }));
jest.mock('@/features/recap/urlVorrat', () => ({ holeVorrat: jest.fn() }));
// expo-image ist ein natives View — im Test reicht ein Platzhalter, der alle
// Props (`source`, `testID`, `onLoad`) durchreicht. Gleiches Muster wie in
// uebersicht.test.tsx; ohne den Mock scheitert schon das Laden des Moduls
// (expo-image/src/observe.ts erwartet eine native Umgebung), seit die Nadel
// ein Bild trägt.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});
// Spion MIT echter Implementierung: die Nadeln unten sollen weiterhin aus der
// echten Rechnung entstehen, aber die Liste, die der Screen hineingibt, muss
// sich prüfen lassen. Sie ist der eine Punkt dieses Screens, an dem ein
// Fehler still bliebe — `punkt.index` geht später als `start` an den Player,
// und der zählt in die gefilterte Spielliste (player.tsx:503-527). Gäbe der
// Screen die rohe Momente-Liste herein, sässen zwar dieselben Nadeln an
// denselben Koordinaten, aber jeder Sprung landete beim falschen Moment.
// Bis Task 8 den Sprung baut, ist DIESE Zusicherung der einzige Ort, an dem
// der Fehler auffiele.
jest.mock('@/features/karte/kartenPunkte', () => {
  const echt = jest.requireActual('@/features/karte/kartenPunkte');
  return { zuKartenPunkten: jest.fn(echt.zuKartenPunkten) };
});

import RecapKarte from '../[id]/karte';
import { fetchRecapMomente } from '@/features/recap/recapApi';
import { holeVorrat } from '@/features/recap/urlVorrat';
import { zuKartenPunkten } from '@/features/karte/kartenPunkte';

function moment(overrides: Partial<{
  id: string;
  captured_at: string;
  lat: number | null;
  lng: number | null;
  upload_status: 'pending' | 'uploaded';
}>) {
  return {
    id: 'p0', trip_id: 't1', author_id: 'u1', type: 'photo' as const, duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Lisbon', place_name: 'Lissabon',
    lat: 38.71, lng: -9.14,
    upload_status: 'uploaded' as const, autor_name: 'Lea',
    ...overrides,
  };
}

// Zwei Momente in Lissabon, die eine Nadel bekommen — und drei, die aus je
// einem anderen Grund keine bekommen dürfen:
//
// - p5 ist 'uploaded', hat aber keine URL im Vorrat (die Function konnte
//   keine ausstellen). Er liegt in TOKIO und chronologisch VOR allem anderen:
//   beides mit Absicht. Vorne, damit ein Index, der über die ungefilterte
//   Liste zählt, alles dahinter verschiebt; in Tokio, damit ein Ausschnitt,
//   der ihn mitrechnet, sichtbar über den halben Planeten geht.
// - p4 lädt noch hoch ('pending') und liegt aus demselben Grund in SYDNEY.
//   Er hat bewusst eine URL im Vorrat (siehe VORRAT_OK): sonst sortierte ihn
//   schon `urls.has(m.id)` aus, und der `upload_status`-Filter wäre durch
//   keinen Test gedeckt — man könnte ihn ersatzlos löschen, ohne dass eine
//   Zusicherung fiele (Fixrunde 1).
// - p3 ist sichtbar, hat aber keinen Ort (lat/lng null) — er gehört in die
//   Spielliste (und damit in die Index-Zählung), aber nicht auf die Karte.
const ohneUrlM = moment({ id: 'p5', captured_at: '2026-08-10T07:00:00.000Z', lat: 35.68, lng: 139.69 });
const m1 = moment({ id: 'p1', captured_at: '2026-08-10T09:00:00.000Z', lat: 38.71, lng: -9.14 });
const m2 = moment({ id: 'p2', captured_at: '2026-08-10T18:00:00.000Z', lat: 38.72, lng: -9.13 });
const pendingM = moment({
  id: 'p4', captured_at: '2026-08-10T20:00:00.000Z', lat: -33.86, lng: 151.21, upload_status: 'pending',
});
const m3 = moment({ id: 'p3', captured_at: '2026-08-11T10:00:00.000Z', lat: null, lng: null });

// Bereits chronologisch sortiert, wie fetchRecapMomente es liefert.
const VOLLSTAENDIG = [ohneUrlM, m1, m2, pendingM, m3];

// Rückgabetyp explizit als MedienUrl: `thumb_url` ist dort `string | null`,
// und ohne die Angabe erbte VORRAT_OK ein zu enges `string` — ein Vorrat ohne
// Thumbnail liesse sich dann gar nicht erst hineingeben (siehe
// VORRAT_OHNE_THUMB).
function bild(id: string): MedienUrl {
  return { post_id: id, medium_url: `https://cdn.example/${id}-medium.jpg`, thumb_url: `https://cdn.example/${id}-thumb.jpg` };
}

// p4 ist absichtlich dabei, obwohl er noch hochlädt: so ist der
// `upload_status`-Filter der EINZIGE, der ihn noch aussortiert, und jede der
// beiden Filterbedingungen des Screens hat ihren eigenen Gegenbeweis (p4 für
// `upload_status`, p5 für `urls.has`). Dass die Edge Function `media-urls`
// serverseitig ohnehin nur für hochgeladene Momente signiert, ist kein
// Argument dagegen — der Screen darf sich nicht darauf verlassen, und kein
// Test dieses Screens wüsste davon.
const VORRAT_OK = {
  urls: new Map([['p1', bild('p1')], ['p2', bild('p2')], ['p3', bild('p3')], ['p4', bild('p4')]]),
  gueltigBis: Date.now() + 999_999,
  ausgelassen: 1,
};

// Derselbe Vorrat, aber für p1 ohne Thumbnail: `media-urls` lässt `thumb_url`
// weg, wenn der Moment keinen `thumb_key` hat (siehe dessen index.ts) — für
// die Karte ist das kein Sonderfall, sondern ein Moment wie jeder andere.
const VORRAT_OHNE_THUMB = {
  ...VORRAT_OK,
  urls: new Map<string, MedienUrl>([
    ...VORRAT_OK.urls,
    ['p1', { post_id: 'p1', medium_url: bild('p1').medium_url, thumb_url: null }],
  ]),
};

const wrap = () => render(<ThemeProvider><RecapKarte /></ThemeProvider>);

function ladeErfolg(momente = VOLLSTAENDIG, vorrat = VORRAT_OK) {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: momente, error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({ vorrat, error: null, grund: null });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockKannZurueck = true;
});

test('setzt eine Nadel je Moment mit Ort', async () => {
  ladeErfolg();
  await wrap();
  expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(2);
  expect(screen.getByTestId('karte-nadel-p1')).toBeTruthy();
  expect(screen.getByTestId('karte-nadel-p2')).toBeTruthy();
});

test('die Nadel sitzt auf genau der Koordinate ihres Moments', async () => {
  ladeErfolg();
  await wrap();
  const nadel = await screen.findByTestId('karte-nadel-p2');
  expect(nadel.props.coordinate).toEqual({ latitude: 38.72, longitude: -9.13 });
});

test('Momente ohne Ort bekommen keine Nadel', async () => {
  ladeErfolg();
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  expect(screen.queryByTestId('karte-nadel-p3')).toBeNull();
});

// Kernfall dieses Screens: die Karte zeigt dieselbe Spielliste wie der
// Player — Momente, die noch hochladen oder für die es keine URL gibt,
// gehören nicht darauf. Sie hätten sonst nicht nur eine Nadel zu viel,
// sondern würden auch die Index-Zählung verschieben.
//
// Bewusst ZWEI Tests statt eines mit zwei Zusicherungen (Fixrunde 1): der
// Screen filtert über zwei Bedingungen, und jede braucht einen Test, der
// allein durch ihr Fehlen rot wird. In einem gemeinsamen Test liesse sich
// nicht ablesen, welche der beiden gerade fehlt.
test('ein noch hochladender Moment bekommt keine Nadel — auch mit URL im Vorrat', async () => {
  ladeErfolg();
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  expect(screen.queryByTestId('karte-nadel-p4')).toBeNull();
});

test('ein Moment ohne Bild im Vorrat bekommt keine Nadel', async () => {
  ladeErfolg();
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  expect(screen.queryByTestId('karte-nadel-p5')).toBeNull();
});

// Task 6: die Nadel trägt das Gesicht ihres eigenen Moments. Ein vertauschter
// Vorrats-Zugriff (z.B. über den Index statt über die id) sässe geografisch
// richtig und zeigte trotzdem das falsche Bild.
test('jede Nadel trägt das Thumbnail ihres eigenen Moments', async () => {
  ladeErfolg();
  await wrap();
  const nadel = await screen.findByTestId('karte-nadel-p2');
  expect(within(nadel).getByTestId('nadel-bild').props.source.uri).toBe(bild('p2').thumb_url);
});

// Fällt der Screen hier nicht auf `medium_url` zurück, bleibt für jeden Moment
// ohne Thumbnail für immer der pulsende Skeleton stehen — und mit ihm eine
// Nadel, die der Marker jeden Frame neu zeichnet (siehe tracksViewChanges
// unten). uebersicht.tsx nimmt an derselben Stelle denselben Ausweg.
test('fehlt das Thumbnail, nimmt die Nadel das mittlere Bild', async () => {
  ladeErfolg(VOLLSTAENDIG, VORRAT_OHNE_THUMB);
  await wrap();
  const nadel = await screen.findByTestId('karte-nadel-p1');
  expect(within(nadel).getByTestId('nadel-bild').props.source.uri).toBe(bild('p1').medium_url);
});

// DER Punkt, an dem dieser Screen technisch kippt (Spec §5.4, Task-6-Brief):
// `tracksViewChanges` steuert, ob react-native-maps die Nadel weiter
// nachzeichnet. Dauerhaft `true` heisst: jede Nadel wird bei jedem Frame neu
// gerendert, und die Karte ruckelt, sobald mehr als eine Handvoll darauf
// liegt. Dauerhaft `false` heisst: die Nadel friert in dem Zustand ein, den
// sie beim ersten Zeichnen hatte — und das ist der leere Kreis, denn das Bild
// kommt erst danach aus dem Netz. Beide Fehler sehen im Test gleich aus, wenn
// man nur einen der beiden Zeitpunkte prüft; darum stehen hier beide.
test('die Nadel wird nachgezeichnet, bis ihr Bild steht — und danach nicht mehr', async () => {
  ladeErfolg();
  await wrap();
  const nadel = await screen.findByTestId('karte-nadel-p1');
  expect(nadel.props.tracksViewChanges).toBe(true);

  await fireEvent(within(nadel).getByTestId('nadel-bild'), 'load');
  expect(screen.getByTestId('karte-nadel-p1').props.tracksViewChanges).toBe(false);
});

// Die fertige Nadel darf die anderen nicht mit einfrieren: jede hängt an
// ihrem eigenen Bild.
test('eine fertige Nadel schaltet nur sich selbst ab', async () => {
  ladeErfolg();
  await wrap();
  const nadel = await screen.findByTestId('karte-nadel-p1');
  await fireEvent(within(nadel).getByTestId('nadel-bild'), 'load');
  expect(screen.getByTestId('karte-nadel-p2').props.tracksViewChanges).toBe(true);
});

// K3: die Linie zeigt die Reise als Bewegung — in der Reihenfolge der
// AUFNAHME. `punkte` kommt bereits nach `captured_at` sortiert aus
// zuKartenPunkten; hier wird festgehalten, dass der Screen diese Reihenfolge
// unverändert weitergibt und nicht etwa nach Upload-Zeit oder Koordinate
// umsortiert.
test('die Linie verbindet die Momente in Aufnahmereihenfolge', async () => {
  ladeErfolg();
  await wrap();
  const linie = await screen.findByTestId('karte-linie');
  expect(linie.props.coordinates).toEqual([
    { latitude: 38.71, longitude: -9.14 },
    { latitude: 38.72, longitude: -9.13 },
  ]);
});

test('die Linie ist der Akzent in Breite 3', async () => {
  ladeErfolg();
  await wrap();
  const linie = await screen.findByTestId('karte-linie');
  expect(linie.props.strokeColor).toBe(palette.accent);
  expect(linie.props.strokeWidth).toBe(3);
});

// Eine Linie braucht zwei Punkte. Mit einem einzigen Moment stünde sonst ein
// Overlay auf der Karte, das nichts verbindet.
test('ein einzelner Moment ergibt keine Linie', async () => {
  ladeErfolg([m1, m3]);
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  expect(screen.queryByTestId('karte-linie')).toBeNull();
});

// Der Test, der den stillen Fehler laut macht (siehe Mock-Kommentar oben):
// hereingegeben wird GENAU die Spielliste — uploaded ∩ Vorrats-URL, in
// unveränderter Reihenfolge. p5 (uploaded, ohne URL) und p4 (pending) fehlen
// darin, p3 (ohne Ort) ist dabei: er zählt für den Index mit, auch wenn er
// keine Nadel bekommt.
test('zuKartenPunkten bekommt die Spielliste des Players, nicht die rohe Momente-Liste', async () => {
  ladeErfolg();
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  expect(zuKartenPunkten).toHaveBeenCalledWith([m1, m2, m3]);
});

// Gegenprobe zum Test darüber, ohne den Umweg über den Spion: rechnete der
// Ausschnitt Tokio (p5) oder Sydney (p4) mit, ginge er über den halben
// Planeten — die zwei Nadeln in Lissabon wären Punkte im Nichts.
test('der Ausschnitt umfasst nur die sichtbaren Nadeln', async () => {
  ladeErfolg();
  await wrap();
  const region = (await screen.findByTestId('karte-flaeche')).props.initialRegion;
  expect(region.latitude).toBeCloseTo(38.715, 3);
  expect(region.longitude).toBeCloseTo(-9.135, 3);
  expect(region.latitudeDelta).toBeLessThan(1);
  expect(region.longitudeDelta).toBeLessThan(1);
});

// Kein leerer Kartenausschnitt über dem Atlantik (Spec K9). Der erklärende
// Leer-Zustand kommt in Task 10 — hier zählt nur, dass keine Karte auf einer
// erfundenen Region steht.
test('hat kein einziger Moment einen Ort, steht gar keine Karte da', async () => {
  ladeErfolg([m3]);
  await wrap();
  await screen.findByLabelText('Zurück');
  expect(screen.queryByTestId('karte-flaeche')).toBeNull();
  expect(screen.queryByTestId(/^karte-nadel/)).toBeNull();
});

// Fixrunde 1: `fetchRecapMomente`/`holeVorrat` geben Fehler als Wert zurück
// — wirft doch eine von beiden, darf das keine unbehandelte Ablehnung werden
// und den Screen nicht unbedienbar zurücklassen. Der Rückweg muss bleiben.
test('wirft der Ladeweg, bleibt der Screen bedienbar statt haengen zu bleiben', async () => {
  (fetchRecapMomente as jest.Mock).mockRejectedValue(new Error('kaputt'));
  (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
  await wrap();
  await fireEvent.press(await screen.findByLabelText('Zurück'));
  expect(mockBack).toHaveBeenCalled();
  expect(screen.queryByTestId('karte-flaeche')).toBeNull();
});

test('der Zurück-Pfeil verlässt den Screen per back(), wenn ein Rückweg existiert', async () => {
  ladeErfolg();
  await wrap();
  await fireEvent.press(await screen.findByLabelText('Zurück'));
  expect(mockBack).toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

// Ohne Rückweg im Stapel (z.B. per Deep Link direkt auf die Karte) gibt es
// nichts vom Stapel zu nehmen — dann führt der Weg auf die Übersicht
// DIESER Reise, nicht auf die Recap-Liste: die Karte ist eine Lesart dieses
// Recaps, kein eigener Bereich (Spec §5.1).
test('ohne Rückweg im Stapel führt der Zurück-Pfeil auf die Übersicht dieser Reise', async () => {
  mockKannZurueck = false;
  ladeErfolg();
  await wrap();
  await fireEvent.press(await screen.findByLabelText('Zurück'));
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/recap/[id]/uebersicht', params: { id: 't1' } });
  expect(mockBack).not.toHaveBeenCalled();
});
