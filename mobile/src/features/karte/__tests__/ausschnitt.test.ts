import { ausschnittFuer } from '../ausschnitt';
import type { KartenPunkt } from '../typen';

const punkt = (lat: number, lng: number): KartenPunkt =>
  ({ lat, lng, index: 0, moment: { id: `${lat},${lng}` } } as unknown as KartenPunkt);

test('ohne Punkte gibt es keinen Ausschnitt', () => {
  expect(ausschnittFuer([])).toBeNull();
});

// Ein einzelner Punkt hat keine Ausdehnung — ohne Sonderfall waere das Delta 0
// und die Karte zoomte bis auf Hausnummern hinunter.
test('ein einzelner Punkt bekommt einen festen Radius', () => {
  const a = ausschnittFuer([punkt(38.71, -9.13)])!;
  expect(a.latitude).toBeCloseTo(38.71, 5);
  expect(a.longitude).toBeCloseTo(-9.13, 5);
  expect(a.latitudeDelta).toBeGreaterThan(0);
  expect(a.longitudeDelta).toBeGreaterThan(0);
});

test('zwei Punkte liegen mittig im Ausschnitt und passen mit Rand hinein', () => {
  const a = ausschnittFuer([punkt(38.70, -9.20), punkt(38.72, -9.10)])!;
  expect(a.latitude).toBeCloseTo(38.71, 5);
  expect(a.longitude).toBeCloseTo(-9.15, 5);
  expect(a.latitudeDelta).toBeGreaterThan(0.02);
  expect(a.longitudeDelta).toBeGreaterThan(0.10);
});

// Der Fall, an dem die naive Rechnung (min/max) scheitert: Fidschi liegt
// beiderseits des 180. Laengengrads. min/max ergaebe eine Spanne von 359 Grad
// und einen Mittelpunkt in Afrika.
test('ueber den 180. Laengengrad hinweg bleibt der Ausschnitt eng', () => {
  const a = ausschnittFuer([punkt(-17.8, 179.0), punkt(-17.9, -179.5)])!;
  expect(a.longitudeDelta).toBeLessThan(5);
  expect(Math.abs(a.longitude)).toBeGreaterThan(175);
});

test('der Mittelpunkt bleibt im gueltigen Bereich', () => {
  const a = ausschnittFuer([punkt(-17.8, 179.0), punkt(-17.9, -179.5)])!;
  expect(a.longitude).toBeGreaterThanOrEqual(-180);
  expect(a.longitude).toBeLessThanOrEqual(180);
});
