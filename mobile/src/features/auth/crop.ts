// The math behind the crop window: from what is visible on screen, determine
// the region in the ORIGINAL IMAGE.
//
// Why this is its own file: it is the part where a sign error or a forgotten
// factor hides silently, the result then looks "somehow shifted", and on
// device that is hard to pin down. Without UI, on the other hand, it is
// exhaustively checkable with a handful of numbers.
//
// The model in one sentence: a square frame stays fixed, the image beneath
// it can be panned and zoomed; what gets returned is the region of the
// original that ends up inside the frame.

export type SourceSize = { width: number; height: number };

export type Framing = {
  // Zoom, 1 = the image just barely fills the frame ("cover"). Less than 1
  // is not allowed, otherwise empty margins would appear inside the frame.
  zoom: number;
  // Offset in screen points, measured from the centered position. Positive =
  // the image moves right resp. down.
  offsetX: number;
  offsetY: number;
};

export type Crop = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

// The factor at which the original is displayed when it just fills the
// frame: the SHORTER edge determines it, otherwise a gap would remain across
// the other edge.
export function baseFactor(source: SourceSize, frame: number): number {
  return frame / Math.min(source.width, source.height);
}

// How far the image can be panned at all at this zoom before an edge slides
// into the frame, half the overhang per axis.
export function bounds(
  source: SourceSize,
  frame: number,
  zoom: number,
): { x: number; y: number } {
  const factor = baseFactor(source, frame) * zoom;
  return {
    x: Math.max(0, (source.width * factor - frame) / 2),
    y: Math.max(0, (source.height * factor - frame) / 2),
  };
}

// Keeps a framing within what is allowed: zoom never below 1 (otherwise
// gaps), offset never so far that an image edge becomes visible.
//
// Deliberately here and not only at crop time: this way the surface shows
// exactly what comes out in the end, an image that can be pushed further
// than it is allowed to and springs back on release feels broken.
export function clamp(framing: Framing, source: SourceSize, frame: number): Framing {
  const zoom = Math.max(1, framing.zoom);
  const g = bounds(source, frame, zoom);
  return {
    zoom,
    offsetX: Math.min(g.x, Math.max(-g.x, framing.offsetX)),
    offsetY: Math.min(g.y, Math.max(-g.y, framing.offsetY)),
  };
}

// The actual translator: framing to crop in original coordinates.
//
// Derivation, so the signs stay traceable: inside the frame, a square of
// side length `frame / factor` of the original is visible. Without an
// offset it sits centered. An offset to the right (positive) moves the
// IMAGE to the right, which makes the window move LEFT within the original,
// hence the minus.
export function cropFor(
  framing: Framing,
  source: SourceSize,
  frame: number,
): Crop {
  const safe = clamp(framing, source, frame);
  const factor = baseFactor(source, frame) * safe.zoom;
  const side = frame / factor;

  const raw = {
    x: (source.width - side) / 2 - safe.offsetX / factor,
    y: (source.height - side) / 2 - safe.offsetY / factor,
  };

  // Round to whole pixels and clamp into the image bounds. Rounding can
  // otherwise push the crop one pixel past the edge, and the native crop
  // rejects that instead of clamping it.
  const wholeSide = Math.min(
    Math.round(side),
    Math.floor(source.width),
    Math.floor(source.height),
  );
  return {
    originX: Math.min(Math.max(0, Math.round(raw.x)), source.width - wholeSide),
    originY: Math.min(Math.max(0, Math.round(raw.y)), source.height - wholeSide),
    width: wholeSide,
    height: wholeSide,
  };
}
