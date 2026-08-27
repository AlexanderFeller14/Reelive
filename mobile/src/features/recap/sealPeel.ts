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
// SealPeel.tsx). That's why the functions that run per frame carry
// the 'worklet' directive, and touch only numbers and each other.
//
// The prototype's picture: the seal sticks like a flexible sticker. A
// diagonal front runs from bottom right to top left; whatever sits behind
// it still sticks flat; whatever sits in front of it rolls around a
// cylinder (radius 54) and lifts off; whatever has already completed half a
// turn keeps flying straight up and to the left out of the stage.

export const STAGE = 720;
export const SEAL = { x: 110, y: 105, size: 500 } as const;
// The prototype's clock was 2700 ms, which left the seal barely lifted after
// a second. Straffed so the peel PLAYS inside roughly that first second, then
// eased back out again because 1500 ran hectically (Alex, 27.08.). The
// movement curve itself is the prototype's, only its clock is ours.
export const DURATION_MS = 1900;

// The seal does not fly out of frame any more, it BREAKS UP where it lies:
// along the diagonal from top left to bottom right, and early enough that it
// never climbs over the faces of the senders sitting just above the wax on
// the letter (measured: from about p=0.5 it would start leaving its stage).
//
// Because it now travels for a full second before breaking up, it leaves its
// stage on the way, and the canvas has to reach out that far: a canvas cut to
// the stage slices the seal off along a straight edge in mid-picture.
// Where the two phases meet. The dissolve sets in around the moment the seal
// LIFTS OFF (measured: from about p=0.5 it leaves its resting height), so the
// breaking up and the flying are one movement rather than two acts.
const DISSOLVE_LIFTS_OFF_AT = 0.5;
// How wide the half-gone zone is, in stage units, at the start and at the end
// of the dissolve. It WIDENS as it travels, which is what makes the seal fray
// out instead of being wiped away behind a ruler.
const SOFT_FROM = 170;
const SOFT_TO = 430;
export const FLIGHT_ROOM = { left: 370, top: 800 } as const;

export const DISSOLVE_SPAN = {
  from: DISSOLVE_LIFTS_OFF_AT,
  // Ends before `travel` saturates at 0.95, so the seal is gone while still
  // moving rather than parking in mid-air and fading on the spot. It does
  // climb past the faces on the letter on its way, which is the price of
  // seeing the peel at all (Alex chose that trade on 27.08.).
  to: 0.85,
} as const;
// The moment the seal counts as gone, and therefore the moment the recap may
// appear. That is 99% into the DISSOLVE: what is left of the seal by then is
// a hair's breadth, and waiting for the last percent (let alone for the seal
// to leave the frame, as this once did) would put a standstill between the
// seal going and the letter starting to make room.
const HANDOVER_AT = 0.99;
export const PEELED_AT_MS = Math.round(
  DURATION_MS * (DISSOLVE_SPAN.from + HANDOVER_AT * (DISSOLVE_SPAN.to - DISSOLVE_SPAN.from))
);

// When the seal has COME OFF and starts to break up: long before the last of
// it has dissolved, and the moment the show behind it may begin.
export const LIFT_OFF_MS = Math.round(DURATION_MS * DISSOLVE_SPAN.from);

// How long the seal spends falling apart. The letter withdraws over exactly
// this stretch, so the card, its ground and the seal all leave together and
// the whole thing reads as ONE movement instead of a card that goes and a
// seal that is still there afterwards.
export const DISSOLVE_MS = PEELED_AT_MS - LIFT_OFF_MS;

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

// The moving edge of the dissolve, as the two points of a linear gradient
// running along the diagonal (1,1): everything before `start` is already
// gone, everything after `end` still stands, and in between it breaks up.
//
// Sits below `clamp` on purpose: a worklet captures its closure where it is
// defined, and a helper declared further down is not in it.
export function dissolveEdge(p: number): { start: Point; end: Point } {
  'worklet';
  const t = clamp((p - DISSOLVE_SPAN.from) / (DISSOLVE_SPAN.to - DISSOLVE_SPAN.from));
  // Quadratic ease-in: the front sets in gently and then carries through,
  // rather than starting at full speed like a wipe.
  const eased = t * t;
  const soft = SOFT_FROM + (SOFT_TO - SOFT_FROM) * eased;
  // Where the seal begins and ends along that diagonal, at rest.
  const restFrom = (SEAL.x + SEAL.y) / SQRT2;
  const restTo = (SEAL.x + SEAL.size + SEAL.y + SEAL.size) / SQRT2;
  // Starts one soft zone BEFORE the seal (nothing gone yet) and finishes one
  // past it (nothing left).
  const s = restFrom - soft + eased * (restTo - restFrom + 2 * soft);
  return {
    start: { x: s / SQRT2, y: s / SQRT2 },
    end: { x: (s + soft) / SQRT2, y: (s + soft) / SQRT2 },
  };
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

// The prototype's floor shadow is gone: it was drawn for red wax lying on a
// LIGHT background, and on the letter's dark card the warm brown blur read as
// a dirty rim around the seal rather than as a shadow. Only the seal itself
// is on that stage now.
