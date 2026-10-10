/**
 * Geometry of rotated detections (the OBB wing detector).
 *
 * Pure functions, no DOM and no ONNX runtime, so they can be tested on their own. A detection is a
 * rectangle with centre (cx, cy), sides w and h and an angle in radians. The image y axis points down.
 * u = (cos a, sin a) runs along w and v = (-sin a, cos a) along h.
 */
import type { Detection } from "./yoloDetector";

export type Point = [number, number];

// The model reports weak, partly visible wings with a low confidence. This is the lowest one kept.
export const OBB_MIN_CONFIDENCE = 0.25;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/** The corners of the rotated rectangle, in order around it. */
export function obbCorners(
  cx: number,
  cy: number,
  w: number,
  h: number,
  angle: number,
): Point[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return (
    [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ] as const
  ).map(
    ([p, q]) =>
      [
        cx + p * (w / 2) * c - q * (h / 2) * s,
        cy + p * (w / 2) * s + q * (h / 2) * c,
      ] as Point,
  );
}

/** An axis-aligned box as a rotated rectangle with angle 0. */
export function axisAlignedGeometry(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const w = x2 - x1;
  const h = y2 - y1;
  return { cx, cy, w, h, angle: 0, corners: obbCorners(cx, cy, w, h, 0) };
}

/**
 * Decodes the end-to-end OBB output [1, rows, 7]. A row is [cx, cy, w, h, confidence, class, angle]
 * in pixels of the letterboxed model input. The model applies NMS itself, so none is applied here.
 * The result is in photo pixels and sorted by confidence. The corners are not clipped to the photo,
 * only the axis-aligned box (x1, y1, x2, y2) is.
 */
export function decodeObbRows(
  data: ArrayLike<number>,
  rows: number,
  cols: number,
  scale: number,
  padX: number,
  padY: number,
  origW: number,
  origH: number,
  minConf = OBB_MIN_CONFIDENCE,
): Detection[] {
  const detections: Detection[] = [];
  for (let i = 0; i < rows; i += 1) {
    const o = i * cols;
    const confidence = data[o + 4];
    if (!(confidence >= minConf)) continue;

    const cx = (data[o] - padX) / scale;
    const cy = (data[o + 1] - padY) / scale;
    const w = data[o + 2] / scale;
    const h = data[o + 3] / scale;
    const angle = data[o + 6];
    const corners = obbCorners(cx, cy, w, h, angle);
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    detections.push({
      x1: clamp(Math.min(...xs), 0, origW),
      y1: clamp(Math.min(...ys), 0, origH),
      x2: clamp(Math.max(...xs), 0, origW),
      y2: clamp(Math.max(...ys), 0, origH),
      confidence,
      classId: 0,
      className: "wing",
      cx,
      cy,
      w,
      h,
      angle,
      corners,
    });
  }
  return detections.sort((a, b) => b.confidence - a.confidence);
}

/**
 * The wing axis of a rotated rectangle: the long side, pointing right. Returns the long and the short
 * side and the angle of the axis in (-pi/2, pi/2]. The detector knows the axis but not which end is the
 * base of the wing, so the axis could point either way and "right" is the choice.
 */
export function axisAngle(w: number, h: number, angle: number) {
  let length = w;
  let width = h;
  let a = angle;
  if (width > length) {
    length = h;
    width = w;
    a += Math.PI / 2;
  }
  a = Math.atan2(Math.sin(a), Math.cos(a));
  if (a > Math.PI / 2) a -= Math.PI;
  else if (a <= -Math.PI / 2) a += Math.PI;
  return { length, width, angle: a };
}

/**
 * Where the checkbox of a detection goes, in canvas pixels. It sits above the highest corner (the
 * left one when two are level). When there is no room above, it sits under the lowest corner. The
 * checkbox always stays inside the canvas, also when corners lie outside the photo, so it can be
 * clicked. anchorY is the baseline of the confidence label next to it.
 */
export function checkboxAnchor(
  corners: Point[],
  scaleX: number,
  scaleY: number,
  canvasW: number,
  canvasH: number,
  size: number,
) {
  const pts = corners.map(([x, y]) => [x * scaleX, y * scaleY] as const);
  const top = pts.reduce((a, b) =>
    b[1] < a[1] || (b[1] === a[1] && b[0] < a[0]) ? b : a,
  );
  const bottom = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
  const above = top[1] > size;
  const anchor = above ? top : bottom;
  const cbX = clamp(anchor[0], 0, canvasW - size);
  const cbY = clamp((above ? top[1] : bottom[1] + size) - size, 0, canvasH - size);
  return { cbX, cbY, anchorY: cbY + size };
}
