/**
 * Turning a picture to the wanted side from its own pixels, before it is sent to the backend (see poseFromPixels.ts for how the
 * pose is read). DOM helpers, no React.
 *
 * Nothing here may spoil the processing of a photo: a picture that cannot be read, or that is not read for sure, is left as it is,
 * and so is one for which something fails (that is logged). The result is the same picture, or a new canvas with it turned.
 */

import { turnedCanvas } from "./image";
import type { Turn } from "./landmarks";
import { readPose, turnForReading } from "./poseFromPixels";
import type { PoseReading, WingSide } from "./poseFromPixels";

// A picture with more pixels than this is read from a smaller copy of it (of about READ_TARGET_PIXELS), so that the pixels
// of the reading, which take 4 bytes each, stay within a few tens of megabytes. Wing crops are far below it.
const READ_MAX_PIXELS = 8_000_000;
const READ_TARGET_PIXELS = 4_000_000;

export type Oriented = {
  // How the pose was read, null when it could not be.
  reading: PoseReading | null;
  // The turn that was made, null when none.
  turn: Turn | null;
};

/** The pose of the picture that `source` holds (`width` x `height` pixels), or null when it cannot be read. */
function readPoseOf(source: CanvasImageSource, width: number, height: number): PoseReading | null {
  const scale = width * height > READ_MAX_PIXELS ? Math.sqrt(READ_TARGET_PIXELS / (width * height)) : 1;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  let canvas: HTMLCanvasElement;
  if (scale === 1 && source instanceof HTMLCanvasElement) {
    canvas = source;
  } else {
    canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas context");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, w, h);
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Failed to get canvas context");
  return readPose(ctx.getImageData(0, 0, w, h).data, w, h);
}

/**
 * The picture on `canvas` turned to the wanted side, upright, when its pose is read for sure and it does not lie like that:
 * a new canvas of the same size. Otherwise the canvas itself.
 */
export function orientCanvas(
  canvas: HTMLCanvasElement,
  wanted: WingSide,
): Oriented & { canvas: HTMLCanvasElement } {
  try {
    const reading = readPoseOf(canvas, canvas.width, canvas.height);
    const turn = turnForReading(reading, wanted);
    if (!turn) return { canvas, reading, turn: null };
    return { canvas: turnedCanvas(canvas, canvas.width, canvas.height, turn), reading, turn };
  } catch (error) {
    console.warn("Failed to read the pose of the wing from its pixels, leaving it as it is.", error);
    return { canvas, reading: null, turn: null };
  }
}

/**
 * The same for a loaded image: a new canvas with the image turned at its full size when it has to be turned, otherwise
 * null (the picture is as it is).
 */
export function orientImage(
  image: HTMLImageElement,
  wanted: WingSide,
): Oriented & { canvas: HTMLCanvasElement | null } {
  try {
    const { naturalWidth: width, naturalHeight: height } = image;
    const reading = readPoseOf(image, width, height);
    const turn = turnForReading(reading, wanted);
    if (!turn) return { canvas: null, reading, turn: null };
    return { canvas: turnedCanvas(image, width, height, turn), reading, turn };
  } catch (error) {
    console.warn("Failed to read the pose of the wing from its pixels, leaving it as it is.", error);
    return { canvas: null, reading: null, turn: null };
  }
}
