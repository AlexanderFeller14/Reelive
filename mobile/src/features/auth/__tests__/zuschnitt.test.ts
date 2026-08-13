import { ausschnittFuer, begrenze, grenzen, grundfaktor } from '../zuschnitt';

const QUER = { breite: 4000, hoehe: 3000 };
const HOCH = { breite: 1000, hoehe: 2500 };
const QUADRAT = { breite: 2000, hoehe: 2000 };
const RAHMEN = 300;

const mittig = { zoom: 1, versatzX: 0, versatzY: 0 };

test('der Grundfaktor richtet sich nach der kuerzeren Kante', () => {
  // Sonst bliebe quer zur langen Kante eine Lücke im Rahmen.
  expect(grundfaktor(QUER, RAHMEN)).toBeCloseTo(300 / 3000);
  expect(grundfaktor(HOCH, RAHMEN)).toBeCloseTo(300 / 1000);
});

// Ohne Zutun soll genau das herauskommen, was der automatische Zuschnitt
// vorher gemacht hat: mittig auf die kürzere Kante.
test('unberuehrt ergibt sich der mittige Ausschnitt', () => {
  expect(ausschnittFuer(mittig, QUER, RAHMEN)).toEqual({
    originX: 500, originY: 0, width: 3000, height: 3000,
  });
  expect(ausschnittFuer(mittig, HOCH, RAHMEN)).toEqual({
    originX: 0, originY: 750, width: 1000, height: 1000,
  });
});

test('ein quadratisches Original wird gar nicht beschnitten', () => {
  expect(ausschnittFuer(mittig, QUADRAT, RAHMEN)).toEqual({
    originX: 0, originY: 0, width: 2000, height: 2000,
  });
});

// Die Richtung ist die Stelle, an der ein Vorzeichen am leichtesten kippt:
// Das Bild nach rechts zu schieben zeigt den LINKEN Teil des Originals.
test('das Bild nach rechts zu schieben zeigt weiter links im Original', () => {
  const a = ausschnittFuer({ zoom: 1, versatzX: 30, versatzY: 0 }, QUER, RAHMEN);
  // 30 Bildschirmpunkte bei Faktor 0,1 sind 300 Originalpixel.
  expect(a.originX).toBe(200);
  expect(a.originY).toBe(0);
});

test('das Bild nach unten zu schieben zeigt weiter oben im Original', () => {
  const a = ausschnittFuer({ zoom: 1, versatzY: 75, versatzX: 0 }, HOCH, RAHMEN);
  // Faktor 0,3 → 75 Punkte sind 250 Originalpixel, von 750 aus nach oben.
  expect(a.originY).toBe(500);
});

test('Zoom verkleinert den Ausschnitt um genau diesen Faktor', () => {
  const a = ausschnittFuer({ zoom: 2, versatzX: 0, versatzY: 0 }, QUER, RAHMEN);
  expect(a.width).toBe(1500);
  expect(a.height).toBe(1500);
  // Weiterhin mittig: (4000-1500)/2 und (3000-1500)/2.
  expect(a.originX).toBe(1250);
  expect(a.originY).toBe(750);
});

// Ohne diese Schranke entstünden Lücken im Rahmen, in denen nichts ist.
test('Zoom unter 1 wird auf 1 angehoben', () => {
  expect(begrenze({ zoom: 0.3, versatzX: 0, versatzY: 0 }, QUER, RAHMEN).zoom).toBe(1);
});

test('bei Zoom 1 laesst sich das Hochformat nur senkrecht schieben', () => {
  const g = grenzen(HOCH, RAHMEN, 1);
  expect(g.x).toBe(0);
  expect(g.y).toBeCloseTo((2500 * 0.3 - 300) / 2);
});

// Über die Kante hinaus schieben darf nichts freilegen.
test('zu weites Schieben wird auf die Kante begrenzt', () => {
  const zuWeit = ausschnittFuer({ zoom: 1, versatzX: 99999, versatzY: 0 }, QUER, RAHMEN);
  expect(zuWeit.originX).toBe(0);
  const andersrum = ausschnittFuer({ zoom: 1, versatzX: -99999, versatzY: 0 }, QUER, RAHMEN);
  expect(andersrum.originX).toBe(1000); // 4000 − 3000
});

// Der Ausschnitt muss immer vollständig im Bild liegen, sonst weist der native
// Zuschnitt ihn zurück, statt zu klemmen.
test('der Ausschnitt bleibt bei krummen Massen und Zoom innerhalb des Bildes', () => {
  const krumm = { breite: 4031, hoehe: 3007 };
  for (const zoom of [1, 1.37, 2.5, 7.9]) {
    for (const versatzX of [-9999, -13, 0, 44, 9999]) {
      for (const versatzY of [-9999, -7, 0, 21, 9999]) {
        const a = ausschnittFuer({ zoom, versatzX, versatzY }, krumm, RAHMEN);
        expect(a.originX).toBeGreaterThanOrEqual(0);
        expect(a.originY).toBeGreaterThanOrEqual(0);
        expect(a.originX + a.width).toBeLessThanOrEqual(krumm.breite);
        expect(a.originY + a.height).toBeLessThanOrEqual(krumm.hoehe);
        expect(a.width).toBe(a.height);
        expect(a.width).toBeGreaterThan(0);
      }
    }
  }
});
