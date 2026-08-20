import {
  activeStep,
  clamp,
  label,
  fingerDistance,
  multiCamTarget,
  nativeFactor,
  zoomDevice,
  dragFactor,
  type Lens,
} from '../zoom';

const lens = (over: Partial<Lens> = {}): Lens => ({
  name: 'Rückkamera',
  type: 'wide',
  components: [],
  switchPoints: [],
  ...over,
});

// The virtual device of an iPhone 17 Pro Max: ultra-wide, main and tele in
// one. The switch points are the factors at which iOS switches lenses, and
// at the same time the steps Apple offers in the Camera app.
const triple = (): Lens =>
  lens({
    name: 'Rückseitige Dreifach-Kamera',
    type: 'triple',
    components: ['ultraWide', 'wide', 'telephoto'],
    switchPoints: [2, 8],
  });

test('out of several cameras, the one that combines the most lenses wins', () => {
  const chosen = zoomDevice([lens(), triple(), lens({ type: 'ultraWide' })]);
  expect(chosen?.name).toBe('Rückseitige Dreifach-Kamera');
});

test('the steps are the device\'s switch points, relative to the widest lens', () => {
  expect(zoomDevice([triple()])?.steps).toEqual([0.5, 1, 4]);
});

test('without an ultra-wide, the row starts at 1', () => {
  // Wide plus tele (iPhone X to 11 Pro): there the native factor 1.0 already
  // IS the display "1x", so the row doesn't shift.
  const dual = lens({ type: 'dual', components: ['wide', 'telephoto'], switchPoints: [2] });
  expect(zoomDevice([dual])?.steps).toEqual([1, 2]);
});

test('a device with only one lens has nothing to choose', () => {
  expect(zoomDevice([lens()])).toBeNull();
});

test('without lenses (Android, Simulator), there is no row', () => {
  expect(zoomDevice([])).toBeNull();
});

// What the user reads and what the device understands are two numbers: on a
// device with an ultra-wide, factor 2 sits between them.
test('the displayed 4× is factor 8 for the device', () => {
  expect(nativeFactor(4, 0.5)).toBe(8);
});

test('without an ultra-wide, display and native factor are the same', () => {
  expect(nativeFactor(2, 1)).toBe(2);
});

// The bounds come natively from the device (minAvailableVideoZoomFactor /
// maxAvailableVideoZoomFactor) and so apply in its counting.
test('it doesn\'t go wider than the widest lens', () => {
  expect(clamp(0.2, { min: 1, max: 120 }, 0.5)).toBe(0.5);
});

test('it doesn\'t go closer than the device can either', () => {
  expect(clamp(999, { min: 1, max: 120 }, 0.5)).toBe(60);
});

test('within the bounds the factor stays untouched', () => {
  expect(clamp(2.3, { min: 1, max: 120 }, 0.5)).toBe(2.3);
});

test.each([
  [0.5, '0,5×'],
  [1, '1×'],
  [4, '4×'],
  [12, '12×'],
  [2.34, '2,3×'],
  [1.96, '2×'],
  // From two digits on without a decimal place, like in the Camera app:
  // "12,5×" would be five characters and run out of the narrow step.
  [12.4, '12×'],
  [12.5, '13×'],
  [27.8, '28×'],
])('%p reads as %p on the step', (factor, expected) => {
  expect(label(factor)).toBe(expected);
});

test('between two steps the smaller one stays active', () => {
  // Like in the Camera app: the "1×" step then carries the running value.
  expect(activeStep(2.3, [0.5, 1, 4])).toBe(1);
});

test('exactly on a step, that one is the active one', () => {
  expect(activeStep(4, [0.5, 1, 4])).toBe(4);
});

test('below the first step, the first one stays active', () => {
  expect(activeStep(0.4, [0.5, 1, 4])).toBe(0.5);
});

// The pinch measures the distance between the two fingers; its ratio to the
// distance at touch-down is the factor by which it zooms.
test('the distance of two fingers is the stretch between them', () => {
  expect(
    fingerDistance([
      { pageX: 0, pageY: 0 },
      { pageX: 3, pageY: 4 },
    ])
  ).toBe(5);
});

test('with a single finger there is no distance', () => {
  expect(fingerDistance([{ pageX: 0, pageY: 0 }])).toBeNull();
});

test('with more than two fingers down, the first two count', () => {
  expect(
    fingerDistance([
      { pageX: 0, pageY: 0 },
      { pageX: 0, pageY: 8 },
      { pageX: 300, pageY: 300 },
    ])
  ).toBe(8);
});

// --- Drag zoom (spec 2026-08-13-aufnahme-tempo-design.md §7) ---
//
// The pull is the vertical finger movement since touch-down, positive
// upward. The mapping is exponential (zoom is multiplicative, a linear path
// feels sluggish at the top end) and the reference is the factor at capture
// start, not 1×.
describe('dragFactor', () => {
  const BOUNDS = { min: 1, max: 120 }; // device counting, as zoomLimits delivers
  const BASE = 0.5; // ultra-wide device: display bounds are 0.5× to 60×
  const DISTANCES = { up: 500, down: 100 };

  test('pull 0 returns the start factor', () => {
    expect(dragFactor(0, 1, BOUNDS, BASE, DISTANCES)).toBe(1);
  });

  test('the full path upward reaches the maximum', () => {
    expect(dragFactor(500, 1, BOUNDS, BASE, DISTANCES)).toBeCloseTo(60);
  });

  test('beyond the path it stays at the maximum', () => {
    expect(dragFactor(1600, 1, BOUNDS, BASE, DISTANCES)).toBeCloseTo(60);
  });

  test('exponential: the halfway path sits at the geometric mean', () => {
    // From 1× to 60×, half the path is √60, not 30.5.
    expect(dragFactor(250, 1, BOUNDS, BASE, DISTANCES)).toBeCloseTo(Math.sqrt(60));
  });

  test('the full path downward reaches the minimum', () => {
    expect(dragFactor(-100, 1, BOUNDS, BASE, DISTANCES)).toBeCloseTo(0.5);
  });

  test('beyond the path downward it stays at the minimum', () => {
    expect(dragFactor(-400, 1, BOUNDS, BASE, DISTANCES)).toBeCloseTo(0.5);
  });

  test('a start at the maximum stays there when pulling up', () => {
    expect(dragFactor(300, 60, BOUNDS, BASE, DISTANCES)).toBeCloseTo(60);
  });

  test('the reference is the start factor, not 1×', () => {
    // Someone starting at 4× and pulling the full path also lands at the
    // maximum: the path always covers the stretch from the start factor to
    // the bound.
    expect(dragFactor(500, 4, BOUNDS, BASE, DISTANCES)).toBeCloseTo(60);
    expect(dragFactor(-100, 4, BOUNDS, BASE, DISTANCES)).toBeCloseTo(0.5);
  });
});

describe('multiCamTarget: the MultiCam mapping from display to camera and factor', () => {
  it('front stays front, below 1× the factor clamps to 1', () => {
    expect(multiCamTarget(0.5, 'front', true)).toEqual({ camera: 'front', factor: 1 });
    expect(multiCamTarget(2, 'front', true)).toEqual({ camera: 'front', factor: 2 });
  });
  it('0.5× on the back is the ultra-wide at factor 1', () => {
    expect(multiCamTarget(0.5, 'back', true)).toEqual({ camera: 'ultrawide', factor: 1 });
  });
  it('0.9× is still within the ultra-wide, scaled by 2', () => {
    expect(multiCamTarget(0.9, 'back', true)).toEqual({ camera: 'ultrawide', factor: 1.8 });
  });
  it('from 1× on, the wide lens takes over with the display factor', () => {
    expect(multiCamTarget(1, 'back', true)).toEqual({ camera: 'wide', factor: 1 });
    expect(multiCamTarget(3.5, 'back', true)).toEqual({ camera: 'wide', factor: 3.5 });
  });
  it('without an ultra-wide, below 1× it clamps to 1 on the wide lens', () => {
    expect(multiCamTarget(0.5, 'back', false)).toEqual({ camera: 'wide', factor: 1 });
  });
});
