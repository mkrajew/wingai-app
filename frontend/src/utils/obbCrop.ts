import { axisAngle } from "./obb";
import type { Detection } from "./yoloDetector";

/**
 * The part of a photo inside a detected rotated rectangle, turned so that the long side (the wing
 * axis) is horizontal. The crop is only rotated, never mirrored, so the wing can have its base on
 * either side. The area outside the photo is black. The canvas is as large as the rectangle:
 * long side x short side, in photo pixels.
 */
export function straightenedCrop(
  img: HTMLImageElement,
  det: Pick<Detection, "cx" | "cy" | "w" | "h" | "angle" | "corners">,
): HTMLCanvasElement {
  const { length, width, angle } = axisAngle(det.w, det.h, det.angle);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(length));
  canvas.height = Math.max(1, Math.round(width));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(-angle);
  ctx.translate(-det.cx, -det.cy);

  // Only the photo under the rectangle matters. A small margin keeps the interpolation at its edges.
  const xs = det.corners.map((p) => p[0]);
  const ys = det.corners.map((p) => p[1]);
  const sx = Math.max(0, Math.floor(Math.min(...xs)) - 2);
  const sy = Math.max(0, Math.floor(Math.min(...ys)) - 2);
  const sw = Math.min(img.naturalWidth, Math.ceil(Math.max(...xs)) + 2) - sx;
  const sh = Math.min(img.naturalHeight, Math.ceil(Math.max(...ys)) + 2) - sy;
  if (sw > 0 && sh > 0) ctx.drawImage(img, sx, sy, sw, sh, sx, sy, sw, sh);
  return canvas;
}
