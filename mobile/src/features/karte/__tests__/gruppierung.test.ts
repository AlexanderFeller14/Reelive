import { gruppiere, GRUPPEN_ABSTAND_PT } from '../gruppierung';
import type { Ausschnitt, KartenPunkt } from '../typen';

const punkt = (id: string, lat: number, lng: number, index = 0): KartenPunkt =>
  ({ lat, lng, index, moment: { id } } as unknown as KartenPunkt);

// 0.1 Grad ueber 400 Punkte Breite: ein Grad sind 4000 Punkte, ein
// Tausendstel Grad also 4 Punkte.
const AUSSCHNITT: Ausschnitt = {
  latitude: 0, longitude: 0, latitudeDelta: 0.1, longitudeDelta: 0.1,
};
const BREITE = 400;
const HOEHE = 400;

test('weit auseinander liegende Punkte bleiben einzeln', () => {
  const gruppen = gruppiere(
    [punkt('a', 0.04, 0.04), punkt('b', -0.04, -0.04)],
    AUSSCHNITT, BREITE, HOEHE
  );
  expect(gruppen).toHaveLength(2);
  expect(gruppen.every((g) => g.punkte.length === 1)).toBe(true);
});

test('dicht beieinander liegende Punkte werden zu einer Gruppe', () => {
  const gruppen = gruppiere(
    [punkt('a', 0, 0), punkt('b', 0.001, 0.001), punkt('c', 0.002, 0)],
    AUSSCHNITT, BREITE, HOEHE
  );
  expect(gruppen).toHaveLength(1);
  expect(gruppen[0].punkte.map((p) => p.moment.id)).toEqual(['a', 'b', 'c']);
});

// Der Anker stellt die Gruppe dar. Er ist der ERSTE der Eingabereihenfolge,
// und die ist nach captured_at sortiert — die Gruppe traegt also das
// Thumbnail des fruehesten Moments.
test('der Anker ist der fruehste Moment der Gruppe', () => {
  const gruppen = gruppiere(
    [punkt('frueh', 0, 0, 3), punkt('spaet', 0.001, 0, 7)],
    AUSSCHNITT, BREITE, HOEHE
  );
  expect(gruppen[0].anker.moment.id).toBe('frueh');
});

test('identische Koordinaten landen in einer Gruppe', () => {
  const gruppen = gruppiere(
    [punkt('a', 12.34, 56.78), punkt('b', 12.34, 56.78)],
    { latitude: 12.34, longitude: 56.78, latitudeDelta: 0.1, longitudeDelta: 0.1 },
    BREITE, HOEHE
  );
  expect(gruppen).toHaveLength(1);
});

test('ein einzelner Punkt ergibt eine Gruppe mit einem Punkt', () => {
  const gruppen = gruppiere([punkt('a', 0, 0)], AUSSCHNITT, BREITE, HOEHE);
  expect(gruppen).toEqual([{ anker: expect.anything(), punkte: [expect.anything()] }]);
});

test('ohne Punkte gibt es keine Gruppen', () => {
  expect(gruppiere([], AUSSCHNITT, BREITE, HOEHE)).toEqual([]);
});

// Beim Hineinzoomen faellt eine Gruppe auseinander — genau das passiert, wenn
// jemand sie antippt (Spec §5.5).
test('enger Ausschnitt loest die Gruppe auf', () => {
  const punkte = [punkt('a', 0, 0), punkt('b', 0.001, 0.001)];
  const eng: Ausschnitt = { ...AUSSCHNITT, latitudeDelta: 0.002, longitudeDelta: 0.002 };
  expect(gruppiere(punkte, AUSSCHNITT, BREITE, HOEHE)).toHaveLength(1);
  expect(gruppiere(punkte, eng, BREITE, HOEHE)).toHaveLength(2);
});

test('die Schwelle ist in Bildschirmpunkten und einstellbar', () => {
  const punkte = [punkt('a', 0, 0), punkt('b', 0.004, 0)];
  expect(gruppiere(punkte, AUSSCHNITT, BREITE, HOEHE, 4)).toHaveLength(2);
  expect(gruppiere(punkte, AUSSCHNITT, BREITE, HOEHE, GRUPPEN_ABSTAND_PT)).toHaveLength(1);
});

// Ein gewickelter Ausschnitt, wie ihn ausschnittFuer fuer eine Reise ueber die
// Datumsgrenze liefert. Vorher schoss der oestliche Punkt ins Millionenfache
// und wurde nie gruppiert.
test('ueber die Datumsgrenze hinweg wird richtig gruppiert', () => {
  const gewickelt: Ausschnitt = {
    latitude: -17.85, longitude: -180, latitudeDelta: 0.2, longitudeDelta: 0.2,
  };
  const gruppen = gruppiere(
    [punkt('west', -17.85, 179.999), punkt('ost', -17.85, -179.999)],
    gewickelt, BREITE, HOEHE
  );
  expect(gruppen).toHaveLength(1);
});
