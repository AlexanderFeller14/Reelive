// Die Physik des Siegel-Abziehens, portiert aus dem Canvas-Prototyp
// docs/design/reelive-sticker-peel.html (Codex, 2026-08-18). Alle Zahlen sind
// dessen Zahlen: eine quadratische Bühne von 720 Einheiten, das Siegel 500
// breit bei (110, 105), eine Rolle mit Radius 54. Die Komponente skaliert die
// Bühne auf ihre Punktgrösse; hier wird nichts umgerechnet, damit sich jede
// Formel Zeile für Zeile mit dem Prototyp vergleichen lässt.
//
// Alles hier ist reine Rechnung ohne React und ohne Skia, damit es (a) in
// Jest gegen die Referenzwerte des Prototyps testbar ist und (b) als Worklet
// auf dem UI-Thread laufen kann (`useDerivedValue` in SiegelAbziehen.tsx).
// Deshalb tragen die Funktionen, die pro Frame laufen, die 'worklet'-
// Direktive, und sie greifen nur auf Zahlen und aufeinander zu.
//
// Das Bild des Prototyps: das Siegel klebt wie ein flexibler Sticker. Eine
// diagonale Front läuft von unten rechts nach oben links; was hinter ihr
// liegt, klebt noch flach; was vor ihr liegt, rollt sich um einen Zylinder
// (Radius 54) und hebt ab; was schon eine halbe Umdrehung hinter sich hat,
// fliegt gerade weiter nach oben links aus der Bühne hinaus.

export const BUEHNE = 720;
export const SIEGEL = { x: 110, y: 105, groesse: 500 } as const;
export const DAUER_MS = 2700;

// Ab 85 % der Dauer liegt kein einziger Knoten mehr in der Bühne (siehe Test):
// das Siegel ist weg, nur der Schatten klingt noch aus. Für die Person ist
// das der Moment, in dem der Recap kommen darf; die restlichen 400 ms hätte
// sie sonst vor einer leeren Fläche gewartet.
export const ABGEZOGEN_AB_MS = Math.round(DAUER_MS * 0.85);

// Feinheit des Netzes (Knoten pro Kante). Der Prototyp nimmt 42; auf dem
// Gerät reichen 36 (1369 Knoten, 2592 Dreiecke): pro Zelle knapp 14 Einheiten,
// gut zwölf Zellen um den Umfang der Rolle (π · 54 ≈ 170), die Krümmung
// bleibt rund. Jede Zahl darüber kostet nur UI-Thread-Zeit pro Frame.
export const RASTER = 36;

const RADIUS = 54;
const SQRT2 = Math.SQRT2;

export type Punkt = { x: number; y: number };

function clamp(v: number): number {
  'worklet';
  return Math.max(0, Math.min(1, v));
}

// Smoothstep, wie im Prototyp.
function smooth(t: number): number {
  'worklet';
  const c = clamp(t);
  return c * c * (3 - 2 * c);
}

// Ruhelage: (n+1)² Knoten zeilenweise (erst y, dann x) über das Siegel gelegt.
// Reihenfolge ist Vertrag mit texturKoordinaten() und dreieckIndizes().
export function ruheKnoten(n: number): Punkt[] {
  const knoten: Punkt[] = [];
  for (let y = 0; y <= n; y++) {
    for (let x = 0; x <= n; x++) {
      knoten.push({ x: SIEGEL.x + (x / n) * SIEGEL.groesse, y: SIEGEL.y + (y / n) * SIEGEL.groesse });
    }
  }
  return knoten;
}

// Texturkoordinaten im Pixelraum des Bildes (Skia liest sie ohne `rect` am
// ImageShader genau so), gleiche Reihenfolge wie ruheKnoten().
export function texturKoordinaten(n: number, breite: number, hoehe: number): Punkt[] {
  const tex: Punkt[] = [];
  for (let y = 0; y <= n; y++) {
    for (let x = 0; x <= n; x++) {
      tex.push({ x: (x / n) * breite, y: (y / n) * hoehe });
    }
  }
  return tex;
}

// Zwei Dreiecke pro Zelle, (a,b,c) und (a,c,d) wie im Prototyp, zeilenweise.
// Die Reihenfolge ist nicht nur Ordnung, sie ist Zeichenreihenfolge: Skia malt
// die Dreiecke in dieser Folge übereinander (SrcOver, kein Tiefentest), und
// weil die abgelösten Teile unten rechts liegen und nach oben links über die
// noch klebenden fliegen, müssen sie SPÄTER gemalt werden. Zeilenweise von
// oben nach unten leistet genau das, exakt wie die Schleife im Prototyp.
export function dreieckIndizes(n: number): number[] {
  const idx: number[] = [];
  const breite = n + 1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const a = y * breite + x;
      const b = a + 1;
      const c = a + breite + 1;
      const d = a + breite;
      idx.push(a, b, c, a, c, d);
    }
  }
  return idx;
}

// Position aller Knoten bei Fortschritt p (0 … 1, lineare Zeit). Läuft pro
// Frame als Worklet.
export function knotenPositionen(p: number, n: number): Punkt[] {
  'worklet';
  const travel = smooth((p - 0.05) / 0.9);
  const maxS = (SIEGEL.x + SIEGEL.y + 2 * SIEGEL.groesse) / SQRT2;
  const minS = (SIEGEL.x + SIEGEL.y) / SQRT2;
  const front = maxS + 28 - (maxS - minS + 190) * travel;
  const knoten: Punkt[] = [];
  for (let iy = 0; iy <= n; iy++) {
    for (let ix = 0; ix <= n; ix++) {
      const ox = SIEGEL.x + (ix / n) * SIEGEL.groesse;
      const oy = SIEGEL.y + (iy / n) * SIEGEL.groesse;
      // Diagonalkoordinaten: s läuft entlang der Abzugsrichtung, t quer dazu.
      const s = (ox + oy) / SQRT2;
      const t = (ox - oy) / SQRT2;
      const d = s - front;
      if (d <= 0) {
        knoten.push({ x: ox, y: oy });
        continue;
      }
      const theta = Math.min(d / RADIUS, Math.PI);
      const extra = Math.max(0, d - Math.PI * RADIUS);
      const curledS = front + RADIUS * Math.sin(theta) - extra;
      const height = RADIUS * (1 - Math.cos(theta));
      let x = (curledS + t) / SQRT2 + height * 0.52;
      let y = (curledS - t) / SQRT2 - height * 0.88;
      if (extra > 0) {
        x += extra * 0.22;
        y -= extra * 0.28;
      }
      knoten.push({ x, y });
    }
  }
  return knoten;
}

export type Schatten = {
  x: number;
  y: number;
  rx: number;
  ry: number;
  deckkraft: number;
  // Gauss-Sigma in Bühnen-Einheiten (der Prototyp: CSS blur(px)).
  weichheit: number;
};

// Der Bodenschatten unter dem Siegel: wandert mit dem Abheben nach oben
// rechts, wird kleiner, weicher und schwächer. Bis 0.85 exakt der Prototyp;
// dessen Rest von 0.09 bei p=1 läuft hier in den letzten 15 % auf null aus,
// weil im Screen danach der Inhalt an diese Stelle kommt und ein stehen
// gebliebener Schatten-Schleier dort nichts mehr zu suchen hat.
export function schattenParameter(p: number): Schatten {
  'worklet';
  const sp = smooth((p - 0.05) / 0.85);
  const ausklang = 1 - smooth((p - 0.85) / 0.15);
  return {
    x: 360 + 80 * sp,
    y: 590 - 70 * sp,
    rx: 215 - 70 * sp,
    ry: 45 - 17 * sp,
    deckkraft: 0.2 * (1 - 0.55 * sp) * ausklang,
    weichheit: 16 + 22 * sp,
  };
}
