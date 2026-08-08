import { render, screen, fireEvent, act } from '@testing-library/react-native';
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
// Task 6: mutierbar, damit einzelne Tests die Owner-Rolle wechseln können
// (gleiches Muster wie reise/__tests__/detail.test.tsx, mockAuth.userId).
const mockAuth = { userId: 'u1' };
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
// TeilenSheetInhalt hat ihre eigene, vollständige Testdatei
// (features/teilen/__tests__/TeilenSheetInhalt.test.tsx) — hier nur ein
// Platzhalter, der belegt, DASS und MIT WELCHER tripId sie gemountet wird,
// ohne die Supabase-Aufrufkette dieser Datei über den Import-Graph
// mitzuziehen (sie ist hier ungemockt und würde beim Modul-Load werfen,
// siehe @/lib/supabase).
jest.mock('@/features/teilen/TeilenSheetInhalt', () => {
  const ReactActual = require('react');
  const { Text } = require('react-native');
  return {
    TeilenSheetInhalt: ({ tripId }: { tripId: string }) =>
      ReactActual.createElement(Text, { testID: 'mock-teilen-sheet-inhalt' }, tripId),
  };
});
// Task 7: exportApi hat ihre eigene, vollständige Testdatei
// (features/recap/__tests__/exportApi.test.ts) — hier nur ein Spion. Ein
// echter Import würde expo-media-library ziehen, das sich in diesem
// Jest-Setup nicht mocken lässt (native Klassenvererbung, siehe Kommentar
// dort/Bericht).
jest.mock('@/features/recap/exportApi', () => ({ sichereAlleInGalerie: jest.fn() }));
const mockOpenSettings = jest.fn(() => Promise.resolve());
jest.mock('expo-linking', () => ({ openSettings: () => mockOpenSettings() }));

import RecapUebersicht from '../[id]/uebersicht';
import { fetchTrip } from '@/features/trips/tripsApi';
import { fetchRecapMomente } from '@/features/recap/recapApi';
import { sichereAlleInGalerie } from '@/features/recap/exportApi';
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
  mockAuth.userId = 'u1';
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

// Task 6: «Recap teilen» — nur Owner-Person, nur bei status==='revealed'
// (Brief, wörtlich). `trip` (Fixture oben) ist bereits status:'revealed',
// owner_id:'u1'; mockAuth.userId startet ebenfalls bei 'u1' (beforeEach).
describe('«Recap teilen»: nur Owner-Person, nur bei revealed', () => {
  const leererLadeErfolg = () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [], error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({
      vorrat: { urls: new Map(), gueltigBis: Date.now() + 999_999, ausgelassen: 0 },
      error: null,
      grund: null,
    });
  };

  test('die Owner-Person sieht den Teilen-Knopf bei einer aufgedeckten Reise', async () => {
    leererLadeErfolg();
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    expect(screen.getByTestId('uebersicht-teilen-oeffnen')).toBeTruthy();
  });

  test('ein Tipp auf den Teilen-Knopf öffnet das Sheet mit TeilenSheetInhalt für diese Reise', async () => {
    leererLadeErfolg();
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    expect(screen.queryByTestId('mock-teilen-sheet-inhalt')).toBeNull();
    await fireEvent.press(screen.getByTestId('uebersicht-teilen-oeffnen'));
    const inhalt = await screen.findByTestId('mock-teilen-sheet-inhalt');
    expect(inhalt).toHaveTextContent('t1');
  });

  test('ein Wisch/Tipp auf den Hintergrund schliesst das Sheet wieder', async () => {
    leererLadeErfolg();
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('uebersicht-teilen-oeffnen'));
    await screen.findByTestId('mock-teilen-sheet-inhalt');
    await fireEvent.press(screen.getByTestId('sheet-backdrop'));
    expect(screen.queryByTestId('mock-teilen-sheet-inhalt')).toBeNull();
  });

  test('eine NICHT-Owner-Person sieht den Teilen-Knopf nicht', async () => {
    mockAuth.userId = 'jemand-anders';
    leererLadeErfolg();
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    expect(screen.queryByTestId('uebersicht-teilen-oeffnen')).toBeNull();
  });

  // status==='active' kommt in der Praxis für diesen Screen kaum vor (der
  // Recap ist bis zum Reveal versiegelt) — die Sichtbarkeitsregel gilt
  // trotzdem unabhängig davon, ob die Function das später ohnehin ablehnen
  // würde: die UI blendet aus, bevor überhaupt ein Aufruf stattfindet.
  test('bei status "active" (noch nicht aufgedeckt) fehlt der Teilen-Knopf, selbst für die Owner-Person', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, status: 'active' as const }, error: null });
    leererLadeErfolg();
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    expect(screen.queryByTestId('uebersicht-teilen-oeffnen')).toBeNull();
  });

  // Brief, wörtlich: "nur bei status==='revealed'" — bewusst OHNE Ausnahme
  // für 'archived', obwohl ein bereits bestehender Link auf einer
  // archivierten Reise laut Server-Policy weiterhin widerrufbar bliebe
  // (supabase/migrations/20260808130000_share_links_widerruf_archiviert.sql).
  // Das ist eine echte Lücke (siehe Bericht, "Bedenken"): sobald eine Reise
  // archiviert, verschwindet in DIESER App-Version der einzige Weg, einen
  // zuvor erstellten Link noch zu widerrufen — nicht Teil dieses Tasks, hier
  // nur als Zusicherung festgehalten, dass die Gating-Regel exakt dem Brief
  // folgt und nicht heimlich grosszügiger ist.
  test('bei status "archived" fehlt der Teilen-Knopf ebenfalls — auch für die Owner-Person', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue({ data: { ...trip, status: 'archived' as const }, error: null });
    leererLadeErfolg();
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    expect(screen.queryByTestId('uebersicht-teilen-oeffnen')).toBeNull();
  });
});

// Task 7: «Alle sichern» — offen für jedes Mitglied (kein Owner-Vorbehalt
// wie beim Teilen), nur ausgeblendet, wenn es nichts zu sichern gibt.
describe('«Alle sichern»', () => {
  beforeEach(() => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: VOLLSTAENDIG, error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({ vorrat: VORRAT_OK, error: null, grund: null });
  });

  test('sichtbar für eine NICHT-Owner-Person, solange es Momente zum Sichern gibt', async () => {
    mockAuth.userId = 'jemand-anders';
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    expect(screen.getByTestId('uebersicht-alle-sichern-oeffnen')).toBeTruthy();
  });

  test('fehlt, wenn es buchstäblich nichts zu sichern gibt', async () => {
    (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [], error: null });
    (holeVorrat as jest.Mock).mockResolvedValue({
      vorrat: { urls: new Map(), gueltigBis: Date.now() + 999_999, ausgelassen: 0 },
      error: null,
      grund: null,
    });
    await wrap();
    await screen.findByText('Diese Reise ist leer geblieben.');
    expect(screen.queryByTestId('uebersicht-alle-sichern-oeffnen')).toBeNull();
  });

  test('ruft sichereAlleInGalerie mit GENAU den drei sichtbaren Momenten (moment+URL) auf', async () => {
    (sichereAlleInGalerie as jest.Mock).mockReturnValue(new Promise(() => {}));
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('uebersicht-alle-sichern-oeffnen'));
    expect(sichereAlleInGalerie).toHaveBeenCalledTimes(1);
    const eintraege = (sichereAlleInGalerie as jest.Mock).mock.calls[0][0] as { moment: { id: string } }[];
    expect(eintraege.map((e) => e.moment.id).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  test('zeigt den laufenden Fortschritt («N von M»), sobald onFortschritt feuert', async () => {
    let fortschrittMelden!: (stand: { erledigt: number; gesamt: number }) => void;
    (sichereAlleInGalerie as jest.Mock).mockImplementation(
      (_eintraege: unknown, onFortschritt: (stand: { erledigt: number; gesamt: number }) => void) => {
        fortschrittMelden = onFortschritt;
        return new Promise(() => {});
      }
    );
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('uebersicht-alle-sichern-oeffnen'));
    expect(screen.getByText('0 von 3 gesichert')).toBeTruthy();
    await act(async () => {
      fortschrittMelden({ erledigt: 2, gesamt: 3 });
    });
    expect(screen.getByText('2 von 3 gesichert')).toBeTruthy();
  });

  test('eine ehrliche Bilanz am Ende — inklusive Fehlschlägen, nicht bloss "fertig"', async () => {
    (sichereAlleInGalerie as jest.Mock).mockResolvedValue({
      status: 'fertig', gesichert: 2, gesamt: 3, fehlgeschlagen: 1, abgebrochen: false,
    });
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('uebersicht-alle-sichern-oeffnen'));
    await act(async () => {});
    expect(await screen.findByTestId('export-bilanz')).toHaveTextContent(
      '2 von 3 Momenten gesichert. 1 ist fehlgeschlagen.'
    );
  });

  test('"Fertig" schliesst das Sheet wieder', async () => {
    (sichereAlleInGalerie as jest.Mock).mockResolvedValue({
      status: 'fertig', gesichert: 3, gesamt: 3, fehlgeschlagen: 0, abgebrochen: false,
    });
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('uebersicht-alle-sichern-oeffnen'));
    await act(async () => {});
    await screen.findByTestId('export-bilanz');
    await fireEvent.press(screen.getByText('Fertig'));
    expect(screen.queryByTestId('export-bilanz')).toBeNull();
  });

  // Kernfall (Brief, wörtlich: "nie ein stiller Fehlschlag" — gilt genauso
  // für "alle sichern" wie für den Einzelmoment im Player).
  test('fehlende Berechtigung zeigt die Ursache und "Einstellungen öffnen", statt einfach nichts zu tun', async () => {
    (sichereAlleInGalerie as jest.Mock).mockResolvedValue({
      status: 'keine_berechtigung', text: 'Reelive braucht Zugriff auf deine Fotobibliothek …',
    });
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('uebersicht-alle-sichern-oeffnen'));
    await act(async () => {});
    expect(await screen.findByText('Reelive braucht Zugriff auf deine Fotobibliothek …')).toBeTruthy();
    await fireEvent.press(screen.getByText('Einstellungen öffnen'));
    expect(mockOpenSettings).toHaveBeenCalled();
  });

  test('"Abbrechen" bricht den laufenden Export über das AbortSignal ab', async () => {
    let empfangenesSignal: AbortSignal | undefined;
    (sichereAlleInGalerie as jest.Mock).mockImplementation(
      (_eintraege: unknown, _onFortschritt: unknown, signal?: AbortSignal) => {
        empfangenesSignal = signal;
        return new Promise(() => {});
      }
    );
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('uebersicht-alle-sichern-oeffnen'));
    expect(empfangenesSignal?.aborted).toBe(false);
    await fireEvent.press(screen.getByText('Abbrechen'));
    expect(empfangenesSignal?.aborted).toBe(true);
  });

  // Ein Schliessen WÄHREND der Export noch läuft ist implizit ein Abbrechen
  // (Kommentar im Code: kein stiller Weiterlauf ohne sichtbare Kontrolle).
  test('ein Schliessen des Sheets WÄHREND des Laufs bricht ihn ebenfalls ab', async () => {
    let empfangenesSignal: AbortSignal | undefined;
    (sichereAlleInGalerie as jest.Mock).mockImplementation(
      (_eintraege: unknown, _onFortschritt: unknown, signal?: AbortSignal) => {
        empfangenesSignal = signal;
        return new Promise(() => {});
      }
    );
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('uebersicht-alle-sichern-oeffnen'));
    await fireEvent.press(screen.getByTestId('sheet-backdrop'));
    expect(empfangenesSignal?.aborted).toBe(true);
  });

  // Gegenprobe: ist der Export bereits FERTIG, darf ein Schliessen keinen
  // (inzwischen längst erledigten) Abbruch mehr auslösen — es gibt nichts
  // mehr, das abzubrechen wäre.
  test('ein Schliessen NACH dem Ende bricht nichts mehr ab', async () => {
    (sichereAlleInGalerie as jest.Mock).mockResolvedValue({
      status: 'fertig', gesichert: 3, gesamt: 3, fehlgeschlagen: 0, abgebrochen: false,
    });
    await wrap();
    await screen.findByText('Lissabon Städtetrip');
    await fireEvent.press(screen.getByTestId('uebersicht-alle-sichern-oeffnen'));
    await act(async () => {});
    await screen.findByTestId('export-bilanz');
    await fireEvent.press(screen.getByTestId('sheet-backdrop'));
    expect(screen.queryByTestId('export-bilanz')).toBeNull();
    // Kein zweiter Aufruf durch das Schliessen selbst ausgelöst.
    expect(sichereAlleInGalerie).toHaveBeenCalledTimes(1);
  });
});
