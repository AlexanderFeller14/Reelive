import {
  STAGE,
  DURATION_MS,
  PEELED_AT_MS,
  SEAL,
  DISSOLVE_SPAN,
  dissolveEdge,
  triangleIndices,
  nodePositions,
  restNodes,
  textureCoordinates,
  FLIGHT_ROOM,
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
  // The geometry is the prototype's; the CLOCK is not. The peel has to play
  // inside the first second on the letter, and the prototype's 2700 ms left
  // the seal barely lifted by then.
  expect(DURATION_MS).toBe(1900);
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

// The seal is not watched out of the stage any more: it dissolves long
// before it would get there (see the dissolve tests below), so the moment
// content may appear is the end of the dissolve, not the emptying of the
// stage. That keeps the letter from standing open for another second with
// nothing on it.
test('PEELED_AT_MS is the point at which nothing of the seal is left to see', () => {
  // 99% into the dissolve, not 100%: what is left by then is a hair's
  // breadth, and waiting for the last percent would put a standstill between
  // the seal going and the card starting to make room (Alex, 27.08.).
  const span = DISSOLVE_SPAN.to - DISSOLVE_SPAN.from;
  expect(PEELED_AT_MS).toBe(Math.round(DURATION_MS * (DISSOLVE_SPAN.from + 0.99 * span)));
  expect(PEELED_AT_MS).toBeLessThan(Math.round(DURATION_MS * DISSOLVE_SPAN.to));
  // Well before the animation itself ends: the seal used to be watched all
  // the way out of frame, which left the letter standing open and bare.
  expect(PEELED_AT_MS).toBeLessThan(DURATION_MS * 0.9);
});

// The seal breaks up along the diagonal from TOP LEFT to bottom right while
// it flies off.
//
// Direction as a projection onto (1,1)/√2: a point's position along that
// diagonal is (x + y)/√2, small at the top left, large at the bottom right.
const along = (pt: { x: number; y: number }) => (pt.x + pt.y) / Math.SQRT2;

// The peel PLAYS first and only then breaks up, but the two overlap: the
// dissolve sets in around the moment the seal lifts off, not once it is
// nearly gone.
test('the peel plays for roughly a second, then the seal breaks up while it flies', () => {
  const startsAt = DISSOLVE_SPAN.from * DURATION_MS;
  expect(startsAt).toBeGreaterThan(800);
  expect(startsAt).toBeLessThan(1000);

  // Up to that point the seal still stands whole: the edge has not reached
  // its top-left corner yet.
  const justBefore = dissolveEdge(DISSOLVE_SPAN.from);
  expect(along(justBefore.end)).toBeLessThanOrEqual(along({ x: SEAL.x, y: SEAL.y }));

  // It then has room to breathe rather than being wiped away in a blink.
  const window = (DISSOLVE_SPAN.to - DISSOLVE_SPAN.from) * DURATION_MS;
  expect(window).toBeGreaterThan(500);
  expect(window).toBeLessThan(800);
});

// What makes it read as breaking up rather than as a ruler wiping across:
// the zone in which the seal is half gone WIDENS as it travels, and the
// front sets in gently instead of starting at full speed.
test('the dissolve frays out: its soft zone widens as it travels', () => {
  const span = DISSOLVE_SPAN.to - DISSOLVE_SPAN.from;
  const width = (p: number) => {
    const e = dissolveEdge(p);
    return along(e.end) - along(e.start);
  };
  const early = width(DISSOLVE_SPAN.from + span * 0.1);
  const late = width(DISSOLVE_SPAN.from + span * 0.9);
  expect(late).toBeGreaterThan(early * 1.5);
});

test('the dissolve sets in gently rather than at full speed', () => {
  const span = DISSOLVE_SPAN.to - DISSOLVE_SPAN.from;
  const at = (f: number) => along(dissolveEdge(DISSOLVE_SPAN.from + span * f).start);
  const total = at(1) - at(0);
  // Half way through its window it has covered clearly less than half the
  // distance: the front eases in.
  expect(at(0.5) - at(0)).toBeLessThan(total * 0.4);
});

test('the dissolve runs from the top left to the bottom right', () => {
  const span = DISSOLVE_SPAN.to - DISSOLVE_SPAN.from;
  const early = dissolveEdge(DISSOLVE_SPAN.from + span * 0.25);
  const late = dissolveEdge(DISSOLVE_SPAN.from + span * 0.75);
  // The edge travels in the direction of growing (x + y): towards bottom right.
  expect(along(late.start)).toBeGreaterThan(along(early.start));
  // Its two points lie on that same diagonal, transparent side first.
  expect(along(early.end)).toBeGreaterThan(along(early.start));
  // Both coordinates move together, so the edge stays at 45 degrees rather
  // than wiping straight down or straight across.
  expect(early.start.x).toBeCloseTo(early.start.y, 6);
  expect(early.end.x).toBeCloseTo(early.end.y, 6);
});

test('at rest the whole seal stands, and by the end nothing of it is left', () => {
  // The seal at rest spans this stretch of the diagonal.
  const restFrom = along({ x: SEAL.x, y: SEAL.y });
  const restTo = along({ x: SEAL.x + SEAL.size, y: SEAL.y + SEAL.size });

  // Before the dissolve starts, the edge sits entirely BEFORE the seal: its
  // opaque side covers everything.
  const atRest = dissolveEdge(0);
  expect(along(atRest.end)).toBeLessThanOrEqual(restFrom);

  // At the end it sits entirely BEYOND the seal: nothing is left covered.
  const atEnd = dissolveEdge(DISSOLVE_SPAN.to);
  expect(along(atEnd.start)).toBeGreaterThanOrEqual(restTo);

  // And it does not move on afterwards.
  expect(dissolveEdge(1)).toEqual(atEnd);
});

// While it is visible the seal travels well beyond its stage, and the canvas
// has to reach out that far: a canvas cut to the stage would slice it off
// along a straight edge in mid-picture.
test('the flight stays inside the room the canvas gives it, and needs all of it', () => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i <= 400; i++) {
    const p = (i / 400) * DISSOLVE_SPAN.to;
    const b = bounds(nodePositions(p, N));
    minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
  }
  expect(minX).toBeGreaterThanOrEqual(-FLIGHT_ROOM.left);
  expect(minY).toBeGreaterThanOrEqual(-FLIGHT_ROOM.top);
  // Down and to the right the stage itself is enough.
  expect(maxX).toBeLessThanOrEqual(STAGE);
  expect(maxY).toBeLessThanOrEqual(STAGE);
  // And the room is not oversized either.
  expect(minX).toBeLessThan(-FLIGHT_ROOM.left * 0.85);
  expect(minY).toBeLessThan(-FLIGHT_ROOM.top * 0.85);
});
