import assert from "node:assert/strict";
import { test } from "node:test";
import { detectPhotos } from "../src/utils/detectPhotos.ts";

const photo = (name: string) => ({ filename: name, previewUrl: `blob:${name}` });

// a detector that says what it does, and fails for the names in `failing`
function recorder(failing: string[] = []) {
  const events: string[] = [];
  return {
    events,
    detect: async (url: string) => {
      events.push(`detect ${url}`);
      await Promise.resolve();
      if (failing.some((name) => url === `blob:${name}`)) throw new Error(`cannot read ${url}`);
      return [`wing in ${url}`];
    },
    hooks: {
      onResult: (p: { filename: string }, detections: string[]) => events.push(`result ${p.filename}: ${detections.join()}`),
      onProgress: () => events.push("progress"),
    },
  };
}

test("every result is handed over as soon as its photo is done, before the next photo is looked at", async () => {
  const r = recorder();
  const outcome = await detectPhotos([photo("a"), photo("b"), photo("c")], r.detect, r.hooks);
  assert.deepEqual(r.events, [
    "detect blob:a", "result a: wing in blob:a", "progress",
    "detect blob:b", "result b: wing in blob:b", "progress",
    "detect blob:c", "result c: wing in blob:c", "progress",
  ]);
  assert.deepEqual(outcome, { error: null });
});

test("the photos are taken one after the other, in the order of the list", async () => {
  let running = 0;
  let most = 0;
  const order: string[] = [];
  const detect = async (url: string) => {
    running += 1;
    most = Math.max(most, running);
    order.push(url);
    await new Promise((resolve) => setTimeout(resolve, 1));
    running -= 1;
    return [url];
  };
  await detectPhotos([photo("a"), photo("b"), photo("c"), photo("d")], detect, { onResult: () => {}, onProgress: () => {} });
  assert.equal(most, 1);
  assert.deepEqual(order, ["blob:a", "blob:b", "blob:c", "blob:d"]);
});

test("when the first photo cannot be read the run stops with the message, and that photo still counts as done", async () => {
  const r = recorder(["a"]);
  const outcome = await detectPhotos([photo("a"), photo("b")], r.detect, r.hooks);
  assert.deepEqual(r.events, ["detect blob:a", "progress"]);
  assert.deepEqual(outcome, { error: "cannot read blob:a" });
});

test("a photo that cannot be read after another one was done is skipped, and the run goes on without an error", async () => {
  const r = recorder(["b"]);
  const outcome = await detectPhotos([photo("a"), photo("b"), photo("c")], r.detect, r.hooks);
  assert.deepEqual(r.events, [
    "detect blob:a", "result a: wing in blob:a", "progress",
    "detect blob:b", "progress",
    "detect blob:c", "result c: wing in blob:c", "progress",
  ]);
  assert.deepEqual(outcome, { error: null });
});

test("a failure that is not an Error is reported as an unknown error", async () => {
  const detect = async () => {
    throw "boom";
  };
  const outcome = await detectPhotos([photo("a")], detect, { onResult: () => {}, onProgress: () => {} });
  assert.deepEqual(outcome, { error: "Unknown error" });
});

test("a photo with no detections is a result like any other", async () => {
  const results: string[] = [];
  await detectPhotos([photo("a")], async () => [] as string[], {
    onResult: (p, detections) => results.push(`${p.filename}:${detections.length}`),
    onProgress: () => {},
  });
  assert.deepEqual(results, ["a:0"]);
});

test("no photos, nothing happens", async () => {
  const r = recorder();
  assert.deepEqual(await detectPhotos([], r.detect, r.hooks), { error: null });
  assert.deepEqual(r.events, []);
});
