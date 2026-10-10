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
 * The frame of the tag of a detection, in canvas pixels. The tag is one rectangle: the checkbox
 * (size x size) at the corner and the confidence label next to it. It is attached to the highest
 * corner (the lowest when there is no room above, the left one when two are level), lies outside
 * the detection and turns with the flatter of the two edges that meet at that corner.
 *
 * In the frame the origin is the corner and the x axis is the reading direction of the text, so the
 * text is never upside down: angle is in [-pi/2, pi/2]. The y axis points down in that frame.
 *   dir  1: the tag extends to +x from the corner, [checkbox][label].
 *        -1: it extends to -x, [label][checkbox]. The checkbox is at the corner either way.
 *   side -1: the tag is above the edge line (y from -size to 0). 1: it is below it (y from 0 to size).
 * When the turned checkbox does not fit in the canvas (a corner near or outside the photo), the tag
 * is the flat one, moved into the canvas so that it can still be clicked, and flat is true.
 */
export type TagFrame = {
  x: number;
  y: number;
  angle: number;
  dir: 1 | -1;
  side: 1 | -1;
  flat: boolean;
};

export function tagFrame(
  corners: Point[],
  scaleX: number,
  scaleY: number,
  canvasW: number,
  canvasH: number,
  size: number,
): TagFrame {
  const pts = corners.map(([x, y]) => [x * scaleX, y * scaleY] as const);
  const top = pts.reduce((a, b) =>
    b[1] < a[1] || (b[1] === a[1] && b[0] < a[0]) ? b : a,
  );
  const bottom = pts.reduce((a, b) =>
    b[1] > a[1] || (b[1] === a[1] && b[0] < a[0]) ? b : a,
  );
  const above = top[1] > size;
  const corner = above ? top : bottom;

  // The two edges that meet at the corner, as vectors away from it. The flatter one is the one
  // closer to horizontal. When both are equally flat, the one going right.
  const k = pts.indexOf(corner);
  const edges = [pts[(k + 1) % 4], pts[(k + 3) % 4]].map(
    ([x, y]) => [x - corner[0], y - corner[1]] as const,
  );
  const flatness = ([dx, dy]: readonly [number, number]) => {
    const length = Math.hypot(dx, dy);
    return length > 0 ? Math.abs(dy) / length : Infinity;
  };
  const [f0, f1] = edges.map(flatness);
  const edge =
    Math.abs(f0 - f1) < 1e-9
      ? edges[0][0] >= edges[1][0]
        ? edges[0]
        : edges[1]
      : f0 < f1
        ? edges[0]
        : edges[1];

  const goesRight = edge[0] >= 0;
  const angle = goesRight
    ? Math.atan2(edge[1], edge[0])
    : Math.atan2(-edge[1], -edge[0]);
  const dir = goesRight ? 1 : -1;

  // The tag goes on the side of the edge line that the detection is not on.
  const mx = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
  const my = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
  const inward =
    (mx - corner[0]) * -Math.sin(angle) + (my - corner[1]) * Math.cos(angle);
  const side = inward > 0 ? -1 : 1;

  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x0 = dir > 0 ? 0 : -size;
  const y0 = side < 0 ? -size : 0;
  const fits = [0, size].every((dx) =>
    [0, size].every((dy) => {
      const px = corner[0] + (x0 + dx) * c - (y0 + dy) * s;
      const py = corner[1] + (x0 + dx) * s + (y0 + dy) * c;
      return px >= -1e-6 && px <= canvasW + 1e-6 && py >= -1e-6 && py <= canvasH + 1e-6;
    }),
  );
  if (fits) return { x: corner[0], y: corner[1], angle, dir, side, flat: false };

  const flatX = clamp(corner[0], 0, canvasW - size);
  const flatY = clamp(above ? top[1] - size : bottom[1], 0, canvasH - size);
  return above
    ? { x: flatX, y: flatY + size, angle: 0, dir: 1, side: -1, flat: true }
    : { x: flatX, y: flatY, angle: 0, dir: 1, side: 1, flat: true };
}

/** Whether the canvas point (px, py) is inside the checkbox of a tag frame. */
export function inCheckbox(
  frame: TagFrame,
  px: number,
  py: number,
  size: number,
) {
  const dx = px - frame.x;
  const dy = py - frame.y;
  const lx = dx * Math.cos(frame.angle) + dy * Math.sin(frame.angle);
  const ly = -dx * Math.sin(frame.angle) + dy * Math.cos(frame.angle);
  const x0 = frame.dir > 0 ? 0 : -size;
  const y0 = frame.side < 0 ? -size : 0;
  return lx >= x0 && lx <= x0 + size && ly >= y0 && ly <= y0 + size;
}
