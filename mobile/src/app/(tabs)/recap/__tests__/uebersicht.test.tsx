import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
// Echte Effekt-Semantik statt `(cb) => cb()` (Task-10-Auftrag: diese Falle
// hat in reise/__tests__/liste.test.tsx und detail.test.tsx schon zweimal
// Zeit gekostet, sobald ein Ladeweg ein frisches Array liefert).
jest.mock('expo-router', () => {
  const ReactActual = require('react');
  return {
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: () => true }),
    useLocalSearchParams: () => ({ id: 't1' }),
    useFocusEffect: (cb: () => void | (() => void)) => ReactActual.useEffect(cb, [cb]),
  };
});
// expo-image ist ein natives View — im Test reicht ein einfacher Platzhalter,
// der `source`/Props durchreicht, damit sich das Bild pro Kachel identifizieren
// liesse, würde ein Test das je brauchen.
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

// Chronologisch: 09:00/18:00 UTC am 10.8. (Ortszeit Lissabon, Sommer: UTC+1)
// sind Tag 1; der Nachzügler liegt ebenfalls am 10.8., stört die Gruppierung
// aber nicht, weil er als 'pending' ohnehin herausgefiltert wird, bevor
// gruppiereNachTagen ihn sieht. p3 am 11.8. ist Tag 2, ohne place_name —
// prüft, dass der Ortsname in der Überschrift entfällt statt einen leeren
// Platzhalter zu zeigen. p5 ist 'uploaded', aber absichtlich NICHT im Vorrat
// (die Function konnte keine URL ausstellen) und landet daher ebenfalls in
// Tag 2, aber ohne Kachel.
const m1 = moment({ id: 'p1', captured_at: '2026-08-10T09:00:00.000Z' });
const m2 = moment({ id: 'p2', captured_at: '2026-08-10T18:00:00.000Z' });
const pendingM = moment({ id: 'p4', captured_at: '2026-08-10T20:00:00.000Z', upload_status: 'pending' });
const m3 = moment({ id: 'p3', captured_at: '2026-08-11T10:00:00.000Z', place_name: null });
const ausgelassenM = moment({ id: 'p5', captured_at: '2026-08-11T11:00:00.000Z' });

function bild(id: string) {
  return { post_id: id, medium_url: `https://cdn.example/${id}-medium.jpg`, thumb_url: `https://cdn.example/${id}-thumb.jpg` };
}

const wrap = () => render(<ThemeProvider><RecapUebersicht /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  (fetchTrip as jest.Mock).mockResolvedValue({ data: trip, error: null });
});

test('gruppiert nach Tagen mit Ortsname, und ohne Ortsname entfällt er', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [m1, m2, pendingM, m3, ausgelassenM], error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({
    vorrat: { urls: new Map([['p1', bild('p1')], ['p2', bild('p2')], ['p3', bild('p3')]]), gueltigBis: Date.now() + 999_999, ausgelassen: 1 },
    error: null,
    grund: null,
  });
  await wrap();
  expect(await screen.findByText('Tag 1 · Lissabon · 10. August')).toBeTruthy();
  expect(screen.getByText('Tag 2 · 11. August')).toBeTruthy();
});

test('Nachzügler und Ausgelassene tragen keine Kachel, aber je eine ehrliche Zeile', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [m1, m2, pendingM, m3, ausgelassenM], error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({
    vorrat: { urls: new Map([['p1', bild('p1')], ['p2', bild('p2')], ['p3', bild('p3')]]), gueltigBis: Date.now() + 999_999, ausgelassen: 1 },
    error: null,
    grund: null,
  });
  await wrap();
  await screen.findByText('Tag 1 · Lissabon · 10. August');

  // Genau drei Kacheln (p1, p2, p3) — weder der Nachzügler (p4) noch der
  // Ausgelassene (p5) bekommen eine, obwohl beide in `momente` stecken.
  expect(screen.getAllByTestId(/^recap-kachel-/)).toHaveLength(3);
  expect(screen.queryByTestId('recap-kachel-p4')).toBeNull();
  expect(screen.queryByTestId('recap-kachel-p5')).toBeNull();

  expect(screen.getByText('1 Moment wird noch hochgeladen.')).toBeTruthy();
  expect(screen.getByText('1 Moment liess sich gerade nicht laden. Schau später nochmal rein.')).toBeTruthy();
});

test('Mehrzahl bei mehreren Nachzüglern und mehreren Ausgelassenen', async () => {
  const pend2 = moment({ id: 'p6', captured_at: '2026-08-10T21:00:00.000Z', upload_status: 'pending' });
  const pend3 = moment({ id: 'p7', captured_at: '2026-08-10T22:00:00.000Z', upload_status: 'pending' });
  const ausgelassen2 = moment({ id: 'p8', captured_at: '2026-08-10T23:00:00.000Z' });
  (fetchRecapMomente as jest.Mock).mockResolvedValue({
    data: [m1, pendingM, pend2, pend3, ausgelassenM, ausgelassen2],
    error: null,
  });
  (holeVorrat as jest.Mock).mockResolvedValue({
    vorrat: { urls: new Map([['p1', bild('p1')]]), gueltigBis: Date.now() + 999_999, ausgelassen: 2 },
    error: null,
    grund: null,
  });
  await wrap();
  expect(await screen.findByText('3 Momente werden noch hochgeladen.')).toBeTruthy();
  expect(screen.getByText('2 Momente liessen sich gerade nicht laden. Schau später nochmal rein.')).toBeTruthy();
  expect(screen.getAllByTestId(/^recap-kachel-/)).toHaveLength(1);
});

test('ein Tipp auf eine Kachel übergibt den richtigen, tagübergreifenden Startindex', async () => {
  (fetchRecapMomente as jest.Mock).mockResolvedValue({ data: [m1, m2, pendingM, m3, ausgelassenM], error: null });
  (holeVorrat as jest.Mock).mockResolvedValue({
    vorrat: { urls: new Map([['p1', bild('p1')], ['p2', bild('p2')], ['p3', bild('p3')]]), gueltigBis: Date.now() + 999_999, ausgelassen: 1 },
    error: null,
    grund: null,
  });
  await wrap();
  await screen.findByText('Tag 1 · Lissabon · 10. August');

  // p2 ist die zweite sichtbare Kachel insgesamt (Index 1) …
  await fireEvent.press(screen.getByTestId('recap-kachel-p2'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/recap/[id]/player', params: { id: 't1', start: '1' } });

  // … p3 die dritte (Index 2) — der Index läuft über die Tagesgrenze hinweg
  // weiter, statt in Tag 2 wieder bei 0 zu beginnen.
  await fireEvent.press(screen.getByTestId('recap-kachel-p3'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/recap/[id]/player', params: { id: 't1', start: '2' } });
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
  expect(await screen.findByText('1 Moment wird noch hochgeladen.')).toBeTruthy();
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

test('der Zurück-Pfeil verlässt den Screen', async () => {
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
});
