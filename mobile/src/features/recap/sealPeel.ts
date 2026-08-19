// The physics of peeling off the seal, ported from the canvas prototype
// docs/design/reelive-sticker-peel.html (Codex, 2026-08-18). Every number
// here is that prototype's number: a square stage of 720 units, the seal
// 500 wide at (110, 105), a roll of radius 54. The component scales the
// stage to its own point size; nothing here gets converted, so every
// formula can be compared line by line with the prototype.
//
// Everything here is pure computation without React and without Skia, so
// it's (a) testable against the prototype's reference values in Jest and
// (b) can run as a worklet on the UI thread (`useDerivedValue` in
// SiegelAbziehen.tsx). That's why the functions that run per frame carry
// the 'worklet' directive, and touch only numbers and each other.
//
// The prototype's picture: the seal sticks like a flexible sticker. A
// diagonal front runs from bottom right to top left; whatever sits behind
// it still sticks flat; whatever sits in front of it rolls around a
// cylinder (radius 54) and lifts off; whatever has already completed half a
// turn keeps flying straight up and to the left out of the stage.

export const STAGE = 720;
export const SEAL = { x: 110, y: 105, size: 500 } as const;
export const DURATION_MS = 2700;

// From 85% of the duration onward, not a single node is left within the
// stage (see test): the seal is gone, only the shadow is still fading out.
// For the person watching, that's the moment the recap may appear; the
// remaining 400 ms would otherwise have been spent waiting in front of an
// empty area.
export const PEELED_AT_MS = Math.round(DURATION_MS * 0.85);

// Mesh resolution (nodes per edge). The prototype uses 42; on the device 36
// is enough (1369 nodes, 2592 triangles): just under 14 units per cell,
// a good twelve cells around the roll's circumference (π · 54 ≈ 170), the
// curvature stays round. Every number above this only costs UI-thread time
// per frame.
export const GRID_RESOLUTION = 36;

const RADIUS = 54;
const SQRT2 = Math.SQRT2;

export type Point = { x: number; y: number };

function clamp(v: number): number {
  'worklet';
  return Math.max(0, Math.min(1, v));
}

// Smoothstep, as in the prototype.
function smooth(t: number): number {
  'worklet';
  const c = clamp(t);
  return c * c * (3 - 2 * c);
}

export function restNodes(n: number): Point[] {
  const nodes: Point[] = [];
  for (let y = 0; y <= n; y++) {
    for (let x = 0; x <= n; x++) {
      nodes.push({ x: SEAL.x + (x / n) * SEAL.size, y: SEAL.y + (y / n) * SEAL.size });
    }
  }
  return nodes;
}

// Texture coordinates in the image's pixel space (that's exactly how Skia
// reads them without a `rect` on the ImageShader), same order as
// restNodes().
export function textureCoordinates(n: number, width: number, height: number): Point[] {
  const coords: Point[] = [];
  for (let y = 0; y <= n; y++) {
    for (let x = 0; x <= n; x++) {
      coords.push({ x: (x / n) * width, y: (y / n) * height });
    }
  }
  return coords;
}

// Skia paints the triangles in this order on top of each other (SrcOver, no
// depth test), and because the detached parts sit at the bottom right and
// fly up and to the left over the parts still stuck down, they must be
// painted LATER. Row by row from top to bottom achieves exactly that,
// exactly like the loop in the prototype.
export function triangleIndices(n: number): number[] {
  const idx: number[] = [];
  const rowWidth = n + 1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const a = y * rowWidth + x;
      const b = a + 1;
      const c = a + rowWidth + 1;
      const d = a + rowWidth;
      idx.push(a, b, c, a, c, d);
    }
  }
  return idx;
}

// Position of every node at progress p (0 … 1, linear time). Runs per frame
// as a worklet.
export function nodePositions(p: number, n: number): Point[] {
  'worklet';
  const travel = smooth((p - 0.05) / 0.9);
  const maxS = (SEAL.x + SEAL.y + 2 * SEAL.size) / SQRT2;
  const minS = (SEAL.x + SEAL.y) / SQRT2;
  const front = maxS + 28 - (maxS - minS + 190) * travel;
  const nodes: Point[] = [];
  for (let iy = 0; iy <= n; iy++) {
    for (let ix = 0; ix <= n; ix++) {
      const ox = SEAL.x + (ix / n) * SEAL.size;
      const oy = SEAL.y + (iy / n) * SEAL.size;
      // Diagonal coordinates: s runs along the peel direction, t across it.
      const s = (ox + oy) / SQRT2;
      const t = (ox - oy) / SQRT2;
      const d = s - front;
      if (d <= 0) {
        nodes.push({ x: ox, y: oy });
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
      nodes.push({ x, y });
    }
  }
  return nodes;
}

export type Shadow = {
  x: number;
  y: number;
  rx: number;
  ry: number;
  opacity: number;
  // Gaussian sigma in stage units (the prototype: CSS blur(px)).
  softness: number;
};

// The floor shadow under the seal, keeps up with it lifting off toward the
// top right; the prototype's remaining 0.09 at p=1 fades to zero here over
// the last 15% instead, because the screen's content takes over that spot
// afterwards and a lingering shadow veil has no business being there.
export function shadowParameters(p: number): Shadow {
  'worklet';
  const sp = smooth((p - 0.05) / 0.85);
  const fadeOut = 1 - smooth((p - 0.85) / 0.15);
  return {
    x: 360 + 80 * sp,
    y: 590 - 70 * sp,
    rx: 215 - 70 * sp,
    ry: 45 - 17 * sp,
    opacity: 0.2 * (1 - 0.55 * sp) * fadeOut,
    softness: 16 + 22 * sp,
  };
}
