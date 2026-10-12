import assert from "node:assert/strict";
import { test } from "node:test";
import { turnFlips, turnLandmarks, turnMatrix } from "../src/utils/landmarks.ts";
import type { Turn } from "../src/utils/landmarks.ts";

const NONE: Turn = { mirror: false, rotate: false };
const MIRROR: Turn = { mirror: true, rotate: false };
const ROTATE: Turn = { mirror: false, rotate: true };
const BOTH: Turn = { mirror: true, rotate: true };

test("a mirror flips the columns, a turn by 180 degrees flips both, and both together flip the rows", () => {
  assert.deepEqual(turnFlips(NONE), { flipX: false, flipY: false });
  assert.deepEqual(turnFlips(MIRROR), { flipX: true, flipY: false });
  assert.deepEqual(turnFlips(ROTATE), { flipX: true, flipY: true });
  assert.deepEqual(turnFlips(BOTH), { flipX: false, flipY: true });
});

test("turnMatrix is a matrix of whole numbers that draws the picture turned, for setTransform", () => {
  assert.deepEqual(turnMatrix(NONE, 300, 100), [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(turnMatrix(MIRROR, 300, 100), [-1, 0, 0, 1, 300, 0]);
  assert.deepEqual(turnMatrix(ROTATE, 300, 100), [-1, 0, 0, -1, 300, 100]);
  assert.deepEqual(turnMatrix(BOTH, 300, 100), [1, 0, 0, -1, 0, 100]);
});

test("the matrix puts every pixel where turnLandmarks puts its landmark", () => {
  const [w, h] = [37, 23];
  const points = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [5, 7], [18, 11]];
  for (const turn of [NONE, MIRROR, ROTATE, BOTH]) {
    const [a, b, c, d, e, f] = turnMatrix(turn, w, h);
    for (const [x, y] of points) {
      // the matrix works on the coordinates of the picture, where the pixel (x, y) spans [x, x + 1) and its centre is x + 0.5
      const centre = [a * (x + 0.5) + c * (y + 0.5) + e, b * (x + 0.5) + d * (y + 0.5) + f];
      assert.deepEqual(turnLandmarks([x, y], w, h, turn), [centre[0] - 0.5, centre[1] - 0.5], `pixel ${x},${y} of ${JSON.stringify(turn)}`);
    }
  }
});

test("turnLandmarks mirrors the columns, turns by 180 degrees, or mirrors the rows, and leaves what is not a number", () => {
  assert.deepEqual(turnLandmarks([10, 3, 0, 19], 40, 20, MIRROR), [29, 3, 39, 19]);
  assert.deepEqual(turnLandmarks([10, 3, 0, 19], 40, 20, ROTATE), [29, 16, 39, 0]);
  assert.deepEqual(turnLandmarks([10, 3, 0, 19], 40, 20, BOTH), [10, 16, 0, 0]);
  assert.deepEqual(turnLandmarks([10, 3], 40, 20, NONE), [10, 3]);
  const withGaps = turnLandmarks([Number.NaN, 3, 10, Number.NaN], 40, 20, ROTATE);
  assert.ok(Number.isNaN(withGaps[0]) && withGaps[1] === 16 && withGaps[2] === 29 && Number.isNaN(withGaps[3]));
});

test("turnLandmarks nudges a coordinate that is exactly between two pixels, so it rounds to the mirror image of the pixel it rounded to", () => {
  const [x] = turnLandmarks([10.5, 3], 40, 20, MIRROR);
  assert.ok(x < 28.5 && 28.5 - x < 1e-8, `${x}`);
  assert.equal(Math.round(x), 28);
  assert.equal(Math.round(10.5), 11); // 11 is the mirror image of 28 in a row of 40 pixels
});
