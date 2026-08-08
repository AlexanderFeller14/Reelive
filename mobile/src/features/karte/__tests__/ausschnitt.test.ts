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

// Der Fehler, den Task 3 beim Umsetzen gefunden hat: bei identischen
// Laengengraden fand die Luecken-Suche eine Luecke von 0 Grad und machte
// daraus eine Spanne von 360 — der Mittelpunkt landete auf dem Antipoden.
test('mehrere Punkte auf derselben Koordinate bleiben dort', () => {
  const a = ausschnittFuer([punkt(38.71, -9.13), punkt(38.71, -9.13)])!;
  expect(a.longitude).toBeCloseTo(-9.13, 5);
  expect(a.latitude).toBeCloseTo(38.71, 5);
});

test('der Mittelpunkt bleibt im gueltigen Bereich', () => {
  const a = ausschnittFuer([punkt(-17.8, 179.0), punkt(-17.9, -179.5)])!;
  expect(a.longitude).toBeGreaterThanOrEqual(-180);
  expect(a.longitude).toBeLessThanOrEqual(180);
});

// Drei Punkte, zwei gleich grosse Luecken (je 170 Grad): der Kern des
// Verfahrens. Die kleinste einschliessende Spanne ist 190 Grad, und bei
// Gleichstand gewinnt die zuerst gefundene Luecke — das Ergebnis muss
// deterministisch sein, nicht nur irgendein gueltiges.
test('drei Punkte mit gleich grossen Luecken ergeben ein festes Ergebnis', () => {
  const a = ausschnittFuer([punkt(0, -170), punkt(0, 0), punkt(0, 170)])!;
  expect(a.longitude).toBeCloseTo(95, 5);
  expect(a.longitudeDelta).toBeCloseTo(190 * 1.4, 5);
});
