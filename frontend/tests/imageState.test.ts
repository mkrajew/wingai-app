import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDetections, photosLoading } from "../src/utils/imageState.ts";

type Photo = {
  id: string;
  filename: string;
  previewUrl: string;
  thumbUrl?: string;
  thumbFailed?: boolean;
  width?: number;
  height?: number;
  dimensionsFailed?: boolean;
  detections?: string[];
};

const loaded = (name: string): Photo => ({
  id: name,
  filename: name,
  previewUrl: `blob:${name}`,
  thumbUrl: `blob:thumb-${name}`,
  width: 100,
  height: 50,
});

test("nothing is loading when there are no photos", () => {
  assert.equal(photosLoading([]), false);
});

test("a photo with its thumbnail and its size is loaded", () => {
  assert.equal(photosLoading([loaded("a"), loaded("b")]), false);
});

test("a photo that has not got its thumbnail yet is loading, among photos that are loaded", () => {
  const waiting: Photo = { ...loaded("b"), thumbUrl: undefined };
  assert.equal(photosLoading([loaded("a"), waiting, loaded("c")]), true);
});

test("a photo that has not got its size yet is loading, whether the width or the height is missing", () => {
  assert.equal(photosLoading([{ ...loaded("a"), width: undefined, height: undefined }]), true);
  assert.equal(photosLoading([{ ...loaded("a"), width: undefined }]), true);
  assert.equal(photosLoading([{ ...loaded("a"), height: undefined }]), true);
});

test("a photo that has just been added has neither, and is loading", () => {
  const added: Photo = { id: "n", filename: "n", previewUrl: "blob:n" };
  assert.equal(photosLoading([added]), true);
});

test("a thumbnail that could not be made, or a size that could not be read, ends the loading", () => {
  const brokenThumbnail: Photo = { ...loaded("a"), thumbUrl: undefined, thumbFailed: true };
  const brokenSize: Photo = { ...loaded("b"), width: undefined, height: undefined, dimensionsFailed: true };
  const broken: Photo = { id: "c", filename: "c", previewUrl: "blob:c", thumbFailed: true, dimensionsFailed: true };
  assert.equal(photosLoading([brokenThumbnail, brokenSize, broken]), false);
});

test("a failed thumbnail does not hide a size that is still coming, nor the other way round", () => {
  const sizeComing: Photo = { id: "a", filename: "a", previewUrl: "blob:a", thumbFailed: true };
  const thumbnailComing: Photo = { id: "b", filename: "b", previewUrl: "blob:b", width: 10, height: 10, dimensionsFailed: true };
  assert.equal(photosLoading([sizeComing]), true);
  assert.equal(photosLoading([thumbnailComing]), true);
});

// ---- the result of Detect is put into the list that the photos have by then, not into the copies from the start of Detect
test("applyDetections gives the photo its detections and keeps what the photo got while Detect was running", () => {
  const atStart: Photo = { id: "a", filename: "a", previewUrl: "blob:a" };
  const found = new Map([["a", { previewUrl: "blob:a", detections: ["wing"] }]]);
  // while Detect ran, the thumbnail and the size came
  const now: Photo[] = [{ ...atStart, thumbUrl: "blob:thumb-a", width: 640, height: 480 }];
  const [after] = applyDetections(now, found);
  assert.deepEqual(after, { ...now[0], detections: ["wing"] });
  assert.equal(atStart.thumbUrl, undefined, "the copy from the start is not touched");
});

test("applyDetections leaves a photo alone whose picture was replaced while Detect was running (flipped, rotated)", () => {
  const turned: Photo = { ...loaded("a"), previewUrl: "blob:a-turned" };
  const found = new Map([["a", { previewUrl: "blob:a", detections: ["wing"] }]]);
  const [after] = applyDetections([turned], found);
  assert.equal(after, turned);
});

test("applyDetections returns the very same photo for every photo without a result, and ignores a result of a photo that is gone", () => {
  const a = loaded("a");
  const b = loaded("b");
  const found = new Map([
    ["b", { previewUrl: "blob:b", detections: [] as string[] }],
    ["gone", { previewUrl: "blob:gone", detections: ["wing"] }],
  ]);
  const after = applyDetections([a, b], found);
  assert.equal(after.length, 2);
  assert.equal(after[0], a);
  assert.deepEqual(after[1], { ...b, detections: [] });
});
