import { cropFor, clamp, bounds, baseFactor } from '../crop';

const LANDSCAPE = { width: 4000, height: 3000 };
const PORTRAIT = { width: 1000, height: 2500 };
const SQUARE = { width: 2000, height: 2000 };
const FRAME = 300;

const centered = { zoom: 1, offsetX: 0, offsetY: 0 };

test('baseFactor goes by the shorter edge', () => {
  // Otherwise a gap would remain across the long edge inside the frame.
  expect(baseFactor(LANDSCAPE, FRAME)).toBeCloseTo(300 / 3000);
  expect(baseFactor(PORTRAIT, FRAME)).toBeCloseTo(300 / 1000);
});

// Left untouched, this should yield exactly what the automatic crop used to
// do: centered on the shorter edge.
test('untouched yields the centered crop', () => {
  expect(cropFor(centered, LANDSCAPE, FRAME)).toEqual({
    originX: 500, originY: 0, width: 3000, height: 3000,
  });
  expect(cropFor(centered, PORTRAIT, FRAME)).toEqual({
    originX: 0, originY: 750, width: 1000, height: 1000,
  });
});

test('a square original is not cropped at all', () => {
  expect(cropFor(centered, SQUARE, FRAME)).toEqual({
    originX: 0, originY: 0, width: 2000, height: 2000,
  });
});

// Direction is the spot where a sign tips over most easily: panning the
// image to the right shows the LEFT part of the original.
test('panning the image to the right shows further left in the original', () => {
  const a = cropFor({ zoom: 1, offsetX: 30, offsetY: 0 }, LANDSCAPE, FRAME);
  // 30 screen points at factor 0.1 are 300 original pixels.
  expect(a.originX).toBe(200);
  expect(a.originY).toBe(0);
});

test('panning the image down shows further up in the original', () => {
  const a = cropFor({ zoom: 1, offsetY: 75, offsetX: 0 }, PORTRAIT, FRAME);
  // Factor 0.3, 75 points are 250 original pixels, up from 750.
  expect(a.originY).toBe(500);
});

test('zoom shrinks the crop by exactly this factor', () => {
  const a = cropFor({ zoom: 2, offsetX: 0, offsetY: 0 }, LANDSCAPE, FRAME);
  expect(a.width).toBe(1500);
  expect(a.height).toBe(1500);
  // Still centered: (4000-1500)/2 and (3000-1500)/2.
  expect(a.originX).toBe(1250);
  expect(a.originY).toBe(750);
});

// Without this floor, gaps would appear inside the frame where there is
// nothing.
test('zoom below 1 is raised to 1', () => {
  expect(clamp({ zoom: 0.3, offsetX: 0, offsetY: 0 }, LANDSCAPE, FRAME).zoom).toBe(1);
});

test('at zoom 1, the portrait can only be panned vertically', () => {
  const g = bounds(PORTRAIT, FRAME, 1);
  expect(g.x).toBe(0);
  expect(g.y).toBeCloseTo((2500 * 0.3 - 300) / 2);
});

// Panning past the edge must never expose anything.
test('panning too far is clamped to the edge', () => {
  const tooFar = cropFor({ zoom: 1, offsetX: 99999, offsetY: 0 }, LANDSCAPE, FRAME);
  expect(tooFar.originX).toBe(0);
  const reversed = cropFor({ zoom: 1, offsetX: -99999, offsetY: 0 }, LANDSCAPE, FRAME);
  expect(reversed.originX).toBe(1000); // 4000 - 3000
});

// The crop must always sit fully inside the image, otherwise the native crop
// rejects it instead of clamping it.
test('the crop stays inside the image for odd sizes and zoom', () => {
  const odd = { width: 4031, height: 3007 };
  for (const zoom of [1, 1.37, 2.5, 7.9]) {
    for (const offsetX of [-9999, -13, 0, 44, 9999]) {
      for (const offsetY of [-9999, -7, 0, 21, 9999]) {
        const a = cropFor({ zoom, offsetX, offsetY }, odd, FRAME);
        expect(a.originX).toBeGreaterThanOrEqual(0);
        expect(a.originY).toBeGreaterThanOrEqual(0);
        expect(a.originX + a.width).toBeLessThanOrEqual(odd.width);
        expect(a.originY + a.height).toBeLessThanOrEqual(odd.height);
        expect(a.width).toBe(a.height);
        expect(a.width).toBeGreaterThan(0);
      }
    }
  }
});
