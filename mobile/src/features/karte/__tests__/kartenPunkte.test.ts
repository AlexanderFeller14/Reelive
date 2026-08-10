import { zuKartenPunkten } from '../kartenPunkte';
import type { RecapMoment } from '@/features/recap/types';

const moment = (teil: Partial<RecapMoment> & { id: string }): RecapMoment => ({
  trip_id: 't1', author_id: 'u1', type: 'photo', duration_s: null, caption: null,
  captured_at: '2026-05-08T10:00:00Z', captured_tz: 'Europe/Lisbon',
  place_name: null, lat: null, lng: null, upload_status: 'uploaded',
  autor_name: 'Mira', ...teil,
});

test('trennt Momente mit Ort von denen ohne', () => {
  const { punkte, ohneOrt } = zuKartenPunkten([
    moment({ id: 'a', lat: 38.71, lng: -9.13 }),
    moment({ id: 'b' }),
    moment({ id: 'c', lat: 38.69, lng: -9.21 }),
  ]);
  expect(punkte.map((p) => p.moment.id)).toEqual(['a', 'c']);
  expect(ohneOrt.map((m) => m.id)).toEqual(['b']);
});

// Der Index zeigt in die SORTIERTE Gesamtliste, nicht in die gefilterte,
// sonst startet der Player beim falschen Moment.
test('der Index zaehlt ueber alle Momente, nicht nur ueber die mit Ort', () => {
  const { punkte } = zuKartenPunkten([
    moment({ id: 'a', captured_at: '2026-05-08T09:00:00Z' }),
    moment({ id: 'b', captured_at: '2026-05-08T10:00:00Z', lat: 1, lng: 2 }),
  ]);
  expect(punkte[0].index).toBe(1);
});

// Die Karte sortiert selbst, statt sich auf den Aufrufer zu verlassen:
// captured_at aufsteigend, id als stabiles zweites Kriterium.
test('sortiert nach captured_at, nicht nach Eingabereihenfolge', () => {
  const { punkte } = zuKartenPunkten([
    moment({ id: 'spaet', captured_at: '2026-05-09T10:00:00Z', lat: 1, lng: 1 }),
    moment({ id: 'frueh', captured_at: '2026-05-08T10:00:00Z', lat: 2, lng: 2 }),
  ]);
  expect(punkte.map((p) => p.moment.id)).toEqual(['frueh', 'spaet']);
});

test('eine halbe Koordinate ist keine Koordinate', () => {
  const { punkte, ohneOrt } = zuKartenPunkten([moment({ id: 'a', lat: 38.71, lng: null })]);
  expect(punkte).toHaveLength(0);
  expect(ohneOrt.map((m) => m.id)).toEqual(['a']);
});

test('auch die andere halbe Koordinate ist keine Koordinate', () => {
  const { punkte, ohneOrt } = zuKartenPunkten([moment({ id: 'a', lat: null, lng: -9.13 })]);
  expect(punkte).toHaveLength(0);
  expect(ohneOrt.map((m) => m.id)).toEqual(['a']);
});

test('leere Liste ergibt leere Ergebnisse', () => {
  expect(zuKartenPunkten([])).toEqual({ punkte: [], ohneOrt: [] });
});
