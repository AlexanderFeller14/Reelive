import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
// Steuerbar wie in aufnehmen/__tests__/preview.test.tsx (`mockKannZurueck`):
// nur so lässt sich der replace-Zweig von zurueck() überhaupt erreichen —
// mit einem hart auf `true` verdrahteten canGoBack bleibt er toter Code aus
// Test-Sicht (Review Task 10, Important 2, M8).
let mockKannZurueck = true;
// Echte Effekt-Semantik statt `(cb) => cb()` (Task-10-Auftrag: diese Falle
// hat in reise/__tests__/liste.test.tsx und detail.test.tsx schon zweimal
// Zeit gekostet, sobald ein Ladeweg ein frisches Array liefert).
jest.mock('expo-router', () => {
  const ReactActual = require('react');
  return {
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: () => mockKannZurueck }),
    useLocalSearchParams: () => ({ id: 't1' }),
    useFocusEffect: (cb: () => void | (() => void)) => ReactActual.useEffect(cb, [cb]),
  };
});
// expo-image ist ein natives View — im Test reicht ein einfacher Platzhalter,
// der alle Props (inkl. `source`, `testID`) durchreicht, damit sich pro
// Kachel prüfen lässt, WELCHE URL tatsächlich gezogen wurde.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});
jest.mock('@/features/trips/tripsApi', () => ({ fetchTrip: jest.fn() }));
jest.mock('@/features/recap/recapApi', () => ({ fetchRecapMomente: jest.fn() }));
jest.mock('@/features/recap/urlVorrat', () => ({ holeVorrat: jest.fn() }));

import RecapUebersicht from '../[id]/uebersicht';
import { fetchTrip } from '@/features/trips/tripsApi';
import { fetchRecapMomente } from '@/features/recap/recapApi';
import { holeVorrat } from '@/features/recap/urlVorrat';

const trip = {
  id: 't1', name: 'Lissabon Städtetrip', start_date: '2026-08-10', end_date: '2026-08-14',
  status: 'revealed' as const, owner_id: 'u1',
  member_names: ['Lea', 'Jonas'], member_count: 2, my_post_count: 5,
};

function moment(overrides: Partial<{
  id: string; captured_at: string; place_name: string | null; upload_status: 'pending' | 'uploaded';
}>) {
  return {
    id: 'p0', trip_id: 't1', author_id: 'u1', type: 'photo' as const, duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Lisbon', place_name: 'Lissabon',
    upload_status: 'uploaded' as const, autor_name: 'Lea',
    ...overrides,
  };
}

// Chronologisch (Ortszeit Lissabon, Sommer: UTC+1): p5 07:00, p1 09:00,
// p2 18:00 — alle Tag 1; p4 (Nachzügler) ebenfalls Tag 1, stört die
// Gruppierung aber nicht (als 'pending' ohnehin herausgefiltert, bevor
// gruppiereNachTagen ihn sieht); p3 11.8. ist Tag 2, ohne place_name — prüft,
// dass der Ortsname in der Überschrift entfällt statt einen leeren
// Platzhalter zu zeigen.
//
// p5 ist 'uploaded', aber absichtlich NICHT im Vorrat (die Function konnte
// keine URL ausstellen) — und bewusst VOR p1 platziert, nicht dahinter
// (Review Task 10, Important 2, M3): stünde er chronologisch am Ende, fiele
// seine Auslassung keinem Index mehr auf, weil kein sichtbarer Moment mehr
// hinter ihm steht, dessen Index sich verschieben könnte. Nur VOR p1
// platziert zeigt sich ein Fehler, der den Index aus der vollen (inkl.
// Ausgelassener) statt aus der sichtbaren Liste zählt.
const ausgelassenM = moment({ id: 'p5', captured_at: '2026-08-10T07:00:00.000Z' });
const m1 = moment({ id: 'p1', captured_at: '2026-08-10T09:00:00.000Z' });
const m2 = moment({ id: 'p2', captured_at: '2026-08-10T18:00:00.000Z' });
const pendingM = moment({ id: 'p4', captured_at: '2026-08-10T20:00:00.000Z', upload_status: 'pending' });
const m3 = moment({ id: 'p3', captured_at: '2026-08-11T10:00:00.000Z', place_name: null });

// Bereits chronologisch sortiert, wie recapApi.fetchRecapMomente es liefern
// würde — die Komponente sortiert selbst nicht nach.
const VOLLSTAENDIG = [ausgelassenM, m1, m2, pendingM, m3];

function bild(id: string) {
  return { post_id: id, medium_url: `https://cdn.example/${id}-medium.jpg`, thumb_url: `https://cdn.example/${id}-thumb.jpg` };
}

const VORRAT_OK = {
  urls: new Map([['p1', bild('p1')], ['p2', bild('p2')], ['p3', bild('p3')]]),
  gueltigBis: Date.now() + 999_999,
  ausgelassen: 1,
};

const wrap = () => render(<ThemeProvider><RecapUebersicht /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  mockKannZurueck = true;
  (fetchTrip as jest.Mock).mockResolvedValue({ data: trip, error: null });
});

test('gruppiert nach Tagen mit Ortsname, und ohne Ortsname entfällt er', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: VOLLSTAENDIG, error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
  await wrap();
  expect(await screen.findByText('Tag 1 · Lissabon · 10. August')).toBeTruthy();
  expect(screen.getByText('Tag 2 · 11. August')).toBeTruthy();
});

// Review Task 10, Important 2, M4: `tage.map` in der Reihenfolge, in der
// `gruppiereNachTagen` sie liefert (chronologisch) — nicht rückwärts. Ein
// Feature, dessen Eckpfeiler laut CLAUDE.md die Chronologie ist, darf die
// Tage nicht in beliebiger Reihenfolge zeigen.
test('die Tage stehen in chronologischer Reihenfolge, nicht rückwärts', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: VOLLSTAENDIG, error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
  await wrap();
  await screen.findByText('Tag 1 · Lissabon · 10. August');

  const ueberschriften = screen.getAllByText(/^Tag \d/).map((el) => el.props.children);
  expect(ueberschriften).toEqual(['Tag 1 · Lissabon · 10. August', 'Tag 2 · 11. August']);
});

test('Nachzügler und Ausgelassene tragen keine Kachel, aber je eine ehrliche Zeile', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: VOLLSTAENDIG, error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
  await wrap();
  await screen.findByText('Tag 1 · Lissabon · 10. August');

  // Genau drei Kacheln (p1, p2, p3) — weder der Nachzügler (p4) noch der
  // Ausgelassene (p5) bekommen eine, obwohl beide in `momente` stecken.
  expect(screen.getAllByTestId(/^recap-kachel-/)).toHaveLength(3);
  expect(screen.queryByTestId('recap-kachel-p4')).toBeNull();
  expect(screen.queryByTestId('recap-kachel-p5')).toBeNull();

  expect(screen.getByText('1 Moment ist noch unterwegs.')).toBeTruthy();
  expect(screen.getByText('1 Moment liess sich gerade nicht laden. Schau später nochmal rein.')).toBeTruthy();
});

test('Mehrzahl bei mehreren Nachzüglern und mehreren Ausgelassenen', async () => {
  const pend2 = moment({ id: 'p6', captured_at: '2026-08-10T21:00:00.000Z', upload_status: 'pending' });
  const pend3 = moment({ id: 'p7', captured_at: '2026-08-10T22:00:00.000Z', upload_status: 'pending' });
  const ausgelassen2 = moment({ id: 'p8', captured_at: '2026-08-10T23:00:00.000Z' });
  (fetchRecapMomente as jest.Mock).mockResolvedValue({
    data: [ausgelassenM, m1, pendingM, pend2, pend3, ausgelassen2],
    error: null,
  });
  (holeVorrat as jest.Mock).mockResolvedValue({
    vorrat: { urls: new Map([['p1', bild('p1')]]), gueltigBis: Date.now() + 999_999, ausgelassen: 2 },
    error: null,
    grund: null,
  });
  await wrap();
  expect(await screen.findByText('3 Momente sind noch unterwegs.')).toBeTruthy();
  expect(screen.getByText('2 Momente liessen sich gerade nicht laden. Schau später nochmal rein.')).toBeTruthy();
  expect(screen.getAllByTestId(/^recap-kachel-/)).toHaveLength(1);
});

// Review Task 10, Important 2, M3 (Kernfall): p5 liegt chronologisch VOR
// allen sichtbaren Kacheln (siehe Fixture-Kommentar oben). Zählte der Index
// über die volle Liste statt über die sichtbaren Momente, bekäme p1 den
// Index 1 statt 0 — der Player würde beim Tipp auf die erste Kachel den
// zweiten Moment öffnen.
test('ein Tipp auf eine Kachel übergibt den richtigen, tagübergreifenden Startindex', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: VOLLSTAENDIG, error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
  await wrap();
  await screen.findByText('Tag 1 · Lissabon · 10. August');

  // p1 ist die erste sichtbare Kachel überhaupt (Index 0) …
  await fireEvent.press(screen.getByTestId('recap-kachel-p1'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/recap/[id]/player', params: { id: 't1', start: '0' } });

  // … p3 die dritte (Index 2) — der Index läuft über die Tagesgrenze hinweg
  // weiter, statt in Tag 2 wieder bei 0 zu beginnen.
  await fireEvent.press(screen.getByTestId('recap-kachel-p3'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/recap/[id]/player', params: { id: 't1', start: '2' } });
});

// Review Task 10, Important 2, M7: `thumb_url` ist die Kachel-URL, nicht
// `medium_url` — sonst zöge jede Kachel im Raster das volle Bild.
test('die Kachel zeigt das Thumbnail, nicht das volle Bild', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: VOLLSTAENDIG, error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
  await wrap();
  const bildElement = await screen.findByTestId('recap-bild-p2');
  expect(bildElement.props.source).toEqual({ uri: bild('p2').thumb_url });
  expect(bildElement.props.source).not.toEqual({ uri: bild('p2').medium_url });
});

// Review Task 10, Important 2, M5: `ausgelassenAnzahl` ist die vom Server
// gezählte Grösse (`vorrat.ausgelassen`) — hier bewusst höher als das, was
// sich aus `uploaded.length - mitBild.length` lokal ergäbe (in dieser
// Fixture wäre die lokale Differenz 1), damit ein Test, der stattdessen die
// lokale Differenz anzeigt, sichtbar eine andere Zahl zeigt.
test('die Ausgelassen-Zeile zeigt die vom Server gezählte Zahl, nicht eine lokal nachgerechnete', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: VOLLSTAENDIG, error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({
    vorrat: { ...VORRAT_OK, ausgelassen: 5 },
    error: null,
    grund: null,
  });
  await wrap();
  expect(await screen.findByText('5 Momente liessen sich gerade nicht laden. Schau später nochmal rein.')).toBeTruthy();
  expect(screen.queryByText(/^1 Moment liess/)).toBeNull();
});

test('eine Reise ganz ohne sichtbare Momente sagt es freundlich', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [], error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({
    vorrat: { urls: new Map(), gueltigBis: Date.now() + 999_999, ausgelassen: 0 },
    error: null,
    grund: null,
  });
  await wrap();
  expect(await screen.findByText('Diese Reise ist leer geblieben.')).toBeTruthy();
});

// Gegenprobe zum Test oben: eine Reise mit einem wartenden Nachzügler, aber
// sonst nichts Sichtbarem, ist NICHT "leer geblieben" — es kommt ja noch was.
test('mit nur einem Nachzügler erscheint die leere Zeile nicht', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [pendingM], error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({
    vorrat: { urls: new Map(), gueltigBis: Date.now() + 999_999, ausgelassen: 0 },
    error: null,
    grund: null,
  });
  await wrap();
  expect(await screen.findByText('1 Moment ist noch unterwegs.')).toBeTruthy();
  expect(screen.queryByText('Diese Reise ist leer geblieben.')).toBeNull();
});

// Review Task 10, Important 2, M6: dieselbe Gegenprobe für die ANDERE Hälfte
// der `komplettLeer`-Bedingung — nur Ausgelassene, kein Nachzügler. Ohne
// `&& ausgelassenAnzahl === 0` stünden «Diese Reise ist leer geblieben.»
// UND die Ausgelassen-Zeile gleichzeitig da.
test('mit nur Ausgelassenen erscheint die leere Zeile ebenfalls nicht', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [ausgelassenM], error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({
    vorrat: { urls: new Map(), gueltigBis: Date.now() + 999_999, ausgelassen: 1 },
    error: null,
    grund: null,
  });
  await wrap();
  expect(await screen.findByText('1 Moment liess sich gerade nicht laden. Schau später nochmal rein.')).toBeTruthy();
  expect(screen.queryByText('Diese Reise ist leer geblieben.')).toBeNull();
});

test('ein Fehler beim Laden des Vorrats zeigt die Ursache statt eines leeren Rasters', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [m1], error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({
    vorrat: null,
    error: 'Diese Reise ist noch versiegelt.',
    grund: 'versiegelt',
  });
  await wrap();
  expect(await screen.findByText('Diese Reise ist noch versiegelt.')).toBeTruthy();
  expect(screen.queryByTestId('recap-kachel-p1')).toBeNull();
});

test('eine nicht mehr existierende Reise zeigt einen Rückweg statt eines leeren Screens', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ data: null, error: null });
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [], error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: null, error: null, grund: null });
  await wrap();
  expect(await screen.findByText('Diese Reise gibt es nicht mehr.')).toBeTruthy();
});

// Review Task 10, Important 2, M9: solange `geladen` noch `false` ist (die
// drei parallelen Abrufe hängen hier absichtlich), muss das Skelett stehen
// — nicht «Diese Reise gibt es nicht mehr.», was ohne den `!geladen`-Guard
// zeigen würde, weil `trip` bis zur ersten Antwort `null` ist.
test('während des Ladens erscheint das Skelett, nicht «gibt es nicht mehr»', async () => {
  (fetchTrip as jest.Mock).mockReturnValue(new Promise(() => {}));
  (fetchRecapMomente as jest.Mock).mockReturnValue(new Promise(() => {}));
  (holeVorrat as jest.Mock).mockReturnValue(new Promise(() => {}));
  await wrap();
  expect(screen.getByTestId('recap-skeleton')).toBeTruthy();
  expect(screen.queryByText('Diese Reise gibt es nicht mehr.')).toBeNull();
});

test('der Zurück-Pfeil verlässt den Screen per back(), wenn ein Rückweg existiert', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [], error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({
    vorrat: { urls: new Map(), gueltigBis: Date.now() + 999_999, ausgelassen: 0 },
    error: null,
    grund: null,
  });
  await wrap();
  await screen.findByText('Lissabon Städtetrip');
  await fireEvent.press(screen.getByLabelText('Zurück'));
  expect(mockBack).toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

// Review Task 10, Important 2, M8: ohne Rückweg (z.B. per Deep Link direkt
// in die Übersicht) gibt es nichts vom Stapel zu nehmen — nur dort ist
// `replace('/recap')` richtig. Mit einem hart auf `true` verdrahteten
// `canGoBack` bliebe dieser Zweig für einen Test unerreichbar.
test('ohne Rückweg im Stapel führt der Zurück-Pfeil per replace zur Liste', async () => {
  mockKannZurueck = false;
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [], error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({
    vorrat: { urls: new Map(), gueltigBis: Date.now() + 999_999, ausgelassen: 0 },
    error: null,
    grund: null,
  });
  await wrap();
  await screen.findByText('Lissabon Städtetrip');
  await fireEvent.press(screen.getByLabelText('Zurück'));
  expect(mockReplace).toHaveBeenCalledWith('/recap');
  expect(mockBack).not.toHaveBeenCalled();
});
