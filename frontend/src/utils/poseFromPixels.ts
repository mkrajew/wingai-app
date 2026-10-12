/**
 * Reading the pose of a wing from the pixels of its picture, with no help from the backend.
 *
 * A wing whose long axis is horizontal (what the crop of the detector gives) is in one of four poses. The picture is only turned,
 * never mirrored, so the wing is the same wing, only the way it lies differs: which side of the bee it is (a right wing or a left wing
 * has its base on the same side as the thick leading-edge vein is turned to) and whether it lies upside down. The pose of the mean
 * shape of the backend (wingPose.ts) is the one called `id` here: a right wing, base on the right, the thick vein at the top.
 *
 *   id      right wing, upright           flipH   left wing, upright
 *   rot180  right wing, upside down       flipV   left wing, upside down
 *
 * The picture is shrunk to 256 x 96 pixels (gray, by averaging areas, see areaResize.ts). Histograms of the directions of its gradients
 * are made in a grid of 16 x 6 cells, and the descriptor of 768 numbers is compared (normalised cross correlation) with the average wing in
 * each of the four poses (poseTemplates.ts). The pose with the highest correlation wins, and the reading is `sure` when it wins from the
 * second best by at least POSE_SURE_MARGIN.
 *
 * Python reference of every step: tools/pose (features.py, common.py). tools/pose/REPORT.md has the measurements; the vectors that
 * tests/ compares with are made by tools/pose/make_golden.py.
 */
import { shrinkArea } from "./areaResize.ts";
import type { Turn } from "./landmarks.ts";
import { POSE_TEMPLATES } from "./poseTemplates.ts";

/** The working size, in pixels. */
export const POSE_WIDTH = 256;
export const POSE_HEIGHT = 96;
/** A reading is trusted when the best pose beats the second best by this much (all the readings that were right had at least 0.30 after the detector). */
export const POSE_SURE_MARGIN = 0.1;

const CELL = 16;
const CELLS_X = POSE_WIDTH / CELL;
const CELLS_Y = POSE_HEIGHT / CELL;
const BINS = 8;
const DESCRIPTOR_LENGTH = CELLS_X * CELLS_Y * BINS;
/** Pixels this dark are the black fill that straightenedCrop leaves outside the photo (dark veins are not exactly black). */
const BLACK_LEVEL = 2;
/** A cell counts as black when this share (of 255) of its pixels is. */
const MIN_BLACK = 230;
/** When less of the crop is photo than this, the mask of the photo is not used (it would hide the wing as well). */
const MIN_PHOTO_SHARE = 0.2;
const EPS = 1e-9;

export type WingSide = "left" | "right";

/** The four poses in the order of the templates: [the side of the wing, whether it lies upside down]. */
const POSE_TABLE: ReadonlyArray<readonly [WingSide, boolean]> = [
  ["right", false], // id
  ["right", true], // rot180
  ["left", false], // flipH
  ["left", true], // flipV
];

export type PoseReading = {
  side: WingSide;
  upsideDown: boolean;
  /** The correlation of the best pose minus the correlation of the second best. */
  margin: number;
  /** The margin is at least POSE_SURE_MARGIN. */
  sure: boolean;
  /** The correlation with each of the four templates. */
  scores: number[];
};

// ------------------------------------------------------------------------------------------------------------------ gray
/** The gray picture of RGBA bytes, in integer arithmetic: (77 R + 150 G + 29 B + 128) >> 8. The alpha channel is ignored. */
export function grayOf(rgba: ArrayLike<number>, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < out.length; i += 1, j += 4) out[i] = (77 * rgba[j] + 150 * rgba[j + 1] + 29 * rgba[j + 2] + 128) >> 8;
  return out;
}

// ----------------------------------------------------------------------------------------------- what is photo, what is not
// Binary masks are Uint8Arrays of 0 and 1 with the size of the working picture. The morphology ignores what is outside the picture.

/** Every pixel becomes the minimum (erode) or the maximum (dilate) of its square neighbourhood of the given radius. */
function morphology(mask: Uint8Array, radius: number, erode: boolean): Uint8Array {
  const pick = erode ? Math.min : Math.max;
  const across = new Uint8Array(mask.length);
  for (let y = 0; y < POSE_HEIGHT; y += 1) {
    for (let x = 0; x < POSE_WIDTH; x += 1) {
      let v = mask[y * POSE_WIDTH + x];
      for (let k = Math.max(0, x - radius); k <= Math.min(POSE_WIDTH - 1, x + radius); k += 1) v = pick(v, mask[y * POSE_WIDTH + k]);
      across[y * POSE_WIDTH + x] = v;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < POSE_HEIGHT; y += 1) {
    for (let x = 0; x < POSE_WIDTH; x += 1) {
      let v = across[y * POSE_WIDTH + x];
      for (let k = Math.max(0, y - radius); k <= Math.min(POSE_HEIGHT - 1, y + radius); k += 1) v = pick(v, across[k * POSE_WIDTH + x]);
      out[y * POSE_WIDTH + x] = v;
    }
  }
  return out;
}

/**
 * Which cells of the working picture are photo (1) and which are the black fill outside the photo (0), or null when all are photo.
 * The fill is a large black area that touches the border of the crop. Dark veins are black in a few pixels only and do not touch the
 * border, so only the cells that are (almost) all black AND connected to the border count, with one cell around them.
 * A picture smaller than the working size has no mask (null).
 */
export function validMask(gray: Uint8Array, w: number, h: number): Uint8Array | null {
  let black: Uint8Array | null = null;
  for (let i = 0; i < gray.length; i += 1) {
    if (gray[i] <= BLACK_LEVEL) {
      black ??= new Uint8Array(gray.length);
      black[i] = 255;
    }
  }
  if (black === null) return null;
  const shrunk = shrinkArea(black, w, h, POSE_WIDTH, POSE_HEIGHT);
  if (shrunk === null) return null;

  // the black cells that are connected (by their sides) to a black cell on the border of the picture
  const outside = new Uint8Array(shrunk.length);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const i = y * POSE_WIDTH + x;
    if (shrunk[i] >= MIN_BLACK && outside[i] === 0) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < POSE_WIDTH; x += 1) {
    push(x, 0);
    push(x, POSE_HEIGHT - 1);
  }
  for (let y = 0; y < POSE_HEIGHT; y += 1) {
    push(0, y);
    push(POSE_WIDTH - 1, y);
  }
  if (stack.length === 0) return null;
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % POSE_WIDTH;
    const y = (i - x) / POSE_WIDTH;
    if (x > 0) push(x - 1, y);
    if (x < POSE_WIDTH - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < POSE_HEIGHT - 1) push(x, y + 1);
  }
  const valid = morphology(outside, 1, false);
  for (let i = 0; i < valid.length; i += 1) valid[i] = 1 - valid[i];
  return valid;
}

// ------------------------------------------------------------------------------------------------------------- descriptor
/**
 * The bin (0 to 7) of the direction of a gradient: the angle atan2(gy, gx) from -180 degrees on, in sectors of 45 degrees that
 * include their start. Done on the signs and the sizes of the two components, so that a direction exactly on the border of two sectors
 * (a horizontal, a vertical or a diagonal gradient, which the integer pixels make common) always goes the same way.
 */
export function gradientBin(gx: number, gy: number): number {
  if (gy > 0) {
    if (gx > 0) return gy < gx ? 4 : 5;
    return -gx < gy ? 6 : 7;
  }
  if (gy < 0) {
    if (gx < 0) return -gy < -gx ? 0 : 1;
    return -gy > gx ? 2 : 3;
  }
  return gx < 0 ? 7 : 4;
}

/**
 * The descriptor (768 numbers) of the working picture `image` (256 x 96, gray). `valid` is the mask of the photo, or null.
 * A pixel counts when it is at least 4 pixels away from what is outside the photo: the mask is eroded twice, by 2 pixels each time.
 * (The reference also fills the outside with the median of the rest first. The gradient of a pixel that counts looks one pixel
 * around it, so the fill never reaches one: it was checked on the real crops that it changes no descriptor, and it is left out.)
 */
export function descriptorOf(image: Uint8Array, valid: Uint8Array | null): Float32Array {
  let counted: Uint8Array | null = null;
  if (valid !== null && valid.some((v) => v === 0)) {
    const inside = morphology(valid, 2, true);
    if (inside.reduce((n, v) => n + v, 0) >= MIN_PHOTO_SHARE * inside.length) counted = morphology(inside, 2, true);
  }

  const histogram = new Float64Array(DESCRIPTOR_LENGTH);
  const last = POSE_WIDTH - 1;
  const bottom = POSE_HEIGHT - 1;
  for (let y = 0; y < POSE_HEIGHT; y += 1) {
    // the rows above and below, reflected at the border (-1 is 1, and the size is the size - 2)
    const above = (y === 0 ? 1 : y - 1) * POSE_WIDTH;
    const here = y * POSE_WIDTH;
    const below = (y === bottom ? bottom - 1 : y + 1) * POSE_WIDTH;
    const cellRow = Math.floor(y / CELL) * CELLS_X;
    for (let x = 0; x < POSE_WIDTH; x += 1) {
      if (counted !== null && counted[here + x] === 0) continue;
      const l = x === 0 ? 1 : x - 1;
      const r = x === last ? last - 1 : x + 1;
      const gx = image[above + r] + 2 * image[here + r] + image[below + r] - image[above + l] - 2 * image[here + l] - image[below + l];
      const gy = image[below + l] + 2 * image[below + x] + image[below + r] - image[above + l] - 2 * image[above + x] - image[above + r];
      // the magnitude as float32, like the reference
      const magnitude = Math.fround(Math.sqrt(gx * gx + gy * gy));
      if (magnitude === 0) continue;
      histogram[(cellRow + Math.floor(x / CELL)) * BINS + gradientBin(gx, gy)] += magnitude;
    }
  }
  return Float32Array.from(histogram, Math.sqrt);
}

// -------------------------------------------------------------------------------------------------------------------- score
function normalised(v: ArrayLike<number>): Float64Array {
  const out = Float64Array.from(v);
  const mean = out.reduce((s, x) => s + x, 0) / out.length;
  let norm = 0;
  for (let i = 0; i < out.length; i += 1) {
    out[i] -= mean;
    norm += out[i] * out[i];
  }
  norm = Math.sqrt(norm) + EPS;
  for (let i = 0; i < out.length; i += 1) out[i] /= norm;
  return out;
}

const TEMPLATES = POSE_TEMPLATES.map(normalised);

/** The correlation of a descriptor with each of the four templates. */
export function scoresOf(descriptor: ArrayLike<number>): number[] {
  const d = normalised(descriptor);
  return TEMPLATES.map((t) => t.reduce((s, x, i) => s + x * d[i], 0));
}

/** The reading for the correlations with the four templates: the best pose and how far it is ahead of the second. */
export function readingFromScores(scores: readonly number[]): PoseReading {
  let best = 0;
  for (let i = 1; i < scores.length; i += 1) if (scores[i] > scores[best]) best = i;
  let second = -Infinity;
  for (let i = 0; i < scores.length; i += 1) if (i !== best) second = Math.max(second, scores[i]);
  const margin = scores[best] - second;
  const [side, upsideDown] = POSE_TABLE[best];
  return { side, upsideDown, margin, sure: margin >= POSE_SURE_MARGIN, scores: [...scores] };
}

/**
 * The pose of the wing in a picture of RGBA bytes (the data of an ImageData), or null when the picture is smaller than the working
 * size (256 x 96) and so is too small to read.
 */
export function readPose(rgba: ArrayLike<number>, w: number, h: number): PoseReading | null {
  const gray = grayOf(rgba, w, h);
  const small = shrinkArea(gray, w, h, POSE_WIDTH, POSE_HEIGHT);
  if (small === null) return null;
  return readingFromScores(scoresOf(descriptorOf(small, validMask(gray, w, h))));
}

/**
 * The turn that puts a wing in the given pose on the wanted side, upright: it is mirrored when it is on the other side, and turned when
 * it lies upside down (both together are a vertical mirror image, see renderTransformedImage).
 */
export function turnToSide(reading: Pick<PoseReading, "side" | "upsideDown">, wanted: WingSide): Turn {
  return { mirror: reading.side !== wanted, rotate: reading.upsideDown };
}
