import { useLayoutEffect } from 'react';
import {
  Animated,
  Dimensions,
  StyleSheet,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { act, render, screen, fireEvent, within } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { motion, palette } from '@/theme/tokens';
import type { MedienUrl } from '@/features/recap/urlVorrat';
import type { RecapMoment } from '@/features/recap/types';
import type { Ausschnitt } from '@/features/karte/typen';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
// Steuerbar wie in uebersicht.test.tsx: nur so lässt sich der replace-Zweig
// von zurueck() überhaupt erreichen, mit einem hart auf `true` verdrahteten
// canGoBack bliebe er toter Code aus Test-Sicht.
let mockKannZurueck = true;
// Ebenfalls steuerbar: der Screen bleibt bei einem Wechsel der Reise gemountet
// (dieselbe Route, andere id), und was von der vorherigen Reise stehen bleibt,
// lässt sich nur mit einer wechselnden id prüfen.
let mockId = 't1';
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: () => mockKannZurueck }),
  useLocalSearchParams: () => ({ id: mockId }),
}));
jest.mock('@/features/recap/recapApi', () => ({ fetchRecapMomente: jest.fn() }));
jest.mock('@/features/recap/urlVorrat', () => ({ holeVorrat: jest.fn() }));
// Ab Task 10 im Spiel: der Ladeweg der Reise gibt seinen Fehler als WERT
// zurück und hat ihn bisher fallen lassen. Sichtbar wird er auf diesem Screen
// nicht (der Filter ist Beiwerk, siehe karte.tsx), dass er den Fehlermelder
// erreicht, ist deshalb die einzige prüfbare Spur. Ohne DSN ist `meldeFehler`
// ein No-Op (lib/fehlermelder.ts), ein Spion muss also her.
jest.mock('@/lib/fehlermelder', () => ({ meldeFehler: jest.fn() }));
// Ab Task 9 im Spiel: der Tagesfilter braucht `trips.start_date`, weil die
// Tagesnummern ab DEM zählen (tage.ts), dieselbe Quelle wie in uebersicht.tsx
// und player.tsx. Ohne den Mock ginge die Abfrage an den echten Supabase-Client.
jest.mock('@/features/trips/tripsApi', () => ({ fetchTrip: jest.fn() }));
// expo-image ist ein natives View, im Test reicht ein Platzhalter, der alle
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
// Fehler still bliebe, `punkt.index` geht später als `start` an den Player,
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
// `zeige` gar nicht erreichen, AccessibilityInfo meldet im Testlauf immer
// «keine Reduktion», und die Weiche wäre aus Test-Sicht toter Code.
let mockReduziert = false;
jest.mock('@/theme/useReducedMotion', () => ({ useReducedMotion: () => mockReduziert }));
// DESIGN-LANGUAGE §5: «Haptik: selection (Tabs, Zoom)». Muster wie in
// player.test.tsx, das native Modul gibt es im Testlauf nicht.
const mockHaptik = jest.fn(() => Promise.resolve());
jest.mock('expo-haptics', () => ({ selectionAsync: () => mockHaptik() }));
// Eigener Maps-Mock statt des globalen aus jest.setup.ts, aus zwei Gründen,
// die beide am imperativen Handle hängen:
//
// 1. Der globale Mock baut seine `jest.fn()` bei jedem Rendern neu und gibt
//    sie nicht nach aussen. Wer zusichern will, dass die Karte gefahren (oder
//    eben gesprungen) ist, kommt an sie nicht heran.
// 2. `tracksViewChanges` steht nach einer Prop-Änderung nur für EINEN Commit
//    auf `true`, genau den, der die Nadel neu zeichnen lässt. React spielt
//    Render und Effekt innerhalb desselben `act()` ab; im Endzustand steht
//    wieder `false`, und ein Test, der nur den Endzustand liest, könnte
//    «springt wieder an» nicht von «ist nie angesprungen» unterscheiden.
//    Derselbe Umweg wie in components/__tests__/KartenNadel.test.tsx.
const mockAnimateToRegion = jest.fn();
const mockSetRegion = jest.fn();
const mockTracksVerlauf: { id: unknown; tracks: unknown }[] = [];
// Der Tipp jeder Nadel, gemerkt beim RENDERN. Der letzte Test dieser Datei
// braucht ihn, um genau zwischen Commit und passivem Effekt zu tippen, was
// über `fireEvent` nicht geht, weil dessen `act()` beides zusammen abspielt.
const mockPressen = new Map<string, () => void>();
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
      if (typeof props.onPress === 'function') {
        mockPressen.set(String(props.testID), props.onPress as () => void);
      }
      return ReactActual.createElement(View, props, props.children);
    },
    Polyline: (props: Record<string, unknown>) => ReactActual.createElement(View, props),
    PROVIDER_DEFAULT: undefined,
  };
});

import RecapKarte from '../[id]/karte';
import { SHEET_SCROLL_ANTEIL } from '@/components/Sheet';
import { fetchRecapMomente } from '@/features/recap/recapApi';
import { holeVorrat } from '@/features/recap/urlVorrat';
import { meldeFehler } from '@/lib/fehlermelder';
import { fetchTrip } from '@/features/trips/tripsApi';
import { zuKartenPunkten } from '@/features/karte/kartenPunkte';
import type { Trip } from '@/features/trips/types';

function moment(overrides: Partial<{
  id: string;
  captured_at: string;
  // Ab Task 9 im Spiel: die Tagesgrenze richtet sich nach captured_tz DES
  // MOMENTS (tage.ts), ohne einen eigenen Wert lässt sich eine Reise über die
  // Datumsgrenze nicht nachstellen.
  captured_tz: string;
  lat: number | null;
  lng: number | null;
  upload_status: 'pending' | 'uploaded';
  // Ab Task 8 im Spiel: das Moment-Sheet zeigt Autor, Ort und Caption an
  // (Spec §5.7), und jedes der drei muss sich einzeln setzen lassen.
  autor_name: string;
  place_name: string | null;
  caption: string | null;
}>) {
  return {
    id: 'p0', trip_id: 't1', author_id: 'u1', type: 'photo' as const, duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Lisbon', place_name: 'Lissabon',
    lat: 38.71, lng: -9.14,
    upload_status: 'uploaded' as const, autor_name: 'Lea',
    ...overrides,
  };
}

// Zwei Momente in Lissabon, die eine Nadel bekommen, und drei, die aus je
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
//   keinen Test gedeckt, man könnte ihn ersatzlos löschen, ohne dass eine
//   Zusicherung fiele (Fixrunde 1).
// - p3 ist sichtbar, hat aber keinen Ort (lat/lng null), er gehört in die
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
// Punkte, ein Grad Breite 133'400, ein Zehntausendstel Grad demnach 7.5 bzw.
// 13.3 Punkte. Die beiden Momente liegen damit rund 15 Punkte auseinander und
// somit unter GRUPPEN_ABSTAND_PT (40).
//
// Die id bleibt p2, damit VORRAT_OK unverändert passt, es ist derselbe zweite
// Moment wie oben, nur eine Strasse weiter statt einen Stadtteil.
const m2Nah = moment({ id: 'p2', captured_at: '2026-08-10T18:00:00.000Z', lat: 38.7101, lng: -9.1401 });
const NAH_BEIEINANDER = [m1, m2Nah];

// Hineingezoomt: bei 0.002° Spanne liegen dieselben zwei Momente rund 76 Punkte
// auseinander, die Gruppe fällt auseinander.
const ENG = { latitude: 38.71005, longitude: -9.14005, latitudeDelta: 0.002, longitudeDelta: 0.002 };
// Und einer dazwischen: rund 31 Punkte Abstand, die Gruppe bleibt bestehen,
// aber der Ausschnitt ist bereits ENGER als die Mindestspanne von
// `ausschnittFuer` (0.01°). Genau hier führte ein ungebremstes Ziel hinaus.
const MITTEL = { ...ENG, latitudeDelta: 0.005, longitudeDelta: 0.005 };

// Rückgabetyp explizit als MedienUrl: `thumb_url` ist dort `string | null`,
// und ohne die Angabe erbte VORRAT_OK ein zu enges `string`, ein Vorrat ohne
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
// Argument dagegen, der Screen darf sich nicht darauf verlassen, und kein
// Test dieses Screens wüsste davon.
const VORRAT_OK = {
  urls: new Map([['p1', bild('p1')], ['p2', bild('p2')], ['p3', bild('p3')], ['p4', bild('p4')]]),
  gueltigBis: Date.now() + 999_999,
  ausgelassen: 1,
};

// Derselbe Vorrat, aber für p1 ohne Thumbnail: `media-urls` lässt `thumb_url`
// weg, wenn der Moment keinen `thumb_key` hat (siehe dessen index.ts), für
// die Karte ist das kein Sonderfall, sondern ein Moment wie jeder andere.
const VORRAT_OHNE_THUMB = {
  ...VORRAT_OK,
  urls: new Map<string, MedienUrl>([
    ...VORRAT_OK.urls,
    ['p1', { post_id: 'p1', medium_url: bild('p1').medium_url, thumb_url: null }],
  ]),
};

// Ein Vorrat, wie ihn eine ältere Function liefern kann: `medium_url` fehlt
// ganz. `MedienUrl` verspricht dort einen `string`, urlVorrat.ts übernimmt das
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

// Die Reise, aus der die Tagesnummern gezählt werden. `start_date` ist der
// einzige Wert, den dieser Screen davon braucht, der Rest steht hier nur,
// weil `Trip` ihn verlangt.
const REISE: Trip = {
  id: 't1', name: 'Lissabon Städtetrip', start_date: '2026-08-10', end_date: '2026-08-14',
  status: 'revealed', owner_id: 'u1', member_names: [], member_count: 1, my_post_count: 0,
};

function ladeErfolg(momente = VOLLSTAENDIG, vorrat = VORRAT_OK, reise: Partial<Trip> = {}) {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...REISE, ...reise }, error: null });
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: momente, error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({ vorrat, error: null, grund: null });
}

// Nimmt die mitgeschriebenen Werte EINER Nadel heraus und leert den Verlauf,
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
  // Ein Grundstand für die Reise-Abfrage, den jeder Test überschreiben kann:
  // `clearAllMocks` löscht nur die Aufrufe, nicht die zuletzt gesetzte
  // Implementierung, ohne diese Zeile erbte ein Test, der `ladeErfolg` nicht
  // ruft (der Wurf-Test unten), die Reise des vorherigen und hinge damit an
  // der Reihenfolge der Tests.
  (fetchTrip as jest.Mock).mockResolvedValue({ data: REISE, error: null });
  mockKannZurueck = true;
  mockId = 't1';
  mockReduziert = false;
  mockTracksVerlauf.length = 0;
  mockPressen.clear();
  // Die Fenstergrösse ist modulweiter Zustand, der letzte Test unten ändert
  // sie. Ohne dieses Zurücksetzen rechneten alle Tests nach ihm mit einem
  // anderen Bildschirm, und die Abstände in Bildschirmpunkten (auf denen die
  // ganze Gruppierung beruht) stimmten nicht mehr.
  Dimensions.set({ window: URSPRUNGS_FENSTER, screen: URSPRUNGS_SCHIRM });
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
// Player, Momente, die noch hochladen oder für die es keine URL gibt,
// gehören nicht darauf. Sie hätten sonst nicht nur eine Nadel zu viel,
// sondern würden auch die Index-Zählung verschieben.
//
// Bewusst ZWEI Tests statt eines mit zwei Zusicherungen (Fixrunde 1): der
// Screen filtert über zwei Bedingungen, und jede braucht einen Test, der
// allein durch ihr Fehlen rot wird. In einem gemeinsamen Test liesse sich
// nicht ablesen, welche der beiden gerade fehlt.
test('ein noch hochladender Moment bekommt keine Nadel, auch mit URL im Vorrat', async () => {
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
// ohne Thumbnail für immer der pulsende Skeleton stehen, und mit ihm eine
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
// und für immer bei jedem Frame neu gezeichnet werden, es kommt nichts mehr.
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

// Fixrunde 1, Punkt 5: der Marker wird gerastert, was in der Nadel steht, ist
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
// sie beim ersten Zeichnen hatte, und das ist der leere Kreis, denn das Bild
// kommt erst danach aus dem Netz. Beide Fehler sehen im Test gleich aus, wenn
// man nur einen der beiden Zeitpunkte prüft; darum stehen hier beide.
test('die Nadel wird nachgezeichnet, bis ihr Bild steht, und danach nicht mehr', async () => {
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
// dem Gerät, eine Gruppe, auf der weiterhin «2» steht, obwohl sie zwei Nadeln
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
  expect(verlauf).toContain(true); // sprang wieder an, die neue Nadel wird gezeichnet
  expect(verlauf.at(-1)).toBe(false); // und beruhigt sich wieder
});

// Mitte der Gruppe, und enger als der Ausschnitt, aus dem heraus getippt wurde
// (0.01°, die Mindestspanne von ausschnittFuer). Als Funktion, damit BEIDE
// Zweige von `zeige` wirklich dieselben Zusicherungen tragen: ein Sprung, der
// nur «irgendwohin» springt, ist kein erfüllter Reduced-Motion-Fall.
function erwarteZielAufDerGruppe(ziel: Ausschnitt) {
  expect(ziel.latitude).toBeCloseTo(38.71005, 4);
  expect(ziel.longitude).toBeCloseTo(-9.14005, 4);
  expect(ziel.latitudeDelta).toBeLessThan(0.01);
  expect(ziel.longitudeDelta).toBeLessThan(0.01);
}

// Spec §5.5: wer auf der Karte sucht, will die Karte benutzen, ein Tipp auf
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

// DESIGN-LANGUAGE §5 nennt für «Zoom» ausdrücklich selection-Haptik, dieselbe
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

// `ausschnittFuer` hat eine Mindestspanne von rund 1,1 km, sie ist für den
// Erststart gedacht, damit ein einzelner Moment nicht maximal herangezoomt
// wird. Ungebremst als Ziel genommen, führte ein Tipp auf eine Gruppe aus
// einem bereits nahen Ausschnitt heraus, die Karte zoomte HINAUS, obwohl der
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
// Die Karte darf dabei nicht fahren, sonst rutschte der Moment unter dem
// Sheet weg, während man ihn liest.
test('ein Tipp auf eine einzelne Nadel bewegt die Karte nicht', async () => {
  ladeErfolg();
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(mockAnimateToRegion).not.toHaveBeenCalled();
  expect(mockSetRegion).not.toHaveBeenCalled();
});

// DESIGN-LANGUAGE §5 / Spec K12: mit Reduced Motion wird gesprungen statt
// gefahren. Die Weiche sitzt in `zeige`, der EINEN Stelle, über die jede
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
// Der Sprung muss dasselbe Ziel treffen wie die Fahrt, sonst landet die Karte
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

// Auch der Sprung geht nicht hinaus, die Begrenzung sitzt vor `zeige`, gilt
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

// K3: die Linie zeigt die Reise als Bewegung, in der Reihenfolge der
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
// hereingegeben wird GENAU die Spielliste, uploaded ∩ Vorrats-URL, in
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
// Planeten, die zwei Nadeln in Lissabon wären Punkte im Nichts.
test('der Ausschnitt umfasst nur die sichtbaren Nadeln', async () => {
  ladeErfolg();
  await wrap();
  const region = (await screen.findByTestId('karte-flaeche')).props.initialRegion;
  expect(region.latitude).toBeCloseTo(38.715, 3);
  expect(region.longitude).toBeCloseTo(-9.135, 3);
  expect(region.latitudeDelta).toBeLessThan(1);
  expect(region.longitudeDelta).toBeLessThan(1);
});

// Kein leerer Kartenausschnitt über dem Atlantik (Spec K9). Hier zählt nur,
// dass keine Karte auf einer erfundenen Region steht, was STATTDESSEN dort
// steht, prüft der Task-10-Abschnitt unten.
//
// Gewartet wird auf die Überschrift des Leer-Zustands und nicht mehr auf die
// Zurück-Pille: die gibt es hier seit Task 10 nicht mehr. Sie ist eine
// translucente Pille für die Kartenfläche (DESIGN-LANGUAGE §1), ohne Karte
// liegt sie auf nichts, und der eine Knopf des Leer-Zustands (Spec §5.9)
// führt ohnehin denselben Weg.
test('hat kein einziger Moment einen Ort, steht gar keine Karte da', async () => {
  ladeErfolg([m3]);
  await wrap();
  await screen.findByText('Diese Reise hat keine Orte');
  expect(screen.queryByTestId('karte-flaeche')).toBeNull();
  expect(screen.queryByTestId(/^karte-nadel/)).toBeNull();
});

// Fixrunde 1: `fetchRecapMomente`/`holeVorrat` geben Fehler als Wert zurück,
// wirft doch eine von beiden, darf das keine unbehandelte Ablehnung werden
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
// nichts vom Stapel zu nehmen, dann führt der Weg auf die Übersicht
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

// ---------------------------------------------------------------------------
// Task 8: das Moment-Sheet und der Sprung in den Player
// ---------------------------------------------------------------------------

// Ein Moment mit allem, was das Sheet zeigt (Spec §5.7). 13:32 UTC sind in
// Europe/Lisbon 14:32, die Uhrzeit muss also aus `captured_tz` kommen und
// nicht aus der Zeitzone des Testrechners (die ergäbe 15:32 in Zürich, 13:32
// in UTC). Dieselbe Formatierung wie Player und Nadel: features/recap/uhrzeit.
const mitAllem = moment({
  id: 'p1',
  autor_name: 'Mira',
  captured_at: '2026-08-10T13:32:00.000Z',
  place_name: 'Miradouro da Senhora do Monte',
  caption: 'Angekommen, 28 Grad im Mai',
});

// Ein Moment OHNE Ort, chronologisch VOR den beiden mit Ort, und das ist der
// ganze Zweck dieser Zeile. Ohne ihn zählten die Spielliste (in die `start`
// zeigt) und `punkte` (die Nadeln) zufällig gleich, und kein Test könnte
// sehen, in welche der beiden Listen der Index gebildet wurde. Mit ihm sind
// sie um genau eins verschoben: p1 steht in der Spielliste an Stelle 1 und in
// `punkte` an Stelle 0, p2 an Stelle 2 bzw. 1.
//
// p5 (uploaded, ohne URL) und p4 (pending) bleiben in der Liste, damit der
// Index auch gegen die ROHE Momente-Liste abgegrenzt ist: dort stünde p2 an
// Stelle 3.
const ohneOrtFrueh = moment({ id: 'p3', captured_at: '2026-08-10T08:00:00.000Z', lat: null, lng: null });
const MIT_SHEET_DATEN = [ohneUrlM, ohneOrtFrueh, mitAllem, m2, pendingM];

// Zwei Momente auf EXAKT derselben Koordinate (Task-8-Brief, Schritt 2b). Sie
// fallen durch keine Zoomstufe auseinander: der Abstand auf dem Bildschirm ist
// ihre Ausdehnung geteilt durch die sichtbare Spanne, und null bleibt null.
// Ohne einen Ausweg tippt man hier ins Leere.
const m2Aufeinander = moment({ id: 'p2', captured_at: '2026-08-10T18:00:00.000Z', lat: 38.71, lng: -9.14 });
const AUF_EINEM_FLECK = [ohneUrlM, ohneOrtFrueh, mitAllem, m2Aufeinander, pendingM];

test('ein Tipp auf eine einzelne Nadel zeigt den Moment', async () => {
  ladeErfolg(MIT_SHEET_DATEN);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));

  expect(screen.getByText('Angekommen, 28 Grad im Mai')).toBeTruthy();
  expect(screen.getByText('Miradouro da Senhora do Monte')).toBeTruthy();
  // Zugleich der Beweis für die Uhrzeit: 14:32 gibt es nur in `captured_tz`.
  expect(screen.getByText('Mira · 14:32')).toBeTruthy();
});

// Das Sheet zeigt das Bild gross (3:2, Spec §5.7), dort gehört das mittlere
// Bild hin, nicht das 44 Punkte breite Nadel-Thumbnail. Nur an der URL ist zu
// sehen, welches von beiden genommen wurde.
test('das Sheet zeigt das mittlere Bild, nicht das Nadel-Thumbnail', async () => {
  ladeErfolg(MIT_SHEET_DATEN);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(screen.getByTestId('sheet-bild').props.source.uri).toBe(bild('p1').medium_url);
});

// DER wichtigste Test dieses Plans: `start` ist ein INDEX in die sortierte
// SPIELLISTE des Players (uploaded ∩ Vorrats-URL, player.tsx:503-527), nicht
// in die Nadeln und nicht in die rohe Momente-Liste. Zeigt er auf den falschen
// Wert, startet der Player beim falschen Moment, und niemand merkt es, ausser
// er zählt nach.
//
// p2 steht in der Spielliste an Stelle 2, in `punkte` an Stelle 1, in der
// rohen Liste an Stelle 3. Die 2 ist damit die einzige Zahl, die aus der
// richtigen Zählung fallen kann.
test('«Im Recap ansehen» startet den Player bei genau diesem Moment', async () => {
  ladeErfolg(MIT_SHEET_DATEN);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p2'));
  await fireEvent.press(screen.getByText('Im Recap ansehen'));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player',
    params: { id: 't1', start: '2' },
  });
});

test('das Sheet schliesst, ohne den Screen zu verlassen', async () => {
  ladeErfolg(MIT_SHEET_DATEN);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  await fireEvent.press(screen.getByLabelText('Schliessen'));

  expect(screen.queryByText('Im Recap ansehen')).toBeNull();
  expect(mockPush).not.toHaveBeenCalled();
  // Die Karte steht noch da, mit ihren Nadeln, geschlossen wird das Sheet,
  // nicht der Screen.
  expect(screen.getByTestId('karte-nadel-p1')).toBeTruthy();
});

// Schritt 2b: der Ausweg für Gruppen, die sich nicht auflösen lassen.
test('eine Gruppe, die sich nicht aufzoomen laesst, oeffnet doch ein Sheet', async () => {
  ladeErfolg(AUF_EINEM_FLECK);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));

  expect(screen.getByText('2 Momente an diesem Ort')).toBeTruthy();
  expect(screen.getAllByTestId(/^gruppe-eintrag/)).toHaveLength(2);
});

// Die Regel bleibt «erst zoomen»: eine Kamerafahrt, die nichts ausrichtet, ist
// keine Zutat zum Sheet, sondern ein Ruckler ins Leere, und die
// selection-Haptik gehört zum Zoom, nicht zum Sheet.
test('eine Gruppe auf einem Fleck faehrt nicht ins Leere, bevor das Sheet kommt', async () => {
  ladeErfolg(AUF_EINEM_FLECK);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));

  expect(mockAnimateToRegion).not.toHaveBeenCalled();
  expect(mockSetRegion).not.toHaveBeenCalled();
  expect(mockHaptik).not.toHaveBeenCalled();
});

// Jeder Eintrag führt über DENSELBEN Index-Weg in den Player wie ein einzelner
// Moment (Task-8-Brief, Schritt 2b). Der Index innerhalb der Gruppe wäre hier
// 1, der in `punkte` ebenfalls 1, nur die Spielliste ergibt 2.
test('jeder Eintrag der Gruppe fuehrt an seinen eigenen Platz in der Spielliste', async () => {
  ladeErfolg(AUF_EINEM_FLECK);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  await fireEvent.press(screen.getByTestId('gruppe-eintrag-p2'));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player',
    params: { id: 't1', start: '2' },
  });
});

// Ein offenes Sheet gehört zu der Reise, aus der es geöffnet wurde. Bliebe es
// beim Wechsel stehen, zeigte es einen Moment der vorherigen, und sein Knopf
// schickte den Player mit DEREN Index in die neue Reise, wo dieselbe Zahl auf
// einen ganz anderen Moment zeigt. Genau die Art Fehler, die nur auffällt, wenn
// jemand nachzählt.
test('ein Wechsel der Reise laesst kein Sheet der vorherigen stehen', async () => {
  ladeErfolg(MIT_SHEET_DATEN);
  const { rerender } = await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(screen.getByText('Im Recap ansehen')).toBeTruthy();

  mockId = 't2';
  ladeErfolg([m1]);
  await rerender(<ThemeProvider><RecapKarte /></ThemeProvider>);

  expect(screen.queryByText('Im Recap ansehen')).toBeNull();
  expect(screen.queryByText('Angekommen, 28 Grad im Mai')).toBeNull();
});

// Die Beschriftung der Nadel muss dieselbe Weiche kennen wie der Tipp selbst.
// Wie sie formuliert ist, prüft components/__tests__/KartenNadel.test.tsx,
// hier hängt sie am richtigen Wert: sonst verspricht die Karte per VoiceOver
// einen Zoom, den sie nicht einlösen kann, und zwar ausgerechnet denen, die
// nur das Label haben.
test('die Nadel einer Gruppe auf einem Fleck kuendigt das Sheet an', async () => {
  ladeErfolg(AUF_EINEM_FLECK);
  await wrap();
  expect(await screen.findByLabelText('2 Momente an diesem Ort ansehen')).toBeTruthy();
});

test('die Nadel einer aufzoombaren Gruppe kuendigt den Zoom an', async () => {
  ladeErfolg(NAH_BEIEINANDER);
  await wrap();
  expect(await screen.findByLabelText('Auf 2 Momente heranzoomen')).toBeTruthy();
});

// Und die Gegenprobe, die den Zoom-Weg am Leben hält: wo Zoomen etwas
// ausrichtet, gibt es kein Sheet, weder die Liste noch den einzelnen Moment.
test('eine Gruppe, die sich aufzoomen laesst, oeffnet KEIN Sheet', async () => {
  ladeErfolg(NAH_BEIEINANDER);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));

  expect(screen.queryByText(/an diesem Ort/)).toBeNull();
  expect(screen.queryByText('Im Recap ansehen')).toBeNull();
});

// ---------------------------------------------------------------------------
// Abschluss-Review, Finding 1: die Karte hat eine letzte Zoomstufe
// ---------------------------------------------------------------------------
//
// `aufEinemFleck` (bitgleiche Koordinaten) deckte nur den seltenen Fall ab.
// Der häufige: zwei Aufnahmen am selben Ort liegen durch GPS-Versatz drei bis
// acht Meter auseinander, bei Leaflets Zoomstufe 19 sind das weniger als die
// 40 Bildschirmpunkte, ab denen zwei Nadeln getrennt gezeichnet werden. Die
// Gruppe fiel durch keine Zoomstufe auseinander, und der Tipp lief beliebig
// oft ins Leere. Die Antwort kennt keine Zahl, sondern beobachtet: hat sich
// der Ausschnitt bewegt?
//
// Im Testlauf meldet die gemockte Karte von sich aus nie einen neuen
// Ausschnitt, sie steht damit genau so still wie am Anschlag.
test('bewegt ein Gruppen-Tipp die Kamera nicht, oeffnet der naechste das Sheet', async () => {
  ladeErfolg(NAH_BEIEINANDER);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(screen.queryByText(/an diesem Ort/)).toBeNull(); // erst fahren

  await fireEvent.press(screen.getByTestId('karte-nadel-p1'));
  expect(screen.getByText('2 Momente an diesem Ort')).toBeTruthy();
  expect(screen.getAllByTestId(/^gruppe-eintrag/)).toHaveLength(2);
});

// Die Gegenprobe, die den Zoom-Weg am Leben hält: hat sich der Ausschnitt
// zwischen den beiden Tipps geändert, kann die Kamera noch etwas ausrichten,
// dann gibt es weiterhin kein Sheet, sondern eine zweite Fahrt.
test('hat sich der Ausschnitt bewegt, zoomt auch der zweite Tipp weiter', async () => {
  ladeErfolg(NAH_BEIEINANDER);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  await fireEvent(screen.getByTestId('karte-flaeche'), 'regionChangeComplete', MITTEL);

  await fireEvent.press(screen.getByTestId('karte-nadel-p1'));
  expect(screen.queryByText(/an diesem Ort/)).toBeNull();
  expect(mockAnimateToRegion).toHaveBeenCalledTimes(2);
});

// Eine andere Gruppe liegt woanders: dorthin kann die Kamera fahren, auch wenn
// die Zoomstufe am Anschlag ist, die MITTE bewegt sich. Ein stehen
// gebliebener Versuch darf sie nicht mit ins Sheet reissen.
test('ein festgefahrener Versuch blockiert eine ANDERE Gruppe nicht', async () => {
  // Zwei Gruppen: p1/p2 dicht beieinander in Lissabon, p6/p7 dicht beieinander
  // rund einen Kilometer weiter.
  const m6 = moment({ id: 'p6', captured_at: '2026-08-10T19:00:00.000Z', lat: 38.7201, lng: -9.1301 });
  const m7 = moment({ id: 'p7', captured_at: '2026-08-10T19:30:00.000Z', lat: 38.72012, lng: -9.1301 });
  ladeErfolg([m1, m2Nah, m6, m7], {
    ...VORRAT_OK,
    urls: new Map([['p1', bild('p1')], ['p2', bild('p2')], ['p6', bild('p6')], ['p7', bild('p7')]]),
    ausgelassen: 0,
  });
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  // Die Karte steht (kein regionChangeComplete), der Versuch auf p1 ist
  // festgefahren. Der Tipp auf die andere Gruppe muss trotzdem fahren.
  await fireEvent.press(screen.getByTestId('karte-nadel-p6'));

  expect(screen.queryByText(/an diesem Ort/)).toBeNull();
  expect(mockAnimateToRegion).toHaveBeenCalledTimes(2);
});

// ---------------------------------------------------------------------------
// Task 7, offen gebliebener Punkt: der Tipp direkt nach einer Kamerafahrt
// ---------------------------------------------------------------------------
//
// Der Screen merkt sich den Gruppen-Stand für den nächsten Tipp in einem Ref
// (`stand`, karte.tsx). Geschrieben wird es in einem LAYOUT-Effekt, nicht in
// einem passiven: ein passiver läuft erst nach dem Commit, und in dem Fenster
// dazwischen liest ein Tipp noch den alten Stand. Genau das passiert nach
// einer Kamerafahrt, die Gruppe ist zerfallen, die neue Nadel steht schon da,
// und wer sie sofort antippt, wird im alten Stand nicht gefunden: das Sheet
// bliebe aus, ohne dass irgendwo ein Fehler entstünde.
//
// Task 7 konnte das nicht prüfen, weil `fireEvent` sein `act()` mitbringt und
// dieses am Ende ALLE Effekte abspielt, das Fenster existiert dort nicht.
// Es existiert aber in der Reihenfolge der Layout-Effekte: React spielt sie in
// Baumreihenfolge ab, Geschwister von links nach rechts, und ALLE vor dem
// ersten passiven Effekt. Ein Nachbar, der NACH dem Screen steht und selbst in
// einem Layout-Effekt tippt, trifft damit exakt den Augenblick, in dem der
// Screen committet hat und sein passiver Effekt noch aussteht.
//
// Ausgelöst wird beides vom selben Ereignis: eine Änderung der Fenstergrösse.
// Sie geht über `useWindowDimensions` an beide, wird zu einem Render
// zusammengefasst, und lässt die Gruppe auseinanderfallen, weil in einem
// grösseren Fenster mehr Bildschirmpunkte auf dasselbe Grad kommen.
const GROSSES_FENSTER = { width: 3000, height: 5000, scale: 2, fontScale: 1 };
const URSPRUNGS_FENSTER = Dimensions.get('window');
const URSPRUNGS_SCHIRM = Dimensions.get('screen');

function Stichler({ nadel }: { nadel: string }) {
  const { width } = useWindowDimensions();
  useLayoutEffect(() => {
    // Erst nach dem Wachsen tippen, beim ersten Rendern gibt es die Nadel
    // noch gar nicht.
    if (width !== GROSSES_FENSTER.width) return;
    mockPressen.get(nadel)?.();
  }, [width, nadel]);
  return null;
}

test('ein Tipp unmittelbar nach dem Zerfall einer Gruppe wird nicht verschluckt', async () => {
  ladeErfolg(NAH_BEIEINANDER);
  await render(
    <ThemeProvider>
      <RecapKarte />
      <Stichler nadel="karte-nadel-p2" />
    </ThemeProvider>
  );
  // Vorbedingung: p2 ist noch Mitglied der Gruppe um p1, hat also keine eigene
  // Nadel, der Tipp unten gilt einer, die es beim Rendern davor nicht gab.
  await screen.findByTestId('karte-nadel-p1');
  expect(screen.queryByTestId('karte-nadel-p2')).toBeNull();

  await act(async () => {
    Dimensions.set({ window: GROSSES_FENSTER, screen: GROSSES_FENSTER });
  });

  expect(screen.getByTestId('karte-nadel-p2')).toBeTruthy();
  expect(screen.getByText('Lea · 19:00')).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Fixrunde 1: die Sackgasse im Ausweg, und der Wächter, der nur versteckte
// ---------------------------------------------------------------------------

// Zwölf Momente auf EXAKT derselben Koordinate. Das ist kein konstruierter
// Randfall: `ortBestimmen` fragt ohne Optionen nach der Position
// (features/moments/ortUndZeit.ts), und zwei Aufnahmen kurz nacheinander
// bekommen dort regelmässig denselben Fix bitgleich zurück, deshalb gibt es
// dieses Sheet überhaupt.
//
// Die Liste ist 87 + 72·N Punkte hoch; ohne Scroll-Bereich schneidet `Sheet`
// (85 % Fensterhöhe, `overflow: 'hidden'`) ab dem siebten Eintrag ab. Die
// abgeschnittenen Momente wären auf KEINEM Weg mehr erreichbar, denn Zoomen
// hilft auf einem Fleck per Definition nicht.
const VIELE_AUF_EINEM_FLECK = [
  ohneUrlM,
  ohneOrtFrueh,
  ...Array.from({ length: 12 }, (_, i) =>
    moment({
      id: `f${i}`,
      captured_at: `2026-08-10T${String(9 + i).padStart(2, '0')}:00:00.000Z`,
      lat: 38.71,
      lng: -9.14,
    })
  ),
];
const VORRAT_VIELE = {
  ...VORRAT_OK,
  urls: new Map<string, MedienUrl>([
    ...VORRAT_OK.urls,
    ...Array.from({ length: 12 }, (_, i) => [`f${i}`, bild(`f${i}`)] as const),
  ]),
};

test('die Gruppenliste scrollt, statt ihre letzten Momente abzuschneiden', async () => {
  ladeErfolg(VIELE_AUF_EINEM_FLECK, VORRAT_VIELE);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-f0'));

  const liste = screen.getByTestId('gruppe-liste');
  // Ein blosses View mit derselben testID wäre keine Rettung, nur eine
  // Scroll-Fläche macht Einträge unterhalb der Kante erreichbar.
  expect(liste.type).toBe('RCTScrollView');
  // Und sie braucht eine Obergrenze: ohne die wüchse sie mit ihrem Inhalt,
  // und `Sheet` schnitte den Überhang genauso ab wie vorher.
  expect(StyleSheet.flatten(liste.props.style).maxHeight).toBe(
    Dimensions.get('window').height * SHEET_SCROLL_ANTEIL
  );
  expect(within(liste).getAllByTestId(/^gruppe-eintrag/)).toHaveLength(12);
});

// Und der letzte führt an seinen eigenen Platz, er ist nicht bloss da,
// sondern vollständig bedienbar. f11 steht in der Spielliste an Stelle 12
// (p3 ohne Ort davor, p5 ohne URL fällt heraus).
test('auch der letzte Eintrag einer langen Liste fuehrt in den Player', async () => {
  ladeErfolg(VIELE_AUF_EINEM_FLECK, VORRAT_VIELE);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-f0'));
  await fireEvent.press(within(screen.getByTestId('gruppe-liste')).getByTestId('gruppe-eintrag-f11'));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player',
    params: { id: 't1', start: '12' },
  });
});

// Derselbe Mechanismus trifft das Einzel-Sheet: Bild (3:2), Ort und Caption
// werden bei grosser Systemschrift zusammen höher als das Sheet. Der
// Primär-Button muss deshalb AUSSERHALB des scrollenden Teils stehen,
// scrollte er mit, wäre er als Erstes weg.
test('im Moment-Sheet scrollt der Inhalt, der Knopf bleibt stehen', async () => {
  ladeErfolg(MIT_SHEET_DATEN);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));

  const inhalt = screen.getByTestId('moment-inhalt');
  expect(inhalt.type).toBe('RCTScrollView');
  expect(within(inhalt).getByTestId('sheet-bild')).toBeTruthy();
  expect(within(inhalt).getByText('Angekommen, 28 Grad im Mai')).toBeTruthy();
  expect(within(inhalt).queryByLabelText('Im Recap ansehen')).toBeNull();
  expect(screen.getByLabelText('Im Recap ansehen')).toBeTruthy();
});

// Der Wächter aus Task 8 versteckte das Sheet nur, statt es zu löschen. Beim
// Rücksprung t1 → t2 → t1 auf DERSELBEN gemounteten Instanz passte die
// Reise-id wieder, und ein Sheet öffnete sich samt Eintrittsanimation, das
// niemand angetippt hat. Sein Index stammte aus dem früheren Ladevorgang und
// konnte inzwischen auf einen anderen Moment zeigen.
test('nach t1 → t2 → t1 oeffnet sich kein Sheet von selbst', async () => {
  ladeErfolg(MIT_SHEET_DATEN);
  const { rerender } = await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(screen.getByText('Im Recap ansehen')).toBeTruthy();

  mockId = 't2';
  ladeErfolg([m1]);
  await rerender(<ThemeProvider><RecapKarte /></ThemeProvider>);
  expect(screen.queryByText('Im Recap ansehen')).toBeNull();

  mockId = 't1';
  ladeErfolg(MIT_SHEET_DATEN);
  await rerender(<ThemeProvider><RecapKarte /></ThemeProvider>);
  expect(screen.queryByText('Im Recap ansehen')).toBeNull();
  expect(screen.queryByText('Angekommen, 28 Grad im Mai')).toBeNull();
});

// DESIGN-LANGUAGE §5: «Listen = Stagger 40 ms». Ablesbar nur an den
// Verzögerungen, mit denen die Zeilen starten, `Animated` flacht die Opazität
// im Testlauf auf eine Zahl ab und rührt sie unter `useNativeDriver` nie
// wieder an (gleiche Einschränkung wie in KartenNadel.test.tsx).
// Nur die Zeilen-Einblendungen: `Sheet` animiert selbst mit, setzt dabei aber
// kein `delay`, daran lassen sich die Listenzeilen von allem anderen trennen.
function zeilenAnimationen(): { delay?: number; duration?: number }[] {
  return (Animated.timing as unknown as jest.Mock).mock.calls
    .map(([, konfig]) => konfig as { delay?: number; duration?: number })
    .filter((konfig) => konfig.delay !== undefined);
}

function staggerVerzoegerungen(): unknown[] {
  return zeilenAnimationen().map((konfig) => konfig.delay);
}

// DESIGN-LANGUAGE §5: «prefers-reduced-motion: alles wird zu 200-ms-Fades».
// Bewusst die nackte Zahl statt der (modulprivaten) Konstante aus karte.tsx:
// gegen sich selbst geprüft, wäre jeder Wert richtig, 200 steht in der
// Design-Sprache, und nur das ist die Zusicherung.
function staggerDauern(): unknown[] {
  return zeilenAnimationen().map((konfig) => konfig.duration);
}

test('die Zeilen der Gruppenliste erscheinen gestaffelt', async () => {
  const spion = jest.spyOn(Animated, 'timing');
  ladeErfolg(AUF_EINEM_FLECK);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));

  expect(staggerVerzoegerungen()).toEqual([0, 40]);
  expect(staggerDauern()).toEqual([motion.duration.base, motion.duration.base]);
  spion.mockRestore();
});

// §5: «prefers-reduced-motion: alles wird zu 200-ms-Fades», dann erscheinen
// die Zeilen gemeinsam, ohne Staffelung, und der Fade dauert 200 ms. Ohne die
// zweite Zusicherung wäre «wird zu einem 200-ms-Fade» eine Behauptung: die
// Verzögerung allein sagt nichts über die Dauer.
test('mit Reduced Motion erscheinen die Zeilen ohne Staffelung, in 200 ms', async () => {
  const spion = jest.spyOn(Animated, 'timing');
  mockReduziert = true;
  ladeErfolg(AUF_EINEM_FLECK);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));

  expect(staggerVerzoegerungen()).toEqual([0, 0]);
  expect(staggerDauern()).toEqual([200, 200]);
  spion.mockRestore();
});

// Fixrunde 1, Punkt 3: zwei Zweige, die bisher keine Zusicherung hielt.
//
// `media-urls` lässt je nach Moment die eine oder die andere URL weg (siehe
// dessen index.ts). Fehlt das mittlere Bild, nimmt das Sheet das Thumbnail,
// ohne diesen Ausweg bliebe die Fläche für solche Momente leer, obwohl ein
// Bild vorliegt.
const VORRAT_OHNE_MEDIUM = {
  ...VORRAT_OK,
  urls: new Map<string, MedienUrl>([
    ...VORRAT_OK.urls,
    ['p1', { post_id: 'p1', thumb_url: bild('p1').thumb_url } as unknown as MedienUrl],
  ]),
};

test('fehlt das mittlere Bild, zeigt das Sheet das Thumbnail', async () => {
  ladeErfolg(MIT_SHEET_DATEN, VORRAT_OHNE_MEDIUM);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(screen.getByTestId('sheet-bild').props.source.uri).toBe(bild('p1').thumb_url);
});

// Und ohne jede Bildquelle steht dort gar kein Bildknoten, sondern die ruhige
// bg-1-Fläche: eine `Image` mit `uri: null` wäre auf dem Gerät ein leerer
// Kasten, der auf etwas wartet, das nicht mehr kommt.
test('ohne jede Bildquelle zeigt das Sheet keinen Bildknoten', async () => {
  ladeErfolg(MIT_SHEET_DATEN, VORRAT_OHNE_JEDES_BILD);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(screen.queryByTestId('sheet-bild')).toBeNull();
  expect(screen.getByText('Mira · 14:32')).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Task 9: der Tagesfilter
// ---------------------------------------------------------------------------

// Ein Moment am ZWEITEN Reisetag, weit genug entfernt, dass er keine Gruppe
// mit p1/p2 bildet. Damit hat die Reise zwei Tage mit Nadeln, die
// Voraussetzung dafür, dass ein Filter überhaupt etwas zu unterscheiden hat.
const tag2M = moment({ id: 'p6', captured_at: '2026-08-11T10:00:00.000Z', lat: 38.75, lng: -9.1 });

// Spielliste (uploaded ∩ Vorrats-URL), chronologisch: p3 (ohne Ort, Stelle 0),
// p1 (Stelle 1), p2 (Stelle 2), p6 (Stelle 3). p5 fällt ohne URL heraus, p4
// lädt noch. Auf der Karte liegen also drei Nadeln: p1 und p2 an Tag 1, p6 an
// Tag 2.
//
// Wie VOLLSTAENDIG bereits chronologisch sortiert, so liefert
// `fetchRecapMomente` sie. p4 (10.08., 20:00) steht deshalb VOR p6 (11.08.),
// obwohl er ohnehin herausfällt: eine Fixture, die etwas Falsches über die
// API behauptet, ist ein Test, der eines Tages aus dem falschen Grund grün
// bleibt.
const MIT_TAGEN = [ohneUrlM, ohneOrtFrueh, mitAllem, m2, pendingM, tag2M];
const VORRAT_TAGE = {
  ...VORRAT_OK,
  urls: new Map<string, MedienUrl>([...VORRAT_OK.urls, ['p6', bild('p6')]]),
};

async function oeffneTagesfilter() {
  await fireEvent.press(screen.getByTestId('karte-tagesfilter'));
}

// Der Filter zeigt beim Öffnen der Karte die ganze Reise (Task-9-Brief).
test('der Filter zeigt zunaechst alle Tage', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  expect(await screen.findByText('Alle Tage')).toBeTruthy();
});

test('ein gewaehlter Tag duennt die Nadeln aus', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(3);

  await oeffneTagesfilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));

  expect(screen.getAllByTestId(/^karte-nadel/)).toHaveLength(1);
  expect(screen.getByTestId('karte-nadel-p6')).toBeTruthy();
  // Die Pille zeigt den aktuellen Stand, nicht mehr «Alle Tage».
  expect(screen.getByText('Tag 2')).toBeTruthy();
});

// DER Test dieses Tasks. `punkt.index` zählt in die UNGEFILTERTE Spielliste
// und geht als `start` an den Player, der Tagesfilter darf ihn nicht
// anfassen. Wer erst die Momente filtert und dann `zuKartenPunkten` auf dem
// Rest ruft, bekommt einen Index INNERHALB des Tages: p6 stünde dort auf 0,
// innerhalb der gefilterten Nadeln ebenfalls auf 0, innerhalb aller Nadeln auf
// 2 und in der rohen Momente-Liste auf 4. Nur die 3 kann aus der richtigen
// Zählung fallen, und die Nadel sitzt in JEDEM dieser Fälle richtig, der
// Fehler wäre also nur durch Nachzählen im Player zu sehen.
test('ein gewaehlter Tag aendert den Index in die Spielliste nicht', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await oeffneTagesfilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));
  await fireEvent.press(screen.getByTestId('karte-nadel-p6'));
  await fireEvent.press(screen.getByText('Im Recap ansehen'));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player',
    params: { id: 't1', start: '3' },
  });
});

// Die Gegenprobe ohne den Umweg über den Player: `zuKartenPunkten` sieht die
// GANZE Spielliste, und zwar genau einmal. Gefiltert wird danach, auf den
// fertigen Punkten.
test('gefiltert wird nach zuKartenPunkten, nicht davor', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await oeffneTagesfilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));

  expect(zuKartenPunkten).toHaveBeenCalledTimes(1);
  expect(zuKartenPunkten).toHaveBeenCalledWith([ohneOrtFrueh, mitAllem, m2, tag2M]);
});

// Der gewählte Tag ändert Nadeln UND Linie: eine Linie, die weiterhin zum
// nächsten Tag weiterzeichnet, behauptete eine Bewegung, die an diesem Tag
// nicht stattgefunden hat.
test('ein gewaehlter Tag kuerzt auch die Linie', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  expect((await screen.findByTestId('karte-linie')).props.coordinates).toHaveLength(3);

  await oeffneTagesfilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-1'));

  expect(screen.getByTestId('karte-linie').props.coordinates).toEqual([
    { latitude: 38.71, longitude: -9.14 },
    { latitude: 38.72, longitude: -9.13 },
  ]);
});

// Und der Ausschnitt zieht mit, über dieselbe Funktion, über die auch der
// Gruppen-Zoom fährt (`zeige`). Ein Tag, dessen Momente ausserhalb des
// sichtbaren Ausschnitts liegen, wäre sonst eine leere Karte.
test('ein gewaehlter Tag rueckt den Ausschnitt auf seine Momente', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await oeffneTagesfilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));

  expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);
  const [ziel, dauer] = mockAnimateToRegion.mock.calls[0];
  expect(ziel.latitude).toBeCloseTo(38.75, 4);
  expect(ziel.longitude).toBeCloseTo(-9.1, 4);
  expect(dauer).toBe(motion.duration.base);
});

// DESIGN-LANGUAGE §5: mit Reduced Motion wird gesprungen statt gefahren. Der
// Beweis, dass der Filter wirklich durch `zeige` geht und nicht an ihm vorbei,
// eine zweite Kamerabewegung neben `zeige` hätte diese Weiche nicht.
test('mit Reduced Motion springt der Ausschnitt auf den gewaehlten Tag', async () => {
  mockReduziert = true;
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await oeffneTagesfilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));

  expect(mockAnimateToRegion).not.toHaveBeenCalled();
  expect(mockSetRegion).toHaveBeenCalledTimes(1);
  const [ziel] = mockSetRegion.mock.calls[0];
  expect(ziel.latitude).toBeCloseTo(38.75, 4);
  expect(ziel.longitude).toBeCloseTo(-9.1, 4);
});

// DESIGN-LANGUAGE §5 nennt selection-Haptik für Tabs und Zoom, die Wahl
// eines Tages ist beides zugleich: eine Auswahl, die die Kamera bewegt.
test('die Wahl eines Tages meldet sich mit selection-Haptik', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await oeffneTagesfilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));

  expect(mockHaptik).toHaveBeenCalledTimes(1);
});

// Der Weg zurück muss genauso vollständig sein wie der Weg hinein: Nadeln,
// Linie und Ausschnitt.
test('«Alle Tage» bringt die ganze Reise zurueck', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await oeffneTagesfilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));
  await oeffneTagesfilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-alle'));

  expect(screen.getAllByTestId(/^karte-nadel/)).toHaveLength(3);
  expect(screen.getByText('Alle Tage')).toBeTruthy();
  // Zwei Fahrten: hinein in Tag 2, wieder heraus auf die ganze Reise.
  expect(mockAnimateToRegion).toHaveBeenCalledTimes(2);
  const [ziel] = mockAnimateToRegion.mock.calls[1];
  expect(ziel.latitude).toBeCloseTo(38.73, 4);
  expect(ziel.longitude).toBeCloseTo(-9.12, 4);
});

// Die Tagesnummern kommen aus `trips.start_date`, genau wie in uebersicht.tsx
// und player.tsx. Wer sie stattdessen ab dem ersten Moment zählte, zeigte
// dieselbe Reise an zwei Stellen mit verschiedenen Tagen.
test('die Tagesnummern zaehlen ab dem Startdatum der Reise', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE, { start_date: '2026-08-08' });
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await oeffneTagesfilter();
  expect(screen.getByTestId('tag-eintrag-3')).toBeTruthy();
  expect(screen.getByTestId('tag-eintrag-4')).toBeTruthy();
  expect(screen.queryByTestId('tag-eintrag-1')).toBeNull();
});

// Ostwärts über die Datumsgrenze: `gruppiereNachTagen` schreibt die höchste
// bisher vergebene Tagesnummer monoton fort (tage.ts, Important 1). Ein
// weggelassener Moment kann die Nummern DAHINTER also verschieben, wer nur
// die Momente MIT Ort hineingäbe, bekäme für ost1 die Nummer 2 statt 3, und
// die Karte zeigte andere Tage als die Übersicht.
//
// ost0 (Lissabon, 10.08.) ist Tag 1. ostOhneOrt liegt lokal am 12.08.
// (Asia/Tokyo) und zieht die laufende Nummer auf 3, obwohl er keine Nadel
// bekommt. ost1 ist chronologisch später, lokal aber erst der 11.08.
// (America/Los_Angeles), er landet dadurch in Tag 3, nicht in Tag 2.
const ost0 = moment({ id: 'o0', captured_at: '2026-08-10T09:00:00.000Z', lat: 38.71, lng: -9.14 });
const ostOhneOrt = moment({
  id: 'o1', captured_at: '2026-08-11T23:30:00.000Z', captured_tz: 'Asia/Tokyo', lat: null, lng: null,
});
const ost1 = moment({
  id: 'o2', captured_at: '2026-08-12T01:00:00.000Z', captured_tz: 'America/Los_Angeles',
  lat: 38.75, lng: -9.1,
});
const OSTWAERTS = [ost0, ostOhneOrt, ost1];
const VORRAT_OSTWAERTS = {
  ...VORRAT_OK,
  urls: new Map<string, MedienUrl>([['o0', bild('o0')], ['o1', bild('o1')], ['o2', bild('o2')]]),
};

test('die Tagesnummern zaehlen ueber die ganze Spielliste, nicht nur ueber die Momente mit Ort', async () => {
  ladeErfolg(OSTWAERTS, VORRAT_OSTWAERTS);
  await wrap();
  await screen.findByTestId('karte-nadel-o2');

  await oeffneTagesfilter();
  expect(screen.getByTestId('tag-eintrag-3')).toBeTruthy();
  expect(screen.queryByTestId('tag-eintrag-2')).toBeNull();
});

// Ein Tag, dessen Momente alle ohne Ort sind, führte auf eine leere Karte
// ohne Erklärung, eine Sackgasse im Filter. p3 (11.08., ohne Ort) ist genau
// so ein Tag.
const OHNE_ORT_DAZWISCHEN = [
  moment({ id: 'q1', captured_at: '2026-08-10T09:00:00.000Z', lat: 38.71, lng: -9.14 }),
  moment({ id: 'q2', captured_at: '2026-08-11T09:00:00.000Z', lat: null, lng: null }),
  moment({ id: 'q3', captured_at: '2026-08-12T09:00:00.000Z', lat: 38.75, lng: -9.1 }),
];
const VORRAT_OHNE_ORT_DAZWISCHEN = {
  ...VORRAT_OK,
  urls: new Map<string, MedienUrl>([['q1', bild('q1')], ['q2', bild('q2')], ['q3', bild('q3')]]),
};

test('ein Tag ohne Momente auf der Karte steht nicht zur Wahl', async () => {
  ladeErfolg(OHNE_ORT_DAZWISCHEN, VORRAT_OHNE_ORT_DAZWISCHEN);
  await wrap();
  await screen.findByTestId('karte-nadel-q3');

  await oeffneTagesfilter();
  expect(screen.getByTestId('tag-eintrag-1')).toBeTruthy();
  expect(screen.getByTestId('tag-eintrag-3')).toBeTruthy();
  expect(screen.queryByTestId('tag-eintrag-2')).toBeNull();
});

// Ein Filter mit genau einer Wahl ist keiner: «Alle Tage» und «Tag 1» zeigten
// dasselbe. VOLLSTAENDIG hat Nadeln nur an Tag 1 (p3 am zweiten Tag hat
// keinen Ort).
test('eine Reise mit Nadeln an einem einzigen Tag zeigt keinen Tagesfilter', async () => {
  ladeErfolg();
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  expect(screen.queryByTestId('karte-tagesfilter')).toBeNull();
});

// Der Tagesfilter ist Beiwerk, die Karte selbst hängt nicht an der
// Reise-Abfrage. Fällt nur sie aus, fehlt der Filter, nicht die Reise.
test('ohne Reise-Daten bleibt die Karte stehen, nur ohne Tagesfilter', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  (fetchTrip as jest.Mock).mockResolvedValue({ data: null, error: 'Diese Reise konnte nicht geladen werden.' });
  await wrap();

  expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(3);
  expect(screen.queryByTestId('karte-tagesfilter')).toBeNull();
});

// DESIGN-LANGUAGE §4: genau EIN Primär-Button pro Screen. Den trägt das
// Moment-Sheet («Im Recap ansehen»), der Tagesfilter macht es deshalb zu,
// statt sich darüberzulegen. (Auf dem Gerät fängt der Backdrop des offenen
// Sheets den Tipp ohnehin ab; hier steht, dass der Zustand danach eindeutig
// ist.)
test('der Tagesfilter schliesst ein offenes Moment-Sheet', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(screen.getByText('Im Recap ansehen')).toBeTruthy();

  await oeffneTagesfilter();
  expect(screen.queryByText('Im Recap ansehen')).toBeNull();
  expect(screen.getByTestId('tag-eintrag-alle')).toBeTruthy();
});

// Ein Filterstand gehört zu der Reise, in der er gewählt wurde. Bliebe er
// stehen, öffnete die NÄCHSTE Reise vorgefiltert auf einen Tag, den niemand
// gewählt hat, und weil die Tagesnummer dort zufällig existiert, sähe das
// aus wie eine Reise mit nur einem Moment.
test('ein Wechsel der Reise setzt den Tagesfilter zurueck', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  const { rerender } = await wrap();
  await oeffneTagesfilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));
  expect(screen.getAllByTestId(/^karte-nadel/)).toHaveLength(1);

  mockId = 't2';
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await rerender(<ThemeProvider><RecapKarte /></ThemeProvider>);

  expect(screen.getByText('Alle Tage')).toBeTruthy();
  expect(screen.getAllByTestId(/^karte-nadel/)).toHaveLength(3);
});

// Eine lange Reise hat viele Tage, dieselbe Sackgasse wie bei der
// Gruppenliste: `Sheet` deckelt auf 85 % Fensterhöhe und schneidet den
// Überhang hart ab (`overflow: 'hidden'`). Die letzten Tage wären dann auf
// keinem Weg mehr wählbar.
const VIELE_TAGE = Array.from({ length: 12 }, (_, i) =>
  moment({
    id: `v${i}`,
    captured_at: `2026-08-${String(10 + i).padStart(2, '0')}T09:00:00.000Z`,
    lat: 38.71 + i * 0.01,
    lng: -9.14 + i * 0.01,
  })
);
const VORRAT_VIELE_TAGE = {
  ...VORRAT_OK,
  urls: new Map<string, MedienUrl>(
    Array.from({ length: 12 }, (_, i) => [`v${i}`, bild(`v${i}`)] as const)
  ),
};

test('die Tagesliste scrollt, statt ihre letzten Tage abzuschneiden', async () => {
  ladeErfolg(VIELE_TAGE, VORRAT_VIELE_TAGE);
  await wrap();
  await screen.findByTestId('karte-nadel-v0');

  await oeffneTagesfilter();
  const liste = screen.getByTestId('tage-liste');
  expect(liste.type).toBe('RCTScrollView');
  expect(StyleSheet.flatten(liste.props.style).maxHeight).toBe(
    Dimensions.get('window').height * SHEET_SCROLL_ANTEIL
  );
  // Zwölf Tage plus «Alle Tage».
  expect(within(liste).getAllByTestId(/^tag-eintrag/)).toHaveLength(13);
  expect(within(liste).getByTestId('tag-eintrag-12')).toBeTruthy();
});

// DESIGN-LANGUAGE §5: «Listen = Stagger 40 ms», dieselbe Regel wie für die
// Gruppenliste, also dieselbe Mechanik.
test('die Zeilen der Tagesliste erscheinen gestaffelt', async () => {
  const spion = jest.spyOn(Animated, 'timing');
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await oeffneTagesfilter();
  // «Alle Tage», Tag 1, Tag 2.
  expect(staggerVerzoegerungen()).toEqual([0, 40, 80]);
  expect(staggerDauern()).toEqual([
    motion.duration.base, motion.duration.base, motion.duration.base,
  ]);
  spion.mockRestore();
});

test('mit Reduced Motion erscheinen die Zeilen der Tagesliste ohne Staffelung, in 200 ms', async () => {
  const spion = jest.spyOn(Animated, 'timing');
  mockReduziert = true;
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await oeffneTagesfilter();
  expect(staggerVerzoegerungen()).toEqual([0, 0, 0]);
  expect(staggerDauern()).toEqual([200, 200, 200]);
  spion.mockRestore();
});

// Fixrunde 1, Punkt 1: der Filter ist Beiwerk, die Nadeln SIND der Screen,
// und das muss auch für die ZEIT gelten, nicht nur für den Fehlerfall. Lägen
// alle drei Abfragen in einem `Promise.all`, hinge die Karte an einer, die für
// ihren Inhalt nichts beiträgt: bis der Ausschnitt steht, wird die `MapView`
// gar nicht erst gemountet. `fetchTrip` ist dabei nicht eine Abfrage, sondern
// zwei, es wartet intern auf die rpc `my_post_counts` mit (tripsApi.ts).
test('die Nadeln stehen, bevor die Reise-Abfrage zurueck ist', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  let reiseAufloesen: (wert: { data: Trip | null; error: string | null }) => void = () => {};
  (fetchTrip as jest.Mock).mockReturnValue(
    new Promise<{ data: Trip | null; error: string | null }>((aufloesen) => {
      reiseAufloesen = aufloesen;
    })
  );
  await wrap();

  // Karte, Nadeln und Linie stehen, obwohl die Reise-Abfrage noch offen ist.
  expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(3);
  expect(screen.getByTestId('karte-linie')).toBeTruthy();
  // Nur der Filter fehlt noch, ohne Startdatum gibt es keine Tagesnummern.
  expect(screen.queryByTestId('karte-tagesfilter')).toBeNull();

  // Und er kommt nach, sobald die Reise da ist.
  await act(async () => {
    reiseAufloesen({ data: REISE, error: null });
  });
  expect(screen.getByTestId('karte-tagesfilter')).toBeTruthy();
  expect(screen.getByText('Alle Tage')).toBeTruthy();
});

// Fixrunde 1, Punkt 2: dasselbe Wächter-Muster wie bei `sheet` und `tagWahl`,
// und hier mit einer eigenen Schärfe, das offene Sheet listet die Tage DER
// REISE, aus der es geöffnet wurde. Bliebe es stehen, filterte ein Tipp auf
// «Tag 2» die NEUE Reise auf einen Tag, den in ihr niemand gewählt hat; die
// Wahl schriebe dabei die neue id mit, der Wächter für `tagWahl` käme also nie
// zum Zug. Und `zeige` führe auf den Ausschnitt eines fremden Tages.
test('ein Wechsel der Reise laesst kein offenes Tages-Sheet der vorherigen stehen', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  const { rerender } = await wrap();
  await oeffneTagesfilter();
  expect(screen.getByTestId('tag-eintrag-2')).toBeTruthy();

  mockId = 't2';
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await rerender(<ThemeProvider><RecapKarte /></ThemeProvider>);

  // Kein Eintrag mehr, den man drücken könnte, und damit keine Filterung, die
  // von der vorherigen Reise herüberreicht.
  expect(screen.queryByTestId('tag-eintrag-2')).toBeNull();
  expect(screen.getAllByTestId(/^karte-nadel/)).toHaveLength(3);
  expect(mockAnimateToRegion).not.toHaveBeenCalled();
});

// Die Kehrseite der getrennten Ladewege (Punkt 1): sie kommen unabhängig
// zurück, und beim Wechsel der Reise gibt es ein Fenster, in dem das
// Startdatum schon zur NEUEN Reise gehört und die Momente noch zur alten. Die
// Tagesnummern daraus gäbe es in keiner der beiden.
//
// Fixrunde 1: bis dahin blieben in diesem Fenster die NADELN von t1 stehen,
// und nur der Filter fiel weg. Das war dieselbe Lücke wie beim Sheet, ein
// Tipp auf eine solche Nadel öffnete ein Sheet, das bereits `tripId: t2`
// trägt, der Wächter griff also nicht mehr, und «Im Recap ansehen» schickte
// den Player mit t1s Index in t2. Der Ladestand ist jetzt gestempelt: gehört
// er zu einer anderen Reise, ist DIESE hier schlicht noch nicht geladen.
test('ein halber Reisewechsel zeigt weder Nadeln noch Tagesnummern der vorherigen Reise', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  const { rerender } = await wrap();
  await screen.findByTestId('karte-tagesfilter');

  mockId = 't2';
  // Die Reise antwortet sofort und mit einem ANDEREN Startdatum, die Momente
  // von t2 bleiben zunächst aus.
  let momenteAufloesen: (wert: { data: RecapMoment[]; error: string | null }) => void = () => {};
  (fetchTrip as jest.Mock).mockResolvedValue({
    data: { ...REISE, id: 't2', start_date: '2026-08-08' }, error: null,
  });
  (fetchRecapMomente as jest.Mock).mockReturnValue(
    new Promise<{ data: RecapMoment[]; error: string | null }>((aufloesen) => {
      momenteAufloesen = aufloesen;
    })
  );
  (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_TAGE, error: null, grund: null });
  await rerender(<ThemeProvider><RecapKarte /></ThemeProvider>);

  // Nichts von t1 ist mehr zu sehen, kein Filter, der nur aus einer Mischung
  // entstehen könnte, und keine Nadel, die in den Player von t2 führte.
  expect(screen.queryAllByTestId(/^karte-nadel/)).toHaveLength(0);
  expect(screen.queryByTestId('karte-tagesfilter')).toBeNull();
  expect(screen.getByTestId('karte-skelett')).toBeTruthy();

  // Und sobald t2s Momente da sind, zählen die Tage ab DESSEN Startdatum
  // (08.08.): dieselben Momente ergeben Tag 3 und Tag 4, nicht Tag 1 und 2.
  await act(async () => {
    momenteAufloesen({ data: MIT_TAGEN, error: null });
  });
  await fireEvent.press(screen.getByTestId('karte-tagesfilter'));
  expect(screen.getByTestId('tag-eintrag-3')).toBeTruthy();
  expect(screen.getByTestId('tag-eintrag-4')).toBeTruthy();
  expect(screen.queryByTestId('tag-eintrag-1')).toBeNull();
});

// Die Pille ist auf der Karte der einzige Hinweis auf den Filterstand, für
// VoiceOver muss sie sagen, was sie zeigt UND was ein Tipp tut.
test('der Tagesfilter sagt per VoiceOver, welcher Tag gerade gilt', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  expect(await screen.findByLabelText('Reisetag wählen, aktuell Alle Tage')).toBeTruthy();

  await oeffneTagesfilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));
  expect(screen.getByLabelText('Reisetag wählen, aktuell Tag 2')).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Task 10: die Momente ohne Ort, und die drei Zustände, die bisher gleich
// aussahen
// ---------------------------------------------------------------------------

function ohneOrtMoment(id: string, stunde: number) {
  return moment({
    id,
    captured_at: `2026-08-10T${String(stunde).padStart(2, '0')}:00:00.000Z`,
    lat: null,
    lng: null,
  });
}

// Eine Reise, in der KEINE zwei Zählungen zusammenfallen. k5 steht
//
//   - in der Spielliste an Stelle 5   ← die einzig richtige Zahl
//   - unter den Momenten ohne Ort an Stelle 2
//   - in der rohen Momente-Liste an Stelle 7
//   - unter den Nadeln gar nicht
//
// Nur die 5 kann also aus der richtigen Zählung fallen, jede andere Zahl
// verrät sofort, aus welcher Liste heraus gezählt wurde.
const k0 = ohneOrtMoment('k0', 9);
const k1 = moment({ id: 'k1', captured_at: '2026-08-10T10:00:00.000Z', lat: 38.71, lng: -9.14 });
const k2 = ohneOrtMoment('k2', 11);
const k3 = moment({ id: 'k3', captured_at: '2026-08-10T12:00:00.000Z', lat: 38.72, lng: -9.13 });
const k4 = moment({ id: 'k4', captured_at: '2026-08-10T13:00:00.000Z', lat: 38.75, lng: -9.1 });
const k5 = ohneOrtMoment('k5', 14);
// Vorne dran, damit die rohe Liste um zwei verschoben ist: ohneUrlM (07:00,
// hochgeladen, aber ohne URL im Vorrat) und k9 (08:00, lädt noch, MIT URL,
// damit ihn wirklich nur `upload_status` aussortiert).
const k9 = moment({
  id: 'k9', captured_at: '2026-08-10T08:00:00.000Z', lat: 38.7, lng: -9.15, upload_status: 'pending',
});
const DREI_OHNE_ORT = [ohneUrlM, k9, k0, k1, k2, k3, k4, k5];
const VORRAT_DREI = {
  ...VORRAT_OK,
  urls: new Map<string, MedienUrl>(
    ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k9'].map((id) => [id, bild(id)] as const)
  ),
};

// Dieselbe Reise, wie sie eine Abfrage OHNE Sortiergarantie liefern könnte.
// `fetchRecapMomente` sortiert heute selbst (recapApi.ts), genau deshalb
// fiele es nirgends auf, wenn der Index eines Moments ohne Ort aus der
// Eingangsreihenfolge käme statt aus der sortierten Spielliste.
const DREI_OHNE_ORT_UNSORTIERT = [k5, k2, ohneUrlM, k3, k0, k9, k4, k1];

async function oeffneOhneOrt() {
  await fireEvent.press(screen.getByText('3 Momente ohne Ort'));
}

test('die Leiste nennt die Momente ohne Ort', async () => {
  ladeErfolg(DREI_OHNE_ORT, VORRAT_DREI);
  await wrap();
  expect(await screen.findByText('3 Momente ohne Ort')).toBeTruthy();
});

// VOLLSTAENDIG hat genau einen Moment ohne Ort (p3).
test('ein einzelner Moment ohne Ort steht im Singular', async () => {
  ladeErfolg();
  await wrap();
  expect(await screen.findByText('1 Moment ohne Ort')).toBeTruthy();
});

test('ohne solche Momente gibt es keine Leiste', async () => {
  ladeErfolg(NAH_BEIEINANDER);
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  expect(screen.queryByText(/ohne Ort/)).toBeNull();
});

// ---------------------------------------------------------------------------
// Abschluss-Review, Finding 2: Momente, die diese Karte GAR NICHT hergibt
// ---------------------------------------------------------------------------
//
// Der Ladeweg filtert auf `uploaded && urls.has`, und das bleibt so, denn
// `punkt.index` muss zur Spielliste passen. Wer dabei herausfällt, bekam aber
// weder eine Nadel noch einen Platz in «N Momente ohne Ort»: die Rechnung auf
// dem Screen ging nicht auf, und niemand konnte sehen, warum.
//
// VOLLSTAENDIG enthält genau einen von jeder Sorte: p4 lädt noch hoch, p5 hat
// eine Koordinate, aber keine URL im Vorrat.
test('Momente, die noch hochladen, werden benannt statt still zu fehlen', async () => {
  ladeErfolg();
  await wrap();
  expect(await screen.findByText('1 Moment ist noch unterwegs.')).toBeTruthy();
});

test('Momente ohne Bild-URL werden benannt statt still zu fehlen', async () => {
  ladeErfolg();
  await wrap();
  expect(
    await screen.findByText('1 Moment liess sich gerade nicht laden. Schau später nochmal rein.')
  ).toBeTruthy();
});

// Die Auskunft ist KEIN Knopf: zu diesen Momenten führt von der Karte aus kein
// Weg, sie stehen in keiner Spielliste, also zeigt auch kein Index auf sie.
test('die Auskunft über fehlende Momente faengt keinen Tipp ab', async () => {
  ladeErfolg();
  await wrap();
  expect(
    (await screen.findByTestId('karte-fehlen-ganz')).props.pointerEvents
  ).toBe('none');
});

test('eine vollstaendige Reise behauptet nichts dergleichen', async () => {
  ladeErfolg(NAH_BEIEINANDER, { ...VORRAT_OK, ausgelassen: 0 });
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  expect(screen.queryByTestId('karte-fehlen-ganz')).toBeNull();
  expect(screen.queryByText(/noch unterwegs/)).toBeNull();
  expect(screen.queryByText(/nicht laden/)).toBeNull();
});

test('die Leiste oeffnet ein Sheet mit einer Kachel je Moment ohne Ort', async () => {
  ladeErfolg(DREI_OHNE_ORT, VORRAT_DREI);
  await wrap();
  await screen.findByText('3 Momente ohne Ort');
  await oeffneOhneOrt();

  expect(screen.getAllByTestId(/^ohne-ort-kachel/)).toHaveLength(3);
  expect(screen.getByTestId('ohne-ort-kachel-k0')).toBeTruthy();
  expect(screen.getByTestId('ohne-ort-kachel-k2')).toBeTruthy();
  expect(screen.getByTestId('ohne-ort-kachel-k5')).toBeTruthy();
});

// Dieselbe Kachel-Liste wie in der Übersicht (Spec §5.8) heisst auch:
// dasselbe Bild. Ein über den Index statt über die id gegriffener Vorrat
// zeigte hier das Bild eines fremden Moments.
test('jede Kachel traegt das Thumbnail ihres eigenen Moments', async () => {
  ladeErfolg(DREI_OHNE_ORT, VORRAT_DREI);
  await wrap();
  await screen.findByText('3 Momente ohne Ort');
  await oeffneOhneOrt();

  const kachel = screen.getByTestId('ohne-ort-kachel-k2');
  expect(within(kachel).getByTestId('ohne-ort-bild-k2').props.source.uri).toBe(bild('k2').thumb_url);
});

// DER Test dieses Tasks. `start` zählt in die SPIELLISTE (player.tsx:503-527),
// nie in `ohneOrt`, nie in die rohe Momente-Liste. k5 trennt alle drei
// Zahlen voneinander (siehe Fixture oben).
test('aus dem Sheet fuehrt der Weg in den Player', async () => {
  ladeErfolg(DREI_OHNE_ORT, VORRAT_DREI);
  await wrap();
  await screen.findByText('3 Momente ohne Ort');
  await oeffneOhneOrt();
  await fireEvent.press(screen.getByTestId('ohne-ort-kachel-k5'));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player',
    params: { id: 't1', start: '5' },
  });
});

// Und der Index kommt aus der SORTIERTEN Spielliste, nicht aus der
// Reihenfolge, in der die Momente hereinkamen, dieselbe Reihenfolge, in der
// `zuKartenPunkten` die Indizes der Nadeln vergibt. Käme er aus der
// Eingangsliste, stünde k5 hier auf 0 (die Nadeln sässen trotzdem richtig).
test('der Index eines Moments ohne Ort haengt nicht an der Eingangsreihenfolge', async () => {
  ladeErfolg(DREI_OHNE_ORT_UNSORTIERT, VORRAT_DREI);
  await wrap();
  await screen.findByText('3 Momente ohne Ort');
  await oeffneOhneOrt();
  await fireEvent.press(screen.getByTestId('ohne-ort-kachel-k5'));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player',
    params: { id: 't1', start: '5' },
  });
});

// Die Leiste zählt die ganze Reise, nicht den gewählten Tag. Ein Moment ohne
// Ort liegt auf KEINEM Tag der Karte, und ein Tag, dessen Momente alle ohne
// Ort sind, steht gar nicht erst zur Wahl (siehe `waehlbareTage`). Würde die
// Leiste mitfiltern, wären genau diese Momente auf keinem Weg mehr
// erreichbar.
test('der Tagesfilter duennt die Momente ohne Ort nicht aus', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  expect(await screen.findByText('1 Moment ohne Ort')).toBeTruthy();

  await oeffneTagesfilter();
  await fireEvent.press(screen.getByTestId('tag-eintrag-2'));

  // p3 (ohne Ort) liegt an Tag 1, die Leiste nennt ihn trotzdem.
  expect(screen.getByText('1 Moment ohne Ort')).toBeTruthy();
});

// Dieselbe Sackgasse wie bei Gruppen- und Tagesliste: `Sheet` deckelt auf
// 85 % Fensterhöhe und schneidet den Überhang hart ab (`overflow: 'hidden'`).
const VIELE_OHNE_ORT = [
  moment({ id: 'w0', captured_at: '2026-08-10T08:00:00.000Z', lat: 38.71, lng: -9.14 }),
  ...Array.from({ length: 12 }, (_, i) => ohneOrtMoment(`w${i + 1}`, 9 + i)),
];
const VORRAT_VIELE_OHNE_ORT = {
  ...VORRAT_OK,
  urls: new Map<string, MedienUrl>(
    Array.from({ length: 13 }, (_, i) => [`w${i}`, bild(`w${i}`)] as const)
  ),
};

test('die Kachel-Liste scrollt, statt ihre letzten Momente abzuschneiden', async () => {
  ladeErfolg(VIELE_OHNE_ORT, VORRAT_VIELE_OHNE_ORT);
  await wrap();
  await fireEvent.press(await screen.findByText('12 Momente ohne Ort'));

  const liste = screen.getByTestId('ohne-ort-liste');
  expect(liste.type).toBe('RCTScrollView');
  expect(StyleSheet.flatten(liste.props.style).maxHeight).toBe(
    Dimensions.get('window').height * SHEET_SCROLL_ANTEIL
  );
  expect(within(liste).getAllByTestId(/^ohne-ort-kachel/)).toHaveLength(12);
});

// Und der letzte ist nicht bloss da, sondern führt an seinen eigenen Platz:
// w12 steht in der Spielliste an Stelle 12.
test('auch die letzte Kachel fuehrt in den Player', async () => {
  ladeErfolg(VIELE_OHNE_ORT, VORRAT_VIELE_OHNE_ORT);
  await wrap();
  await fireEvent.press(await screen.findByText('12 Momente ohne Ort'));
  await fireEvent.press(within(screen.getByTestId('ohne-ort-liste')).getByTestId('ohne-ort-kachel-w12'));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player',
    params: { id: 't1', start: '12' },
  });
});

// DESIGN-LANGUAGE §5: «Listen = Stagger 40 ms», dieselbe Regel wie für
// Gruppen- und Tagesliste, also dieselbe Mechanik.
test('die Kacheln der Momente ohne Ort erscheinen gestaffelt', async () => {
  const spion = jest.spyOn(Animated, 'timing');
  ladeErfolg(DREI_OHNE_ORT, VORRAT_DREI);
  await wrap();
  await screen.findByText('3 Momente ohne Ort');
  await oeffneOhneOrt();

  expect(staggerVerzoegerungen()).toEqual([0, 40, 80]);
  expect(staggerDauern()).toEqual([
    motion.duration.base, motion.duration.base, motion.duration.base,
  ]);
  spion.mockRestore();
});

test('mit Reduced Motion erscheinen die Kacheln ohne Staffelung, in 200 ms', async () => {
  const spion = jest.spyOn(Animated, 'timing');
  mockReduziert = true;
  ladeErfolg(DREI_OHNE_ORT, VORRAT_DREI);
  await wrap();
  await screen.findByText('3 Momente ohne Ort');
  await oeffneOhneOrt();

  expect(staggerVerzoegerungen()).toEqual([0, 0, 0]);
  expect(staggerDauern()).toEqual([200, 200, 200]);
  spion.mockRestore();
});

// Gleiche Schärfe wie beim Moment-Sheet: ein Sheet der VORHERIGEN Reise
// schickte den Player mit deren Index in die neue, wo dieselbe Zahl auf einen
// ganz anderen Moment zeigt.
test('ein Wechsel der Reise laesst kein offenes Sheet der Momente ohne Ort stehen', async () => {
  ladeErfolg(DREI_OHNE_ORT, VORRAT_DREI);
  const { rerender } = await wrap();
  await screen.findByText('3 Momente ohne Ort');
  await oeffneOhneOrt();
  expect(screen.getByTestId('ohne-ort-kachel-k5')).toBeTruthy();

  mockId = 't2';
  ladeErfolg(DREI_OHNE_ORT, VORRAT_DREI);
  await rerender(<ThemeProvider><RecapKarte /></ThemeProvider>);

  expect(screen.queryByTestId('ohne-ort-kachel-k5')).toBeNull();
});

// DESIGN-LANGUAGE §4: höchstens ein Sheet, und damit höchstens ein
// Primär-Button gleichzeitig sichtbar (siehe `oeffneTagesfilter`).
test('die Leiste schliesst ein offenes Moment-Sheet', async () => {
  ladeErfolg(DREI_OHNE_ORT, VORRAT_DREI);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-k1'));
  expect(screen.getByText('Im Recap ansehen')).toBeTruthy();

  await oeffneOhneOrt();
  expect(screen.queryByText('Im Recap ansehen')).toBeNull();
  expect(screen.getByTestId('ohne-ort-kachel-k5')).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Task 10: «lädt noch» ≠ «konnte nicht laden» ≠ «keine Orte»
// ---------------------------------------------------------------------------

// Bis Task 10 sahen alle drei gleich aus: eine weisse Fläche mit Zurück-Pille.
// Ein Deep Link auf eine fremde Reise war von einer Reise ohne Orte nicht zu
// unterscheiden.
test('vor der ersten Antwort steht ein Skelett, nicht die Erklaerung', async () => {
  (fetchRecapMomente as jest.Mock).mockReturnValue(new Promise(() => {}));
  (holeVorrat as jest.Mock).mockReturnValue(new Promise(() => {}));
  await wrap();

  expect(screen.getByTestId('karte-skelett')).toBeTruthy();
  expect(screen.queryByText('Diese Reise hat keine Orte')).toBeNull();
  expect(screen.queryByTestId('karte-flaeche')).toBeNull();
});

// Fixrunde 1, Important 2: weder `urlVorrat.ts` noch `recapApi.ts` kennen
// Timeout oder AbortController. Hängt eine der beiden, ist das Skelett ohne
// Rückweg eine Sackgasse, die Karte ist, anders als die Übersicht, keine
// Tab-Wurzel, sondern per `push` erreicht.
test('auch im Ladezustand fuehrt ein Weg zurueck', async () => {
  (fetchRecapMomente as jest.Mock).mockReturnValue(new Promise(() => {}));
  (holeVorrat as jest.Mock).mockReturnValue(new Promise(() => {}));
  await wrap();

  await fireEvent.press(screen.getByLabelText('Zurück'));
  expect(mockBack).toHaveBeenCalled();
});

test('ein Ladefehler nennt seinen Grund, statt wie eine Reise ohne Orte auszusehen', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [], error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({
    vorrat: null, error: 'Kein Zugriff auf diese Reise.', grund: 'kein_zugriff',
  });
  await wrap();

  expect(await screen.findByText('Kein Zugriff auf diese Reise.')).toBeTruthy();
  expect(screen.queryByText('Diese Reise hat keine Orte')).toBeNull();
  expect(screen.getByText('Nochmal versuchen')).toBeTruthy();
});

// Der zweite Fehlerwert desselben Ladewegs, eigener Test, weil ihn allein
// sein Fehlen rot machen muss (dieselbe Regel wie bei den beiden Filtern der
// Spielliste).
test('auch ein Fehler der Momente-Abfrage bleibt nicht stumm', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({
    data: [], error: 'Die Momente konnten nicht geladen werden. Probier es gleich nochmal.',
  });
  (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
  await wrap();

  expect(
    await screen.findByText('Die Momente konnten nicht geladen werden. Probier es gleich nochmal.')
  ).toBeTruthy();
  expect(screen.queryByText('Diese Reise hat keine Orte')).toBeNull();
});

// Wirft eine der beiden Abfragen (statt den Fehler zurückzugeben), gibt es
// keinen Text vom Server, der Screen muss trotzdem sagen, was los ist.
test('wirft der Ladeweg, erklaert der Screen das trotzdem', async () => {
  (fetchRecapMomente as jest.Mock).mockRejectedValue(new Error('kaputt'));
  (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
  await wrap();

  expect(
    await screen.findByText('Die Karte konnte nicht geladen werden. Probier es gleich nochmal.')
  ).toBeTruthy();
  expect(screen.queryByText('Diese Reise hat keine Orte')).toBeNull();
});

test('«Nochmal versuchen» holt die Karte zurueck', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [], error: 'Gerade keine Verbindung.' });
  (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
  await wrap();
  await screen.findByText('Gerade keine Verbindung.');

  ladeErfolg();
  await fireEvent.press(screen.getByText('Nochmal versuchen'));

  expect(await screen.findByTestId('karte-nadel-p1')).toBeTruthy();
  expect(screen.queryByText('Gerade keine Verbindung.')).toBeNull();
});

// Spec §5.9, wörtlich: Überschrift, Erklärung, genau ein Knopf.
test('hat kein Moment einen Ort, erklaert der Screen das', async () => {
  ladeErfolg([m3]);
  await wrap();

  expect(await screen.findByText('Diese Reise hat keine Orte')).toBeTruthy();
  expect(
    screen.getByText(
      'Momente bekommen ihren Ort beim Einsenden, aber nur, wenn die Ortungsdienste erlaubt sind. Für diese Reise war das nie der Fall.'
    )
  ).toBeTruthy();
  expect(screen.queryByTestId(/^karte-nadel/)).toBeNull();
});

// Fixrunde 1, Important 3: «kein Moment hat einen Ort» und «es gibt gar keine
// Momente» sind nicht dasselbe. Eine Reise, in der niemand eingesendet hat,
// bekäme sonst den Satz über die Ortungsdienste zu lesen, eine Behauptung
// über etwas, das nie stattgefunden hat.
test('eine Reise ohne jeden Moment redet nicht von Ortungsdiensten', async () => {
  ladeErfolg([]);
  await wrap();

  expect(await screen.findByText('Diese Reise ist leer geblieben.')).toBeTruthy();
  expect(screen.queryByText('Diese Reise hat keine Orte')).toBeNull();
  expect(screen.queryByText(/Ortungsdienste/)).toBeNull();
  expect(screen.queryByTestId('karte-flaeche')).toBeNull();
});

// Die Gegenprobe: sobald es Momente gibt, die nur keinen Ort haben, gilt
// wieder Spec §5.9.
test('eine Reise mit Momenten ohne Ort redet nicht von einer leeren Reise', async () => {
  ladeErfolg([m3]);
  await wrap();

  expect(await screen.findByText('Diese Reise hat keine Orte')).toBeTruthy();
  expect(screen.queryByText('Diese Reise ist leer geblieben.')).toBeNull();
});

// Ein Moment, der noch hochlädt, ist für die Karte kein Moment: er steht
// nicht in der Spielliste. Der Screen darf ihn also nicht als «hat keine
// Orte» ausgeben, obwohl er sogar Koordinaten trägt.
test('eine Reise, deren Momente alle noch unterwegs sind, gilt als leer', async () => {
  ladeErfolg([pendingM]);
  await wrap();

  expect(await screen.findByText('Diese Reise ist leer geblieben.')).toBeTruthy();
  expect(screen.queryByText('Diese Reise hat keine Orte')).toBeNull();
});

// DESIGN-LANGUAGE §4: genau EIN Primär-Button pro Screen, und §7: nie mehr
// als einer. Im Leer-Zustand ist er der einzige Bedienelement überhaupt, das
// lässt sich hier vollständig nachzählen statt bloss behaupten.
test('der Leer-Zustand traegt genau einen Knopf', async () => {
  ladeErfolg([m3]);
  await wrap();
  await screen.findByText('Diese Reise hat keine Orte');

  expect(screen.getAllByRole('button').map((k) => k.props.accessibilityLabel)).toEqual([
    'Zurück zur Übersicht',
  ]);
});

test('der eine Knopf des Leer-Zustands fuehrt zurueck', async () => {
  ladeErfolg([m3]);
  await wrap();
  await fireEvent.press(await screen.findByText('Zurück zur Übersicht'));
  expect(mockBack).toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Fixrunde 1: der Ladestand gehört zu EINER Reise
// ---------------------------------------------------------------------------
//
// `phase`, `punkte` und `ohneOrt` waren die einzigen States dieser Datei ohne
// Reise-Stempel. Der Screen bleibt beim Wechsel der id gemountet, und die
// neuen Momente brauchen ihre Zeit, in genau diesem Fenster stand der
// Ladestand von t1 über t2. Nicht einen Frame lang, sondern die volle
// Ladedauer.

// Startet t1, wechselt auf t2 und lässt dessen Momente offen. Zurück kommt
// der Zustand GENAU in diesem Fenster.
async function wechsleAufHaengendesT2(rerender: (baum: React.ReactElement) => Promise<void>) {
  mockId = 't2';
  (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...REISE, id: 't2' }, error: null });
  (fetchRecapMomente as jest.Mock).mockReturnValue(new Promise(() => {}));
  (holeVorrat as jest.Mock).mockReturnValue(new Promise(() => {}));
  await rerender(<ThemeProvider><RecapKarte /></ThemeProvider>);
}

test('der Leer-Zustand von t1 steht nicht ueber t2', async () => {
  ladeErfolg([m3]);
  const { rerender } = await wrap();
  await screen.findByText('Diese Reise hat keine Orte');

  await wechsleAufHaengendesT2(rerender);

  expect(screen.queryByText('Diese Reise hat keine Orte')).toBeNull();
  expect(screen.getByTestId('karte-skelett')).toBeTruthy();
});

test('der Fehler von t1 steht nicht ueber t2', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [], error: 'Kein Zugriff auf diese Reise.' });
  (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
  const { rerender } = await wrap();
  await screen.findByText('Kein Zugriff auf diese Reise.');

  await wechsleAufHaengendesT2(rerender);

  expect(screen.queryByText('Kein Zugriff auf diese Reise.')).toBeNull();
  expect(screen.queryByText('Nochmal versuchen')).toBeNull();
  expect(screen.getByTestId('karte-skelett')).toBeTruthy();
});

// Der gefährlichste der drei: die Leiste von t1 über t2 ist nicht nur falsch
// beschriftet. Ein jetzt geöffnetes Sheet trägt bereits `tripId: t2`, der
// Wächter greift also nicht, und eine Kachel schickte den Player mit t1s
// Index in t2.
test('die Leiste von t1 steht nicht ueber t2', async () => {
  ladeErfolg();
  const { rerender } = await wrap();
  await screen.findByText('1 Moment ohne Ort');

  await wechsleAufHaengendesT2(rerender);

  expect(screen.queryByText(/ohne Ort/)).toBeNull();
  expect(screen.getByTestId('karte-skelett')).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Task 10: die beiden stillen Ladepfade
// ---------------------------------------------------------------------------

// Der Fehler der Reise-Abfrage wurde bisher vollständig verworfen. Sichtbar
// wird er weiterhin nicht (der Filter ist Beiwerk, die Nadeln SIND der
// Screen), aber er darf nicht spurlos verschwinden.
test('faellt die Reise-Abfrage aus, hinterlaesst sie wenigstens eine Spur', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  (fetchTrip as jest.Mock).mockResolvedValue({
    data: null, error: 'Diese Reise konnte nicht geladen werden.',
  });
  await wrap();
  await screen.findAllByTestId(/^karte-nadel/);

  expect(meldeFehler).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'Diese Reise konnte nicht geladen werden.' }),
    { screen: 'recap/karte', tripId: 't1', ladeweg: 'reise' }
  );
});

test('eine geglueckte Reise-Abfrage meldet nichts', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  await screen.findByTestId('karte-tagesfilter');
  expect(meldeFehler).not.toHaveBeenCalled();
});

// Die Nummernlücke: OHNE_ORT_DAZWISCHEN hat an Tag 2 nur Momente ohne Ort.
// Die Übersicht zeigt diesen Tag, der Kartenfilter springt von 1 auf 3, ohne
// eine Zeile dazu sieht das nach einem Fehler aus.
test('die Luecke in den Tagesnummern wird erklaert', async () => {
  ladeErfolg(OHNE_ORT_DAZWISCHEN, VORRAT_OHNE_ORT_DAZWISCHEN);
  await wrap();
  await screen.findByTestId('karte-nadel-q3');

  await oeffneTagesfilter();
  expect(screen.queryByTestId('tag-eintrag-2')).toBeNull();
  expect(
    screen.getByText('Tage, an denen kein Moment einen Ort hat, stehen nicht zur Wahl.')
  ).toBeTruthy();
});

// Und nur dann: eine lückenlose Liste erklärt nichts, was niemand gefragt hat.
test('ohne Luecke steht die Zeile nicht da', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  await screen.findByTestId('karte-nadel-p6');

  await oeffneTagesfilter();
  expect(screen.getByTestId('tag-eintrag-1')).toBeTruthy();
  expect(screen.getByTestId('tag-eintrag-2')).toBeTruthy();
  expect(screen.queryByText(/stehen nicht zur Wahl/)).toBeNull();
});

// ---------------------------------------------------------------------------
// Task 12: die Review-Checkliste aus DESIGN-LANGUAGE §9
// ---------------------------------------------------------------------------

// §9, Punkt 6: «Genau ein Primär-Button pro Screen», §7 verbietet ausdrücklich
// mehr als einen. Das lässt sich am Quelltext nicht abzählen: dieser Screen hat
// NEUN sichtbare Zustände, und jeder rendert einen anderen Baum, lädt, Fehler,
// die beiden Leer-Fälle, die Karte selbst und die Karte noch einmal mit jedem
// der vier Sheets. Ein Blick in die JSX zeigt nur, wo `Button` steht, nicht,
// welche davon gleichzeitig auf dem Schirm sind.
//
// Erkannt wird der Primär-Button an seiner Signatur aus components/Button.tsx:
// eine randlose Fläche in Höhe 52 in einer der drei Farben, die ein
// Primär-Button annehmen kann. Nicht an der Beschriftung, die liesse sich
// ändern, ohne dass hier etwas auffiele. Nicht an der Farbe allein: die
// Zähler-Pille der Nadel trägt `accent` ebenfalls (KartenNadel.tsx), aber Höhe
// 20. Und nicht an der Höhe allein: der Sekundär-Button ist ebenfalls 52 hoch.
//
// Die DREI Farben, nicht nur `accent` (Task-12-Nachtrag): `Button.tsx` färbt
// die Fläche bei `pressed` in `accent-pressed` und bei `blocked` (disabled
// ODER loading) in `bg-1`. Ein LADENDER Primär-Button, «Nochmal versuchen»
// während des zweiten Anlaufs, wurde damit gar nicht erkannt, und die
// Zusicherung «genau einer pro Screen» trug für den Zustand nicht, in dem sie
// am ehesten kippt. Der Rand grenzt gegen den Sekundär-Button ab: der trägt
// `bg-0`/`bg-1` und IMMER `borderWidth: 1`, der Primär-Button nie einen.
const PRIMAER_FLAECHEN: readonly (string | undefined)[] = [
  palette.accent,
  palette['accent-pressed'],
  palette['bg-1'],
];

type Knoten = ReturnType<typeof screen.queryAllByRole>[number];

function traegtAkzentflaeche(knoten: Knoten): boolean {
  return (
    knoten.queryAll((kind) => {
      const stil = StyleSheet.flatten(kind.props.style as StyleProp<ViewStyle>) as
        | ViewStyle
        | undefined;
      if (stil?.height !== 52) return false;
      if (stil.borderWidth) return false;
      return PRIMAER_FLAECHEN.includes(stil.backgroundColor as string | undefined);
    }).length > 0
  );
}

function primaerKnoepfe(): unknown[] {
  return screen
    .queryAllByRole('button')
    .filter(traegtAkzentflaeche)
    .map((knopf) => knopf.props.accessibilityLabel);
}

function haengenderLadeweg() {
  (fetchRecapMomente as jest.Mock).mockReturnValue(new Promise(() => {}));
  (holeVorrat as jest.Mock).mockReturnValue(new Promise(() => {}));
}

test('§9: der Ladezustand traegt keinen Primaer-Button', async () => {
  haengenderLadeweg();
  await wrap();
  expect(screen.getByTestId('karte-skelett')).toBeTruthy();
  expect(primaerKnoepfe()).toEqual([]);
});

test('§9: der Fehler-Zustand traegt genau einen Primaer-Button', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [], error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({
    vorrat: null, error: 'Kein Zugriff auf diese Reise.', grund: 'kein_zugriff',
  });
  await wrap();
  await screen.findByText('Kein Zugriff auf diese Reise.');
  expect(primaerKnoepfe()).toEqual(['Nochmal versuchen']);
});

// Und derselbe Knopf, WÄHREND er lädt. `Button.tsx` färbt die Fläche bei
// `blocked` (disabled oder loading) auf `bg-1`, bis zu diesem Nachtrag erkannte
// der Detektor oben ihn dann nicht mehr, und die Zusicherung «genau einer pro
// Screen» galt ausgerechnet für den Zustand nicht, in dem ein zweiter Knopf
// dazukäme, ohne dass es auffiele.
test('§9: auch ein ladender Primaer-Button zaehlt als Primaer-Button', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [], error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({
    vorrat: null, error: 'Kein Zugriff auf diese Reise.', grund: 'kein_zugriff',
  });
  await wrap();
  await screen.findByText('Kein Zugriff auf diese Reise.');

  // Der zweite Anlauf hängt: der Knopf bleibt im Ladezustand stehen.
  haengenderLadeweg();
  await fireEvent.press(screen.getByLabelText('Nochmal versuchen'));

  expect(screen.getByTestId('button-loading')).toBeTruthy();
  expect(primaerKnoepfe()).toEqual(['Nochmal versuchen']);
});

test('§9: die leere Reise traegt genau einen Primaer-Button', async () => {
  ladeErfolg([]);
  await wrap();
  await screen.findByText('Diese Reise ist leer geblieben.');
  expect(primaerKnoepfe()).toEqual(['Zurück zur Übersicht']);
});

test('§9: die Reise ohne Orte traegt genau einen Primaer-Button', async () => {
  ladeErfolg([m3]);
  await wrap();
  await screen.findByText('Diese Reise hat keine Orte');
  expect(primaerKnoepfe()).toEqual(['Zurück zur Übersicht']);
});

// Die Karte selbst hat KEINEN: sie ist ein Werkzeug zum Finden, keine
// Entscheidung. Rückweg, Tagesfilter und die Leiste der Momente ohne Ort sind
// translucente Pillen (§1), kein Knopf darunter trägt eine accent-Fläche.
test('§9: die Karte selbst traegt keinen Primaer-Button', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  expect(primaerKnoepfe()).toEqual([]);
});

test('§9: mit offenem Moment-Sheet ist es genau einer', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(primaerKnoepfe()).toEqual(['Im Recap ansehen']);
});

// Die drei übrigen Sheets bringen bewusst keinen mit, sonst stünden zwei
// gleichzeitig da, sobald eines davon über der Karte liegt.
test('§9: das Gruppen-Sheet bringt keinen zweiten dazu', async () => {
  ladeErfolg(AUF_EINEM_FLECK);
  await wrap();
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(screen.getByTestId('gruppe-liste')).toBeTruthy();
  expect(primaerKnoepfe()).toEqual([]);
});

test('§9: das Tages-Sheet bringt keinen zweiten dazu', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  await screen.findByTestId('karte-tagesfilter');
  await oeffneTagesfilter();
  expect(screen.getByTestId('tag-eintrag-alle')).toBeTruthy();
  expect(primaerKnoepfe()).toEqual([]);
});

test('§9: das Sheet der Momente ohne Ort bringt keinen zweiten dazu', async () => {
  ladeErfolg(DREI_OHNE_ORT, VORRAT_DREI);
  await wrap();
  await screen.findByText('3 Momente ohne Ort');
  await oeffneOhneOrt();
  expect(screen.getAllByTestId(/^ohne-ort-kachel/)).toHaveLength(3);
  expect(primaerKnoepfe()).toEqual([]);
});

// Der eine Verstoss, den die §9-Durchsicht gefunden hat, die Gegenrichtung zu
// «der Tagesfilter schliesst ein offenes Moment-Sheet».
//
// `oeffneTagesfilter` räumt das Moment-Sheet weg und begründet das ausdrücklich
// damit, dass der Zustand eindeutig sein soll, STATT an der Trefferreihenfolge
// der Backdrops zu hängen. `aufNadel` räumte dagegen nur das Sheet der Momente
// ohne Ort und liess das Tages-Sheet stehen: zwei Sheets gleichzeitig, also
// zwei Backdrops (`backdrop`, tokens.ts, rgba(0,0,0,0.4)) übereinander, die
// zusammen auf rund 0.64 abdunkeln. Diesen Wert gibt kein Token her (§9,
// Punkt 3), und dazu lägen zwei `shadow-3`-Panels aufeinander, von denen ein
// Wisch nur das obere schliesst (§9, Punkt 5).
test('§9: ein Tipp auf eine Nadel schliesst ein offenes Tages-Sheet', async () => {
  ladeErfolg(MIT_TAGEN, VORRAT_TAGE);
  await wrap();
  await screen.findByTestId('karte-nadel-p1');
  await oeffneTagesfilter();
  expect(screen.getByTestId('tag-eintrag-alle')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('karte-nadel-p1'));

  expect(screen.getByText('Im Recap ansehen')).toBeTruthy();
  expect(screen.queryByTestId('tag-eintrag-alle')).toBeNull();
  // Die eigentliche Zusicherung: EIN Panel, nicht zwei.
  expect(screen.getAllByTestId('sheet-panel')).toHaveLength(1);
});

// §9, Punkt 8: «prefers-reduced-motion respektiert», und zwar überall, nicht
// nur bei der Kamera. Der Skelett-Puls ist die einzige Bewegung dieses Screens,
// die ohne jedes Zutun läuft, und bis Task 12 hielt sie keine Zusicherung.
//
// Ablesbar ist sie nur daran, OB eine Schleife startet: `Animated` flacht die
// Opazität unter `useNativeDriver` in Jest auf eine Zahl ab und rührt sie nie
// wieder an (gleiche Begründung wie in components/__tests__/KartenNadel.test.tsx).
test('§9: das Skelett pulst, solange die Karte laedt', async () => {
  const spion = jest.spyOn(Animated, 'loop');
  haengenderLadeweg();
  await wrap();
  expect(screen.getByTestId('karte-skelett')).toBeTruthy();
  expect(spion).toHaveBeenCalled();
  spion.mockRestore();
});

test('§9: mit Reduced Motion steht das Skelett still, statt zu pulsen', async () => {
  const spion = jest.spyOn(Animated, 'loop');
  mockReduziert = true;
  haengenderLadeweg();
  await wrap();
  // Sichtbar bleibt es trotzdem, «keine Bewegung» heisst nicht «keine
  // Auskunft, dass hier etwas lädt».
  expect(screen.getByTestId('karte-skelett')).toBeTruthy();
  expect(spion).not.toHaveBeenCalled();
  spion.mockRestore();
});
