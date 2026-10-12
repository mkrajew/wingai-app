import assert from "node:assert/strict";
import { test } from "node:test";
import { shrinkArea } from "../src/utils/areaResize.ts";
import {
  POSE_HEIGHT,
  POSE_SURE_MARGIN,
  POSE_WIDTH,
  descriptorOf,
  grayOf,
  gradientBin,
  readPose,
  readingFromScores,
  scoresOf,
  turnToSide,
  validMask,
} from "../src/utils/poseFromPixels.ts";
import type { WingSide } from "../src/utils/poseFromPixels.ts";
import { POSE_TEMPLATES, POSE_TEMPLATES_SHA256 } from "../src/utils/poseTemplates.ts";
import { float32FromBase64, loadGolden, pictureRgba, sha256 } from "./helpers.ts";
import type { PictureSpec } from "./helpers.ts";

const golden = loadGolden();
// the four poses of a straightened crop, in the order of the templates: [side, upside down]
const POSE_TABLE: Array<[WingSide, boolean]> = [
  ["right", false], // id: a right wing, upright (the pose of the mean shape of the backend)
  ["right", true], // rot180: a right wing, upside down
  ["left", false], // flipH: a left wing, upright
  ["left", true], // flipV: a left wing, upside down
];

const closeTo = (a: number, b: number, tolerance: number, what: string) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${what}: ${a} is not within ${tolerance} of ${b}`);

test("the working size and the sure margin are the ones that were measured", () => {
  assert.equal(POSE_WIDTH, golden.work[0]);
  assert.equal(POSE_HEIGHT, golden.work[1]);
  assert.equal(POSE_SURE_MARGIN, 0.1);
});

// ------------------------------------------------------------------------------------------------------------------ gray
test("grayOf is the integer luma (77 R + 150 G + 29 B + 128) >> 8 and ignores the alpha channel", () => {
  const rgba = Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 7, 255, 255, 255, 255, 0, 0, 0, 255, 10, 20, 30, 255]);
  assert.deepEqual([...grayOf(rgba, 6, 1)], [77, 149, 29, 255, 0, 18]);
});

test("grayOf keeps a gray picture as it is", () => {
  const rgba = new Uint8ClampedArray(256 * 4);
  for (let v = 0; v < 256; v += 1) rgba.set([v, v, v, 255], v * 4);
  assert.deepEqual([...grayOf(rgba, 256, 1)], Array.from({ length: 256 }, (_, v) => v));
});

// ------------------------------------------------------------------------------------------------- direction of a gradient
test("gradientBin puts every direction in the same bin as numpy does, ties included", () => {
  assert.ok(golden.bins.length > 400);
  for (const [gx, gy, bin] of golden.bins) assert.equal(gradientBin(gx, gy), bin, `gradient (${gx}, ${gy})`);
});

test("gradientBin covers the circle in eight equal sectors of atan2(gy, gx) that start at -180 degrees", () => {
  const middle = (b: number) => -Math.PI + (b + 0.5) * (Math.PI / 4);
  for (let b = 0; b < 8; b += 1) assert.equal(gradientBin(Math.cos(middle(b)) * 100, Math.sin(middle(b)) * 100), b);
});

// -------------------------------------------------------------------------------------------------------------- the photo
test("validMask is null when the whole crop is photo, also when it has a dark island", () => {
  const gray = grayOf(pictureRgba({ w: 512, h: 192, channels: ["formula", "formula", "formula"], shapes: [{ kind: "disc", cx: 256, cy: 96, r: 20 }] }), 512, 192);
  assert.ok(gray.includes(0), "the island is black");
  assert.equal(validMask(gray, 512, 192), null);
});

test("validMask drops the black part that touches the border, and one cell around it", () => {
  const [w, h] = [512, 192];
  const gray = new Uint8Array(w * h).fill(120);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < 64; x += 1) gray[y * w + x] = 0; // the 64 left columns are outside the photo
  const mask = validMask(gray, w, h);
  assert.ok(mask);
  assert.equal(mask.length, POSE_WIDTH * POSE_HEIGHT);
  // a cell is 2 x 2 pixels here: cells 0..31 are black, cell 32 is the one cell that is dropped around them
  for (let cy = 0; cy < POSE_HEIGHT; cy += 1) {
    for (let cx = 0; cx < POSE_WIDTH; cx += 1) assert.equal(mask[cy * POSE_WIDTH + cx], cx <= 32 ? 0 : 1, `cell ${cx},${cy}`);
  }
});

// ------------------------------------------------------------------------------------ the whole reading, against the reference
for (const [index, c] of golden.pipeline.entries()) {
  const spec = c.spec as PictureSpec;
  test(`picture ${index} (${spec.w}x${spec.h}): gray, working picture, mask, descriptor, scores and pose are the reference's`, () => {
    const rgba = pictureRgba(spec);
    const gray = grayOf(rgba, spec.w, spec.h);
    assert.equal(sha256(gray), c.luma_sha256, "gray");
    const small = shrinkArea(gray, spec.w, spec.h, POSE_WIDTH, POSE_HEIGHT);
    assert.ok(small);
    assert.equal(sha256(small), c.gray_sha256, "working picture");
    const valid = validMask(gray, spec.w, spec.h);
    assert.equal(valid === null, c.valid_all, "all photo");
    const ones = valid ?? new Uint8Array(POSE_WIDTH * POSE_HEIGHT).fill(1);
    assert.equal(sha256(ones), c.valid_sha256, "mask");
    assert.equal(ones.reduce((n, v) => n + v, 0), c.valid_cells);

    const descriptor = descriptorOf(small, valid);
    const wanted = float32FromBase64(c.descriptor_b64);
    assert.equal(descriptor.length, wanted.length);
    assert.deepEqual(descriptor, wanted, "descriptor, entry by entry");

    // the reference correlates in float32, here it is done in double precision
    const scores = scoresOf(descriptor);
    scores.forEach((s, i) => closeTo(s, c.scores[i], 1e-6, `score ${i}`));
    const reading = readingFromScores(scores);
    assert.deepEqual([reading.side, reading.upsideDown], POSE_TABLE[c.best]);
    closeTo(reading.margin, c.margin, 1e-6, "margin");

    const direct = readPose(rgba, spec.w, spec.h);
    assert.ok(direct);
    assert.deepEqual([direct.side, direct.upsideDown], POSE_TABLE[c.best]);
    closeTo(direct.margin, c.margin, 1e-6, "margin of readPose");
    assert.equal(direct.sure, c.margin >= POSE_SURE_MARGIN);
  });
}

// ---------------------------------------------------------------------------------------------------------------- decisions
test("readingFromScores takes the best pose and trusts it from a margin of 0.10", () => {
  const sure = readingFromScores([0.2, 0.9, 0.5, 0.1]);
  assert.deepEqual([sure.side, sure.upsideDown, sure.sure], ["right", true, true]);
  closeTo(sure.margin, 0.4, 1e-12, "margin");
  assert.equal(readingFromScores([0.75, 0.6, 0.1, 0]).sure, true);
  assert.equal(readingFromScores([0.75, 0.66, 0.1, 0]).sure, false);
  const tie = readingFromScores([0.3, 0.3, 0.1, 0]);
  assert.equal(tie.margin, 0);
  assert.equal(tie.sure, false);
});

test("a flat picture has no gradients: it is not sure and nothing is NaN", () => {
  const flat = new Uint8ClampedArray(400 * 200 * 4).fill(128);
  const reading = readPose(flat, 400, 200);
  assert.ok(reading);
  assert.equal(reading.margin, 0);
  assert.equal(reading.sure, false);
  assert.ok(reading.scores.every((s) => Number.isFinite(s)));
});

test("a picture smaller than the working size is not read", () => {
  assert.equal(readPose(new Uint8ClampedArray(200 * 80 * 4), 200, 80), null);
});

test("a picture that is almost all outside the photo still gives a finite reading", () => {
  const black = new Uint8ClampedArray(600 * 250 * 4);
  for (let i = 3; i < black.length; i += 4) black[i] = 255;
  const reading = readPose(black, 600, 250);
  assert.ok(reading);
  assert.ok(Number.isFinite(reading.margin));
  assert.equal(reading.sure, false);
});

// ---------------------------------------------------------------------------------------------------------------- templates
test("the templates are the four rows of 768 numbers that the reference was given", () => {
  assert.equal(POSE_TEMPLATES.length, 4);
  for (const row of POSE_TEMPLATES) assert.equal(row.length, golden.hog.cells[0] * golden.hog.cells[1] * golden.hog.bins);
  assert.equal(POSE_TEMPLATES_SHA256, golden.templates_sha256);
  assert.equal(sha256(Float32Array.from(POSE_TEMPLATES.flat())), golden.templates_sha256);
});

test("a template is read as its own pose, with a correlation of 1", () => {
  POSE_TEMPLATES.forEach((row, pose) => {
    const scores = scoresOf(Float32Array.from(row));
    closeTo(scores[pose], 1, 1e-5, `template ${pose}`);
    const reading = readingFromScores(scores);
    assert.deepEqual([reading.side, reading.upsideDown], POSE_TABLE[pose]);
    assert.ok(reading.sure, `margin of template ${pose}: ${reading.margin}`);
  });
});

// ---------------------------------------------------------------------------------------------------- what to do about a pose
// a small picture without any symmetry, and the four poses of a crop made from it: only turned, never mirrored
type Picture = number[][];
const base: Picture = Array.from({ length: 4 }, (_, y) => Array.from({ length: 6 }, (_, x) => y * 10 + x));
const flipX = (m: Picture): Picture => m.map((row) => [...row].reverse());
const flipY = (m: Picture): Picture => [...m].reverse();
const POSE_PICTURES: Picture[] = [base, flipY(flipX(base)), flipX(base), flipY(base)];
// the turn of the app (renderTransformedImage): a horizontal flip when exactly one of mirror and rotate is set, a vertical flip when rotate is set
const applyTurn = (m: Picture, turn: { mirror: boolean; rotate: boolean }): Picture => {
  let out = m;
  if (turn.mirror !== turn.rotate) out = flipX(out);
  if (turn.rotate) out = flipY(out);
  return out;
};

test("turnToSide brings every pose to the wanted side, upright", () => {
  POSE_TABLE.forEach(([side, upsideDown], pose) => {
    // the right wing upright is the canonical picture, the left wing upright is its mirror image
    assert.deepEqual(applyTurn(POSE_PICTURES[pose], turnToSide({ side, upsideDown }, "right")), base, `pose ${pose} to the right`);
    assert.deepEqual(applyTurn(POSE_PICTURES[pose], turnToSide({ side, upsideDown }, "left")), flipX(base), `pose ${pose} to the left`);
  });
});

test("turnToSide mirrors only a wing on the other side and turns only a wing that is upside down", () => {
  assert.deepEqual(turnToSide({ side: "right", upsideDown: false }, "right"), { mirror: false, rotate: false });
  assert.deepEqual(turnToSide({ side: "right", upsideDown: true }, "right"), { mirror: false, rotate: true });
  assert.deepEqual(turnToSide({ side: "left", upsideDown: false }, "right"), { mirror: true, rotate: false });
  assert.deepEqual(turnToSide({ side: "left", upsideDown: true }, "right"), { mirror: true, rotate: true });
  assert.deepEqual(turnToSide({ side: "right", upsideDown: false }, "left"), { mirror: true, rotate: false });
  assert.deepEqual(turnToSide({ side: "left", upsideDown: false }, "left"), { mirror: false, rotate: false });
});
