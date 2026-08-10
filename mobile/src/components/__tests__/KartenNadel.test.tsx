import { render, screen, fireEvent } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import type { RecapMoment } from '@/features/recap/types';
import type { KartenPunkt } from '@/features/karte/typen';

// expo-image ist ein natives View, im Test reicht ein Platzhalter, der alle
// Props (`source`, `testID`, `onLoad`, `onError`) durchreicht. Gleiches Muster
// wie in recap/__tests__/uebersicht.test.tsx und player.test.tsx; ein echter
// Import scheitert im Testlauf schon beim Laden des Moduls
// (expo-image/src/observe.ts erwartet eine native Umgebung).
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

// Eigener Maps-Mock statt des globalen aus jest.setup.ts: er schreibt JEDEN
// Wert mit, den `tracksViewChanges` je hatte. Der Umweg ist nötig, weil der
// Wert nach einer Prop-Änderung nur für EINEN Commit auf `true` steht, genau
// den einen, der die Nadel neu zeichnen lässt. React spielt Render und Effekt
// innerhalb desselben `act()` ab; im Endzustand steht wieder `false`, und ein
// Test, der nur den Endzustand liest, könnte «springt wieder an» gar nicht
// von «ist nie angesprungen» unterscheiden.
const mockTracksVerlauf: unknown[] = [];
jest.mock('react-native-maps', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => ReactActual.createElement(View, props, props.children),
    Marker: (props: Record<string, unknown>) => {
      mockTracksVerlauf.push(props.tracksViewChanges);
      return ReactActual.createElement(View, props, props.children);
    },
    Polyline: (props: Record<string, unknown>) => ReactActual.createElement(View, props),
    PROVIDER_DEFAULT: undefined,
  };
});

// Steuerbar wie in recap/__tests__/karte.test.tsx: AccessibilityInfo meldet im
// Testlauf immer «keine Reduktion», die Weiche im Skelett-Kreis wäre aus
// Test-Sicht sonst toter Code.
let mockReduziert = false;
jest.mock('@/theme/useReducedMotion', () => ({ useReducedMotion: () => mockReduziert }));

import { KartenNadel, KartenNadelMarker } from '../KartenNadel';

function moment(overrides: Partial<RecapMoment> = {}): RecapMoment {
  return {
    id: 'p1', trip_id: 't1', author_id: 'u1', type: 'photo', duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Lisbon', place_name: 'Lissabon',
    lat: 38.71, lng: -9.14, upload_status: 'uploaded', autor_name: 'Lea',
    ...overrides,
  };
}

const fotoMoment = moment();
const videoMoment = moment({ id: 'p2', type: 'video', duration_s: 12 });

const punkt: KartenPunkt = { moment: fotoMoment, lat: 38.71, lng: -9.14, index: 0 };
const videoPunkt: KartenPunkt = { moment: videoMoment, lat: 38.71, lng: -9.14, index: 0 };

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);
const huelle = (ui: React.ReactElement) => <ThemeProvider>{ui}</ThemeProvider>;

// Nimmt den mitgeschriebenen Verlauf heraus und leert ihn, so bezieht sich
// jede Zusicherung auf genau den Abschnitt seit dem letzten Aufruf.
function tracksSeitDann(): unknown[] {
  return mockTracksVerlauf.splice(0);
}

// Der Puls lässt sich nicht am gerenderten Wert ablesen: `Animated` flacht die
// Opazität auf eine Zahl ab und rührt sie unter `useNativeDriver` in Jest nie
// wieder an. Beobachtbar ist nur, OB eine Schleife gestartet wurde, und genau
// das unterscheidet den pulsenden Skeleton von einer stillen Fläche.
let pulsSpion: jest.SpyInstance;

beforeEach(() => {
  mockTracksVerlauf.length = 0;
  mockReduziert = false;
  pulsSpion = jest.spyOn(Animated, 'loop');
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('zeigt das Thumbnail des Moments', async () => {
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" />);
  expect(screen.getByTestId('nadel-bild').props.source.uri).toBe('https://x/t.jpg');
});

// Fixrunde 1, Punkt 1: DAS ist der Zustand, den man auf langsamer Verbindung
// wirklich sieht, die URL ist längst da, das Bild noch nicht. Vorher hing der
// Skeleton an der fehlenden URL und war damit im Produktivpfad unerreichbar:
// der Screen setzt eine Nadel nur für Momente, die im Vorrat stehen.
test('solange das Bild laedt, pulst der Skeleton unter ihm', async () => {
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" />);
  expect(screen.getByTestId('nadel-skelett')).toBeTruthy();
  expect(screen.getByTestId('nadel-bild')).toBeTruthy();
  expect(pulsSpion).toHaveBeenCalled();
});

test('nach dem Laden ist der Skeleton weg', async () => {
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" />);
  await fireEvent(screen.getByTestId('nadel-bild'), 'load');
  expect(screen.queryByTestId('nadel-skelett')).toBeNull();
});

test('eine neue Bildquelle bringt den Skeleton zurueck', async () => {
  const { rerender } = await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" />);
  await fireEvent(screen.getByTestId('nadel-bild'), 'load');
  await rerender(huelle(<KartenNadel moment={fotoMoment} thumbUrl="https://x/neu.jpg" />));
  expect(screen.getByTestId('nadel-skelett')).toBeTruthy();
});

// Ohne Bildquelle wartet die Nadel auf nichts. Sie zeigt denselben Kreis, aber
// ohne Puls: ein Pulsieren verspräche, dass gleich etwas kommt.
test('ohne Bildquelle steht ein stiller Kreis', async () => {
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl={null} />);
  expect(screen.getByTestId('nadel-skelett')).toBeTruthy();
  expect(screen.queryByTestId('nadel-bild')).toBeNull();
  expect(pulsSpion).not.toHaveBeenCalled();
});

// DESIGN-LANGUAGE §5/§9: «prefers-reduced-motion» gilt für JEDE Bewegung, nicht
// nur für die Kamerafahrten des Kartenscreens. Der Puls unter der Nadel ist die
// eine Bewegung dieser Komponente, und sie läuft ohne jedes Zutun, bis zur
// §9-Durchsicht (Task 12) hielt sie keine Zusicherung.
//
// Sichtbar bleibt der Kreis trotzdem: «keine Bewegung» heisst nicht «keine
// Auskunft, dass hier ein Bild unterwegs ist».
test('mit Reduced Motion steht der Kreis still, statt zu pulsen', async () => {
  mockReduziert = true;
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" />);
  expect(screen.getByTestId('nadel-skelett')).toBeTruthy();
  expect(pulsSpion).not.toHaveBeenCalled();
});

test('ein Video traegt zusaetzlich das Play-Zeichen', async () => {
  await wrap(<KartenNadel moment={videoMoment} thumbUrl="https://x/t.jpg" />);
  expect(screen.getByTestId('nadel-video')).toBeTruthy();
});

test('ein Foto traegt kein Play-Zeichen', async () => {
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" />);
  expect(screen.queryByTestId('nadel-video')).toBeNull();
});

test('eine Gruppe zeigt ihre Anzahl', async () => {
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" anzahl={4} />);
  expect(screen.getByText('4')).toBeTruthy();
});

test('eine Gruppe von einem zeigt keine Zahl', async () => {
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" anzahl={1} />);
  expect(screen.queryByText('1')).toBeNull();
});

test('meldet sich fertig, sobald das Bild geladen ist', async () => {
  const onBereit = jest.fn();
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" onBereit={onBereit} />);
  expect(onBereit).not.toHaveBeenCalled();
  await fireEvent(screen.getByTestId('nadel-bild'), 'load');
  expect(onBereit).toHaveBeenCalled();
});

// Ein Bild, das nicht kommt (abgelaufene URL, kein Netz), darf die Nadel nicht
// in ewiger Nachzeichnung stehen lassen, die kostet bei jeder Nadel jeden
// Frame. Nach dem Fehlschlag ändert sich am Aussehen nichts mehr.
test('meldet sich fertig, wenn das Bild scheitert', async () => {
  const onBereit = jest.fn();
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" onBereit={onBereit} />);
  await fireEvent(screen.getByTestId('nadel-bild'), 'error');
  expect(onBereit).toHaveBeenCalled();
});

// Fixrunde 1, Punkt 3: ohne Bildquelle steht das Aussehen sofort fest, es
// kommt nichts mehr, auf das zu warten wäre. Meldete sie sich hier nicht,
// zeichnete der Marker sie für immer bei jedem Frame neu.
test('ohne Bildquelle ist die Nadel sofort fertig', async () => {
  const onBereit = jest.fn();
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl={null} onBereit={onBereit} />);
  expect(onBereit).toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// KartenNadelMarker: wann darf die Nadel aufhören, sich zu zeichnen?
// ---------------------------------------------------------------------------

test('die Nadel wird nachgezeichnet, bis ihr Bild steht, und danach nicht mehr', async () => {
  await wrap(<KartenNadelMarker punkt={punkt} thumbUrl="https://x/t.jpg" />);
  expect(tracksSeitDann().at(-1)).toBe(true);
  await fireEvent(screen.getByTestId('nadel-bild'), 'load');
  expect(tracksSeitDann().at(-1)).toBe(false);
});

// Fixrunde 1, Punkt 2: `bereit` hing nur am Bild. Task 7 übergibt
// `anzahl={gruppe.punkte.length}`, und die ändert sich beim Zoomen, während
// der Anker-Moment, und damit das Bild, derselbe bleibt. Ohne diese
// Zusicherung bliebe die Zähler-Pille auf «4» stehen, obwohl die Gruppe längst
// zwei Nadeln sind.
test('eine geaenderte Anzahl laesst die Nadel wieder nachzeichnen', async () => {
  const { rerender } = await wrap(
    <KartenNadelMarker punkt={punkt} thumbUrl="https://x/t.jpg" anzahl={4} />
  );
  await fireEvent(screen.getByTestId('nadel-bild'), 'load');
  expect(tracksSeitDann().at(-1)).toBe(false);

  await rerender(huelle(<KartenNadelMarker punkt={punkt} thumbUrl="https://x/t.jpg" anzahl={2} />));
  const verlauf = tracksSeitDann();
  expect(verlauf).toContain(true); // sprang wieder an, die neue Zahl wird gezeichnet
  expect(verlauf.at(-1)).toBe(false); // und beruhigt sich wieder
});

// Fixrunde 1, Punkt 4: der Reset bei URL-Wechsel war unbelegt, man konnte ihn
// ersatzlos entfernen, ohne dass etwas rot wurde.
test('eine neue Bildquelle laesst die Nadel wieder nachzeichnen', async () => {
  const { rerender } = await wrap(<KartenNadelMarker punkt={punkt} thumbUrl="https://x/t.jpg" />);
  await fireEvent(screen.getByTestId('nadel-bild'), 'load');
  expect(tracksSeitDann().at(-1)).toBe(false);

  await rerender(huelle(<KartenNadelMarker punkt={punkt} thumbUrl="https://x/neu.jpg" />));
  // Bleibt an, bis auch das neue Bild steht, nicht nur für einen Commit.
  expect(tracksSeitDann().at(-1)).toBe(true);
  await fireEvent(screen.getByTestId('nadel-bild'), 'load');
  expect(tracksSeitDann().at(-1)).toBe(false);
});

test('ein geaenderter Momenttyp laesst die Nadel wieder nachzeichnen', async () => {
  const { rerender } = await wrap(<KartenNadelMarker punkt={punkt} thumbUrl="https://x/t.jpg" />);
  await fireEvent(screen.getByTestId('nadel-bild'), 'load');
  expect(tracksSeitDann().at(-1)).toBe(false);

  await rerender(huelle(<KartenNadelMarker punkt={videoPunkt} thumbUrl="https://x/t.jpg" />));
  const verlauf = tracksSeitDann();
  expect(verlauf).toContain(true); // das Play-Zeichen muss noch aufs Bild
  expect(verlauf.at(-1)).toBe(false);
});

// Fixrunde 1, Punkt 5: nach dem Rastern des Marker-Views ist die Nadel für
// VoiceOver ein einziges Element, was innen steht, ist dann nicht mehr
// erreichbar. Die Beschriftung muss deshalb am Marker hängen.
test('die einzelne Nadel nennt Autor und Uhrzeit', async () => {
  await wrap(<KartenNadelMarker punkt={punkt} thumbUrl="https://x/t.jpg" />);
  expect(screen.getByLabelText('Moment von Lea um 10:00 öffnen')).toBeTruthy();
});

// Das Label muss die Aktion nennen, die der Tipp WIRKLICH auslöst. Seit Task 7
// zoomt ein Tipp auf eine Gruppe hinein (Spec §5.5), geöffnet wird nichts.
// «an diesem Ort» wäre zusätzlich gelogen: gruppiert wird nach 40
// Bildschirmpunkten, und die sind bei einem Kontinent-Ausschnitt über 150 km.
test('eine Gruppe nennt, was der Tipp tut: heranzoomen', async () => {
  await wrap(<KartenNadelMarker punkt={punkt} thumbUrl="https://x/t.jpg" anzahl={4} />);
  expect(screen.getByLabelText('Auf 4 Momente heranzoomen')).toBeTruthy();
});

// Und die Gruppe, deren Tipp kein Zoom mehr ist: entweder liegen alle Momente
// auf exakt derselben Koordinate, oder die Karte steht am Anschlag ihrer
// Zoomstufen (features/karte/gruppenTipp.ts). In beiden Fällen öffnet der Tipp
// das Sheet mit der Liste, und das Label muss es sagen. Welcher der beiden
// Gründe zutrifft, weiss der Screen; die Nadel bekommt nur die Folge.
test('eine Gruppe, deren Tipp das Sheet oeffnet, nennt genau das: ansehen', async () => {
  await wrap(
    <KartenNadelMarker punkt={punkt} thumbUrl="https://x/t.jpg" anzahl={2} oeffnetSheet />
  );
  expect(screen.getByLabelText('2 Momente an diesem Ort ansehen')).toBeTruthy();
});
