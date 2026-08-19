import {
  STAGE,
  DURATION_MS,
  PEELED_AT_MS,
  SEAL,
  triangleIndices,
  nodePositions,
  restNodes,
  shadowParameters,
  textureCoordinates,
} from '../sealPeel';

// Reference values come from docs/design/reelive-sticker-peel.html (canvas
// prototype, 720 stage, seal 500 at 110/105, radius 54): the numbers here
// were recomputed in Node using exactly that prototype's formulas. The
// module is the port of those formulas, the tests pin it to them.

const N = 42;

function bounds(points: { x: number; y: number }[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function inFrame(p: { x: number; y: number }) {
  return p.x >= 0 && p.x <= STAGE && p.y >= 0 && p.y <= STAGE;
}

test('stage and seal match the prototype', () => {
  expect(STAGE).toBe(720);
  expect(SEAL).toEqual({ x: 110, y: 105, size: 500 });
  expect(DURATION_MS).toBe(2700);
});

test('restNodes lays (n+1)² points row by row over the seal', () => {
  const nodes = restNodes(2);
  expect(nodes).toEqual([
    { x: 110, y: 105 }, { x: 360, y: 105 }, { x: 610, y: 105 },
    { x: 110, y: 355 }, { x: 360, y: 355 }, { x: 610, y: 355 },
    { x: 110, y: 605 }, { x: 360, y: 605 }, { x: 610, y: 605 },
  ]);
});

test('textureCoordinates sit in the image\'s pixel space, same order as the nodes', () => {
  const tex = textureCoordinates(2, 1254, 1254);
  expect(tex).toHaveLength(9);
  expect(tex[0]).toEqual({ x: 0, y: 0 });
  expect(tex[2]).toEqual({ x: 1254, y: 0 });
  expect(tex[4]).toEqual({ x: 627, y: 627 });
  expect(tex[8]).toEqual({ x: 1254, y: 1254 });
});

test('triangleIndices: two triangles per cell, row by row, indices point into the node grid', () => {
  const idx = triangleIndices(2);
  expect(idx).toHaveLength(2 * 2 * 2 * 3);
  // First cell: (0,0)-(1,0)-(1,1) and (0,0)-(1,1)-(0,1), same split as in
  // the prototype (a,b,c) and (a,c,d).
  expect(idx.slice(0, 6)).toEqual([0, 1, 4, 0, 4, 3]);
  // Last cell, bottom right.
  expect(idx.slice(-6)).toEqual([4, 5, 8, 4, 8, 7]);
  expect(Math.max(...idx)).toBe(8);
});

test('at p=0 the seal lies flat at rest, exactly on the rest nodes', () => {
  expect(nodePositions(0, N)).toEqual(restNodes(N));
  // The first 5% is a run-up (travel = 0), nothing moves yet.
  expect(nodePositions(0.05, N)).toEqual(restNodes(N));
});

test('the front runs from bottom right to top left: the top-left corner detaches last', () => {
  const rest = restNodes(N);
  const p04 = nodePositions(0.4, N);
  const topLeft = 0;
  const bottomRight = (N + 1) * (N + 1) - 1;
  expect(p04[topLeft]).toEqual(rest[topLeft]);
  expect(p04[bottomRight]).not.toEqual(rest[bottomRight]);
});

test('detached nodes lift off: upward (smaller y) and towards the roll direction', () => {
  const rest = restNodes(N);
  const p05 = nodePositions(0.5, N);
  const bottomRight = (N + 1) * (N + 1) - 1;
  // Prototype: y -= height*.88 (+ extra*.28), the detached part sits ABOVE
  // its rest position; x moves left because of the wrap around the roll.
  expect(p05[bottomRight].y).toBeLessThan(rest[bottomRight].y);
  expect(p05[bottomRight].x).toBeLessThan(rest[bottomRight].x);
});

test('prototype reference values at p=0.5 (recomputed with its formulas)', () => {
  const g = bounds(nodePositions(0.5, N));
  expect(g.minX).toBeCloseTo(110, 0);
  expect(g.minY).toBeCloseTo(-35, 0);
  expect(g.maxX).toBeCloseTo(618, 0);
  expect(g.maxY).toBeCloseTo(562, 0);
});

test('from p=0.85 onward the seal has completely left the stage', () => {
  expect(nodePositions(0.8, N).some(inFrame)).toBe(true);
  expect(nodePositions(0.85, N).some(inFrame)).toBe(false);
  expect(nodePositions(1, N).some(inFrame)).toBe(false);
});

test('PEELED_AT_MS is the point in time at which the stage is empty', () => {
  // 0.85 of the duration, see the test above; content may appear from here.
  expect(PEELED_AT_MS).toBe(2295);
  expect(PEELED_AT_MS).toBeLessThan(DURATION_MS);
});

test('shadow: sits under the seal at rest, keeps up, gets softer and weaker, and is gone by the end', () => {
  const s0 = shadowParameters(0);
  expect(s0).toEqual({ x: 360, y: 590, rx: 215, ry: 45, opacity: 0.2, softness: 16 });
  const s05 = shadowParameters(0.5);
  expect(s05.x).toBeGreaterThan(s0.x);
  expect(s05.y).toBeLessThan(s0.y);
  expect(s05.rx).toBeLessThan(s0.rx);
  expect(s05.opacity).toBeLessThan(s0.opacity);
  expect(s05.softness).toBeGreaterThan(s0.softness);
  // The prototype leaves a remainder of 0.09 at p=1; in the app screen the
  // content takes over that spot afterwards, so the shadow fades to zero
  // here instead, without its curve changing before that point.
  // Exactly the prototype up to 0.85: 0.20 * (1 - 0.55 * smooth((p - 0.05) / 0.85)).
  const t = (0.85 - 0.05) / 0.85;
  const smooth = t * t * (3 - 2 * t);
  expect(shadowParameters(0.85).opacity).toBeCloseTo(0.2 * (1 - 0.55 * smooth), 6);
  expect(shadowParameters(0.925).opacity).toBeGreaterThan(0);
  expect(shadowParameters(0.925).opacity).toBeLessThan(shadowParameters(0.85).opacity);
  expect(shadowParameters(1).opacity).toBe(0);
});
