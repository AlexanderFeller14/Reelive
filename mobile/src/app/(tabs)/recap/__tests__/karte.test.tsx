import { render, screen, fireEvent, within } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { motion, palette } from '@/theme/tokens';
import type { MedienUrl } from '@/features/recap/urlVorrat';
import type { Ausschnitt } from '@/features/karte/typen';

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
// Steuerbar wie mockKannZurueck: ohne das liesse sich der Sprung-Zweig von
// `zeige` gar nicht erreichen — AccessibilityInfo meldet im Testlauf immer
// «keine Reduktion», und die Weiche wäre aus Test-Sicht toter Code.
let mockReduziert = false;
jest.mock('@/theme/useReducedMotion', () => ({ useReducedMotion: () => mockReduziert }));
// DESIGN-LANGUAGE §5: «Haptik: selection (Tabs, Zoom)». Muster wie in
// player.test.tsx — das native Modul gibt es im Testlauf nicht.
const mockHaptik = jest.fn(() => Promise.resolve());
jest.mock('expo-haptics', () => ({ selectionAsync: () => mockHaptik() }));
// Eigener Maps-Mock statt des globalen aus jest.setup.ts — aus zwei Gründen,
// die beide am imperativen Handle hängen:
//
// 1. Der globale Mock baut seine `jest.fn()` bei jedem Rendern neu und gibt
//    sie nicht nach aussen. Wer zusichern will, dass die Karte gefahren (oder
//    eben gesprungen) ist, kommt an sie nicht heran.
// 2. `tracksViewChanges` steht nach einer Prop-Änderung nur für EINEN Commit
//    auf `true` — genau den, der die Nadel neu zeichnen lässt. React spielt
//    Render und Effekt innerhalb desselben `act()` ab; im Endzustand steht
//    wieder `false`, und ein Test, der nur den Endzustand liest, könnte
//    «springt wieder an» nicht von «ist nie angesprungen» unterscheiden.
//    Derselbe Umweg wie in components/__tests__/KartenNadel.test.tsx.
const mockAnimateToRegion = jest.fn();
const mockSetRegion = jest.fn();
const mockTracksVerlauf: { id: unknown; tracks: unknown }[] = [];
jest.mock('react-native-maps', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  const Karte = ReactActual.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    ReactActual.useImperativeHandle(ref, () => ({
      animateToRegion: mockAnimateToRegion,
      setRegion: mockSetRegion,
      fitToCoordinates: jest.fn(),
    }));
    return ReactActual.createElement(View, props, props.children);
  });
  return {
    __esModule: true,
    default: Karte,
    Marker: (props: Record<string, unknown>) => {
      mockTracksVerlauf.push({ id: props.testID, tracks: props.tracksViewChanges });
      return ReactActual.createElement(View, props, props.children);
    },
    Polyline: (props: Record<string, unknown>) => ReactActual.createElement(View, props),
    PROVIDER_DEFAULT: undefined,
  };
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

// ---------------------------------------------------------------------------
// Task 7: zwei Momente, die sich eine Nadel teilen
// ---------------------------------------------------------------------------
//
// Alle Zahlen unten hängen an der Fenstergrösse des Testlaufs: jest-expo meldet
// 750 × 1334 Punkte. Ein Grad Länge sind bei einer Spanne von 0.01° also 75'000
// Punkte, ein Grad Breite 133'400 — ein Zehntausendstel Grad demnach 7.5 bzw.
// 13.3 Punkte. Die beiden Momente liegen damit rund 15 Punkte auseinander und
// somit unter GRUPPEN_ABSTAND_PT (40).
//
// Die id bleibt p2, damit VORRAT_OK unverändert passt — es ist derselbe zweite
// Moment wie oben, nur eine Strasse weiter statt einen Stadtteil.
const m2Nah = moment({ id: 'p2', captured_at: '2026-08-10T18:00:00.000Z', lat: 38.7101, lng: -9.1401 });
const NAH_BEIEINANDER = [m1, m2Nah];

// Hineingezoomt: bei 0.002° Spanne liegen dieselben zwei Momente rund 76 Punkte
// auseinander — die Gruppe fällt auseinander.
const ENG = { latitude: 38.71005, longitude: -9.14005, latitudeDelta: 0.002, longitudeDelta: 0.002 };
// Und einer dazwischen: rund 31 Punkte Abstand, die Gruppe bleibt bestehen —
// aber der Ausschnitt ist bereits ENGER als die Mindestspanne von
// `ausschnittFuer` (0.01°). Genau hier führte ein ungebremstes Ziel hinaus.
const MITTEL = { ...ENG, latitudeDelta: 0.005, longitudeDelta: 0.005 };

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

// Ein Vorrat, wie ihn eine ältere Function liefern kann: `medium_url` fehlt
// ganz. `MedienUrl` verspricht dort einen `string` — urlVorrat.ts übernimmt das
// Feld aber ungeprüft aus der Antwort (Zeile 141), der Typ lügt also. Genau
// deshalb steht die Umgehung hier als Cast: sie bildet nach, was zur Laufzeit
// ankommt, nicht was der Typ behauptet.
const VORRAT_OHNE_JEDES_BILD = {
  ...VORRAT_OK,
  urls: new Map<string, MedienUrl>([
    ...VORRAT_OK.urls,
    ['p1', { post_id: 'p1', thumb_url: null } as unknown as MedienUrl],
  ]),
};

const wrap = () => render(<ThemeProvider><RecapKarte /></ThemeProvider>);

function ladeErfolg(momente = VOLLSTAENDIG, vorrat = VORRAT_OK) {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: momente, error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({ vorrat, error: null, grund: null });
}

// Nimmt die mitgeschriebenen Werte EINER Nadel heraus und leert den Verlauf —
// so bezieht sich jede Zusicherung auf genau den Abschnitt seit dem letzten
// Aufruf. Nach id gefiltert, weil beim Auseinanderfallen einer Gruppe eine
// zweite Nadel dazukommt, die naturgemäss frisch gezeichnet wird.
function tracksSeitDann(id: string): unknown[] {
  const eigene = mockTracksVerlauf.filter((e) => e.id === id).map((e) => e.tracks);
  mockTracksVerlauf.length = 0;
  return eigene;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockKannZurueck = true;
  mockReduziert = false;
  mockTracksVerlauf.length = 0;
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

// Fixrunde 1, Punkt 3: fehlt in der Antwort der Function auch `medium_url`,
// hat die Nadel keine Bildquelle. Sie darf dann nicht als «lädt noch» dastehen
// und für immer bei jedem Frame neu gezeichnet werden — es kommt nichts mehr.
test('ohne jede Bildquelle zeigt die Nadel keinen Bildknoten', async () => {
  ladeErfolg(VOLLSTAENDIG, VORRAT_OHNE_JEDES_BILD);
  await wrap();
  const nadel = await screen.findByTestId('karte-nadel-p1');
  expect(within(nadel).queryByTestId('nadel-bild')).toBeNull();
  expect(within(nadel).getByTestId('nadel-skelett')).toBeTruthy();
});

test('ohne jede Bildquelle hoert die Nadel trotzdem auf, sich zu zeichnen', async () => {
  ladeErfolg(VOLLSTAENDIG, VORRAT_OHNE_JEDES_BILD);
  await wrap();
  const nadel = await screen.findByTestId('karte-nadel-p1');
  expect(nadel.props.tracksViewChanges).toBe(false);
});

// Fixrunde 1, Punkt 5: der Marker wird gerastert — was in der Nadel steht, ist
// für VoiceOver danach nicht mehr erreichbar. Die Beschriftung muss am Marker
// hängen, den der Screen setzt.
test('jede Nadel traegt eine Beschriftung fuer VoiceOver', async () => {
  ladeErfolg();
  await wrap();
  const nadel = await screen.findByTestId('karte-nadel-p1');
  expect(nadel.props.accessibilityLabel).toBe('Moment von Lea um 10:00 öffnen');
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

// ---------------------------------------------------------------------------
// Task 7: Gruppierung, und was ein Tipp auf eine Gruppe auslöst
// ---------------------------------------------------------------------------

// Spec §5.5: Nadeln, die sich sonst gegenseitig verdecken, teilen sich eine.
test('dicht beieinander liegende Momente teilen sich eine Nadel', async () => {
  ladeErfolg(NAH_BEIEINANDER);
  await wrap();
  const nadeln = await screen.findAllByTestId(/^karte-nadel/);
  expect(nadeln).toHaveLength(1);
  expect(screen.getByText('2')).toBeTruthy();
});

// Gruppiert wird nach dem Abstand auf DEM GERADE SICHTBAREN Ausschnitt, nicht
// auf dem, mit dem die Karte geöffnet wurde. Ohne das bliebe die Gruppe auch
// dann eine Nadel, wenn ihre Momente längst über den halben Schirm verteilt
// sind.
test('beim Hineinzoomen faellt die Gruppe in einzelne Nadeln', async () => {
  ladeErfolg(NAH_BEIEINANDER);
  await wrap();
  expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(1);

  await fireEvent(screen.getByTestId('karte-flaeche'), 'regionChangeComplete', ENG);
  expect(screen.getAllByTestId(/^karte-nadel/)).toHaveLength(2);
  expect(screen.queryByText('2')).toBeNull();
});

// Die Zähler-Pille muss beim Zoomen MITLAUFEN. Das ist nicht dasselbe wie der
// Test darüber: der liest den React-Baum, und der stimmt auch dann, wenn die
// Nadel auf der Karte längst eingefroren ist. Sichtbar wäre der Fehler nur auf
// dem Gerät — eine Gruppe, auf der weiterhin «2» steht, obwohl sie zwei Nadeln
// geworden ist. Beobachtbar ist er hier nur am mitgeschriebenen Verlauf von
// `tracksViewChanges` (siehe Mock oben).
test('faellt die Gruppe auseinander, wird ihre Nadel neu gezeichnet', async () => {
  ladeErfolg(NAH_BEIEINANDER);
  await wrap();
  const nadel = await screen.findByTestId('karte-nadel-p1');
  await fireEvent(within(nadel).getByTestId('nadel-bild'), 'load');
  expect(tracksSeitDann('karte-nadel-p1').at(-1)).toBe(false);

  await fireEvent(screen.getByTestId('karte-flaeche'), 'regionChangeComplete', ENG);
  const verlauf = tracksSeitDann('karte-nadel-p1');
  expect(verlauf).toContain(true); // sprang wieder an — die neue Nadel wird gezeichnet
  expect(verlauf.at(-1)).toBe(false); // und beruhigt sich wieder
});

// Mitte der Gruppe, und enger als der Ausschnitt, aus dem heraus getippt wurde
// (0.01° — die Mindestspanne von ausschnittFuer). Als Funktion, damit BEIDE
// Zweige von `zeige` wirklich dieselben Zusicherungen tragen: ein Sprung, der
// nur «irgendwohin» springt, ist kein erfüllter Reduced-Motion-Fall.
function erwarteZielAufDerGruppe(ziel: Ausschnitt) {
  expect(ziel.latitude).toBeCloseTo(38.71005, 4);
  expect(ziel.longitude).toBeCloseTo(-9.14005, 4);
  expect(ziel.latitudeDelta).toBeLessThan(0.01);
  expect(ziel.longitudeDelta).toBeLessThan(0.01);
}

// Spec §5.5: wer auf der Karte sucht, will die Karte benutzen — ein Tipp auf
// eine Gruppe fährt hinein, statt ein Sheet zu öffnen.
test('ein Tipp auf eine Gruppe faehrt in sie hinein', async () => {
  ladeErfolg(NAH_BEIEINANDER);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));

  expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);
  const [ziel, dauer] = mockAnimateToRegion.mock.calls[0];
  erwarteZielAufDerGruppe(ziel);
  expect(dauer).toBe(motion.duration.base);
});

// DESIGN-LANGUAGE §5 nennt für «Zoom» ausdrücklich selection-Haptik — dieselbe
// Meldung, die die Tab-Leiste gibt. Der Gruppen-Zoom ist der eine Zoom, den
// dieser Screen selbst auslöst.
test('ein Tipp auf eine Gruppe meldet sich mit selection-Haptik', async () => {
  ladeErfolg(NAH_BEIEINANDER);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(mockHaptik).toHaveBeenCalledTimes(1);
});

// Und nur dann: eine einzelne Nadel löst keinen Zoom aus, also klopft auch
// nichts. Das Moment-Sheet (Task 8) bringt seine eigene Regel mit.
test('ein Tipp auf eine einzelne Nadel klopft nicht', async () => {
  ladeErfolg();
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(mockHaptik).not.toHaveBeenCalled();
});

// `ausschnittFuer` hat eine Mindestspanne von rund 1,1 km — sie ist für den
// Erststart gedacht, damit ein einzelner Moment nicht maximal herangezoomt
// wird. Ungebremst als Ziel genommen, führte ein Tipp auf eine Gruppe aus
// einem bereits nahen Ausschnitt heraus — die Karte zoomte HINAUS, obwohl der
// Tipp hineinführen soll.
test('ein Tipp auf eine Gruppe zoomt nie hinaus', async () => {
  ladeErfolg(NAH_BEIEINANDER);
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  await fireEvent(screen.getByTestId('karte-flaeche'), 'regionChangeComplete', MITTEL);

  await fireEvent.press(screen.getByTestId('karte-nadel-p1'));
  const [ziel] = mockAnimateToRegion.mock.calls[0];
  expect(ziel.latitudeDelta).toBeLessThan(MITTEL.latitudeDelta);
  expect(ziel.longitudeDelta).toBeLessThan(MITTEL.longitudeDelta);
});

// Genau ein Punkt ist keine Gruppe: dorthin führt in Task 8 das Moment-Sheet.
// Die Karte darf dabei nicht fahren — sonst rutschte der Moment unter dem
// Sheet weg, während man ihn liest.
test('ein Tipp auf eine einzelne Nadel bewegt die Karte nicht', async () => {
  ladeErfolg();
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(mockAnimateToRegion).not.toHaveBeenCalled();
  expect(mockSetRegion).not.toHaveBeenCalled();
});

// DESIGN-LANGUAGE §5 / Spec K12: mit Reduced Motion wird gesprungen statt
// gefahren. Die Weiche sitzt in `zeige` — der EINEN Stelle, über die jede
// Kamerabewegung dieses Screens geht.
test('mit Reduced Motion springt die Karte, statt zu fahren', async () => {
  mockReduziert = true;
  ladeErfolg(NAH_BEIEINANDER);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(mockAnimateToRegion).not.toHaveBeenCalled();
  expect(mockSetRegion).toHaveBeenCalledTimes(1);
});

// «Springt» allein ist keine Zusicherung: ein Sprung auf 0/0 wäre auch einer.
// Der Sprung muss dasselbe Ziel treffen wie die Fahrt — sonst landet die Karte
// ausgerechnet auf dem Pfad im Atlantik, den von Hand am seltensten jemand
// sieht.
test('der Sprung trifft dasselbe Ziel wie die Fahrt', async () => {
  mockReduziert = true;
  ladeErfolg(NAH_BEIEINANDER);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  const [ziel] = mockSetRegion.mock.calls[0];
  erwarteZielAufDerGruppe(ziel);
});

// Auch der Sprung geht nicht hinaus — die Begrenzung sitzt vor `zeige`, gilt
// also für beide Zweige. Ohne diesen Test bliebe das eine Behauptung.
test('auch mit Reduced Motion wird nie hinausgezoomt', async () => {
  mockReduziert = true;
  ladeErfolg(NAH_BEIEINANDER);
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  await fireEvent(screen.getByTestId('karte-flaeche'), 'regionChangeComplete', MITTEL);

  await fireEvent.press(screen.getByTestId('karte-nadel-p1'));
  const [ziel] = mockSetRegion.mock.calls[0];
  expect(ziel.latitudeDelta).toBeLessThan(MITTEL.latitudeDelta);
  expect(ziel.longitudeDelta).toBeLessThan(MITTEL.longitudeDelta);
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
