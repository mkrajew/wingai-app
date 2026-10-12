import assert from "node:assert/strict";
import { test } from "node:test";
import { shrinkArea } from "../src/utils/areaResize.ts";
import { loadGolden, plane, sha256 } from "./helpers.ts";

const golden = loadGolden();
const [W, H] = golden.work;

test("shrinkArea gives, bit for bit, what cv2.INTER_AREA gives", () => {
  assert.ok(golden.area.length > 10);
  for (const c of golden.area) {
    const source = plane(c.kind, c.w, c.h, c.seed);
    // the case with a threshold is the 0 / 255 map of the dark pixels, which the mask of the photo shrinks
    const input = c.threshold === undefined ? source : source.map((v) => (v <= c.threshold! ? 255 : 0));
    const out = shrinkArea(input, c.w, c.h, W, H);
    assert.ok(out, `${c.w}x${c.h} is big enough`);
    assert.equal(out.length, W * H);
    assert.equal(sha256(out), c.sha256, `${c.w}x${c.h} ${c.kind}`);
  }
});

test("a picture of the working size comes back as it is, in a new array", () => {
  const picture = plane("noise", W, H, 3);
  const out = shrinkArea(picture, W, H, W, H);
  assert.ok(out);
  assert.notEqual(out, picture);
  assert.deepEqual(out, picture);
});

test("a flat picture stays flat", () => {
  for (const [w, h] of [[2203, 947], [1000, 400], [333, 111]]) {
    for (const level of [0, 1, 77, 128, 255]) {
      const flat = new Uint8Array(w * h).fill(level);
      const out = shrinkArea(flat, w, h, W, H);
      assert.ok(out);
      assert.ok(
        out.every((v) => v === level),
        `${w}x${h} at ${level}`,
      );
    }
  }
});

test("a picture smaller than the working size in either direction is refused", () => {
  assert.equal(shrinkArea(new Uint8Array(255 * 95), 255, 95, W, H), null);
  assert.equal(shrinkArea(new Uint8Array(255 * 400), 255, 400, W, H), null);
  assert.equal(shrinkArea(new Uint8Array(400 * 95), 400, 95, W, H), null);
});
