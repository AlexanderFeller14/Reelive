import {
  BUEHNE,
  DAUER_MS,
  ABGEZOGEN_AB_MS,
  SIEGEL,
  dreieckIndizes,
  knotenPositionen,
  ruheKnoten,
  schattenParameter,
  texturKoordinaten,
} from '../siegelPeel';

// Referenzwerte stammen aus docs/design/reelive-sticker-peel.html (Canvas-
// Prototyp, 720er-Bühne, Siegel 500 bei 110/105, Radius 54): die Zahlen hier
// wurden mit genau dessen Formeln in Node nachgerechnet. Das Modul ist der
// Port dieser Formeln, die Tests halten ihn daran fest.

const N = 42;

function grenzen(punkte: { x: number; y: number }[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of punkte) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function imBild(p: { x: number; y: number }) {
  return p.x >= 0 && p.x <= BUEHNE && p.y >= 0 && p.y <= BUEHNE;
}

test('Bühne und Siegel entsprechen dem Prototyp', () => {
  expect(BUEHNE).toBe(720);
  expect(SIEGEL).toEqual({ x: 110, y: 105, groesse: 500 });
  expect(DAUER_MS).toBe(2700);
});

test('ruheKnoten legt (n+1)² Punkte zeilenweise über das Siegel', () => {
  const knoten = ruheKnoten(2);
  expect(knoten).toEqual([
    { x: 110, y: 105 }, { x: 360, y: 105 }, { x: 610, y: 105 },
    { x: 110, y: 355 }, { x: 360, y: 355 }, { x: 610, y: 355 },
    { x: 110, y: 605 }, { x: 360, y: 605 }, { x: 610, y: 605 },
  ]);
});

test('texturKoordinaten liegen im Pixelraum des Bildes, gleiche Reihenfolge wie die Knoten', () => {
  const tex = texturKoordinaten(2, 1254, 1254);
  expect(tex).toHaveLength(9);
  expect(tex[0]).toEqual({ x: 0, y: 0 });
  expect(tex[2]).toEqual({ x: 1254, y: 0 });
  expect(tex[4]).toEqual({ x: 627, y: 627 });
  expect(tex[8]).toEqual({ x: 1254, y: 1254 });
});

test('dreieckIndizes: zwei Dreiecke pro Zelle, zeilenweise, Indizes zeigen ins Knotenraster', () => {
  const idx = dreieckIndizes(2);
  expect(idx).toHaveLength(2 * 2 * 2 * 3);
  // Erste Zelle: (0,0)-(1,0)-(1,1) und (0,0)-(1,1)-(0,1), gleiche Aufteilung
  // wie im Prototyp (a,b,c) und (a,c,d).
  expect(idx.slice(0, 6)).toEqual([0, 1, 4, 0, 4, 3]);
  // Letzte Zelle unten rechts.
  expect(idx.slice(-6)).toEqual([4, 5, 8, 4, 8, 7]);
  expect(Math.max(...idx)).toBe(8);
});

test('bei p=0 liegt das Siegel flach in Ruhe, exakt auf den Ruheknoten', () => {
  expect(knotenPositionen(0, N)).toEqual(ruheKnoten(N));
  // Die ersten 5 % sind Anlauf (travel = 0), noch nichts bewegt sich.
  expect(knotenPositionen(0.05, N)).toEqual(ruheKnoten(N));
});

test('die Front läuft von unten rechts nach oben links: die Ecke oben links löst sich zuletzt', () => {
  const ruhe = ruheKnoten(N);
  const p04 = knotenPositionen(0.4, N);
  const obenLinks = 0;
  const untenRechts = (N + 1) * (N + 1) - 1;
  expect(p04[obenLinks]).toEqual(ruhe[obenLinks]);
  expect(p04[untenRechts]).not.toEqual(ruhe[untenRechts]);
});

test('abgelöste Knoten heben ab: nach oben (kleineres y) und in Richtung der Aufrollung', () => {
  const ruhe = ruheKnoten(N);
  const p05 = knotenPositionen(0.5, N);
  const untenRechts = (N + 1) * (N + 1) - 1;
  // Prototyp: y -= height*.88 (+ extra*.28), der abgelöste Teil liegt ÜBER
  // seiner Ruhelage; x wandert wegen der Umkehrung um die Rolle nach links.
  expect(p05[untenRechts].y).toBeLessThan(ruhe[untenRechts].y);
  expect(p05[untenRechts].x).toBeLessThan(ruhe[untenRechts].x);
});

test('Referenzwerte des Prototyps bei p=0.5 (nachgerechnet mit dessen Formeln)', () => {
  const g = grenzen(knotenPositionen(0.5, N));
  expect(g.minX).toBeCloseTo(110, 0);
  expect(g.minY).toBeCloseTo(-35, 0);
  expect(g.maxX).toBeCloseTo(618, 0);
  expect(g.maxY).toBeCloseTo(562, 0);
});

test('ab p=0.85 hat das Siegel die Bühne vollständig verlassen', () => {
  expect(knotenPositionen(0.8, N).some(imBild)).toBe(true);
  expect(knotenPositionen(0.85, N).some(imBild)).toBe(false);
  expect(knotenPositionen(1, N).some(imBild)).toBe(false);
});

test('ABGEZOGEN_AB_MS ist der Zeitpunkt, an dem die Bühne leer ist', () => {
  // 0.85 der Dauer, siehe Test darüber; ab hier darf der Inhalt kommen.
  expect(ABGEZOGEN_AB_MS).toBe(2295);
  expect(ABGEZOGEN_AB_MS).toBeLessThan(DAUER_MS);
});

test('Schatten: liegt in Ruhe unter dem Siegel, wandert mit, wird weicher und schwächer, und ist am Ende weg', () => {
  const s0 = schattenParameter(0);
  expect(s0).toEqual({ x: 360, y: 590, rx: 215, ry: 45, deckkraft: 0.2, weichheit: 16 });
  const s05 = schattenParameter(0.5);
  expect(s05.x).toBeGreaterThan(s0.x);
  expect(s05.y).toBeLessThan(s0.y);
  expect(s05.rx).toBeLessThan(s0.rx);
  expect(s05.deckkraft).toBeLessThan(s0.deckkraft);
  expect(s05.weichheit).toBeGreaterThan(s0.weichheit);
  // Der Prototyp lässt bei p=1 einen Rest von 0.09 stehen; im App-Screen
  // wird der Platz danach vom Inhalt übernommen, deshalb läuft der Schatten
  // hier auf null aus, ohne dass sich sein Verlauf davor ändert.
  // Bis 0.85 exakt der Prototyp: 0.20 * (1 - 0.55 * smooth((p - 0.05) / 0.85)).
  const t = (0.85 - 0.05) / 0.85;
  const smooth = t * t * (3 - 2 * t);
  expect(schattenParameter(0.85).deckkraft).toBeCloseTo(0.2 * (1 - 0.55 * smooth), 6);
  expect(schattenParameter(0.925).deckkraft).toBeGreaterThan(0);
  expect(schattenParameter(0.925).deckkraft).toBeLessThan(schattenParameter(0.85).deckkraft);
  expect(schattenParameter(1).deckkraft).toBe(0);
});
