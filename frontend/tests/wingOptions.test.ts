import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_WING_OPTIONS,
  chooseModel,
  chooseOrientation,
  needsMirroring,
  planRequest,
} from "../src/utils/wingOptions.ts";
import type { WingModel, WingOptions, WingOrientation } from "../src/utils/wingOptions.ts";

const MODELS: WingModel[] = ["precise", "rotation"];
const ORIENTATIONS: WingOrientation[] = ["left", "original", "right"];
const ALL: WingOptions[] = MODELS.flatMap((model) => ORIENTATIONS.map((orientation) => ({ model, orientation })));
const label = (o: WingOptions) => `${o.model} + ${o.orientation}`;

test("the switches start on the rotation model and the original orientation", () => {
  assert.deepEqual(DEFAULT_WING_OPTIONS, { model: "rotation", orientation: "original" });
});

test("choosing a model keeps the orientation, except that the precise model cannot orient to the left", () => {
  const expected: Record<string, WingOptions> = {
    "precise|left": { model: "precise", orientation: "original" },
    "precise|original": { model: "precise", orientation: "original" },
    "precise|right": { model: "precise", orientation: "right" },
    "rotation|left": { model: "rotation", orientation: "left" },
    "rotation|original": { model: "rotation", orientation: "original" },
    "rotation|right": { model: "rotation", orientation: "right" },
  };
  for (const from of ALL) {
    for (const model of MODELS) {
      assert.deepEqual(chooseModel(from, model), expected[`${model}|${from.orientation}`], `${label(from)}, choose ${model}`);
    }
  }
});

test("choosing an orientation keeps the model, except that orienting to the left needs the rotation model", () => {
  for (const from of ALL) {
    for (const orientation of ORIENTATIONS) {
      const model = orientation === "left" ? "rotation" : from.model;
      assert.deepEqual(chooseOrientation(from, orientation), { model, orientation }, `${label(from)}, choose ${orientation}`);
    }
  }
});

test("the precise model can be used with the original orientation and with the right one", () => {
  assert.deepEqual(chooseOrientation({ model: "precise", orientation: "original" }, "right"), { model: "precise", orientation: "right" });
  assert.deepEqual(chooseModel({ model: "rotation", orientation: "right" }, "precise"), { model: "precise", orientation: "right" });
});

test("whatever is chosen, the switches never get to the precise model with the left orientation", () => {
  // every state that can be reached from the start by choosing a model or an orientation
  const seen = new Map<string, WingOptions>([[label(DEFAULT_WING_OPTIONS), DEFAULT_WING_OPTIONS]]);
  const queue = [DEFAULT_WING_OPTIONS];
  while (queue.length > 0) {
    const from = queue.pop()!;
    const next = [...MODELS.map((m) => chooseModel(from, m)), ...ORIENTATIONS.map((o) => chooseOrientation(from, o))];
    for (const state of next) {
      if (!seen.has(label(state))) {
        seen.set(label(state), state);
        queue.push(state);
      }
    }
  }
  assert.deepEqual([...seen.keys()].sort(), ["precise + original", "precise + right", "rotation + left", "rotation + original", "rotation + right"]);
});

test("the rotation model orients the wings to the chosen side before the request and checks the answer afterwards", () => {
  assert.deepEqual(planRequest({ model: "rotation", orientation: "left" }), { model: "rotation", orientBefore: "left", correctAfter: "left" });
  assert.deepEqual(planRequest({ model: "rotation", orientation: "right" }), { model: "rotation", orientBefore: "right", correctAfter: "right" });
});

test("the precise model with the right orientation orients the wings before the request and never corrects the answer", () => {
  assert.deepEqual(planRequest({ model: "precise", orientation: "right" }), { model: "precise", orientBefore: "right", correctAfter: "original" });
});

test("the original orientation leaves the wings alone, before and after the request, with either model", () => {
  for (const model of MODELS) {
    assert.deepEqual(planRequest({ model, orientation: "original" }), { model, orientBefore: "original", correctAfter: "original" });
  }
});

test("every wing goes to the model that was chosen, in every state of the switches", () => {
  for (const options of ALL) assert.equal(planRequest(options).model, options.model, label(options));
});

test("a state the switches cannot produce, the precise model with the left orientation, leaves the wings alone and stays on the precise model", () => {
  assert.deepEqual(planRequest({ model: "precise", orientation: "left" }), { model: "precise", orientBefore: "original", correctAfter: "original" });
});

test("needsMirroring: only a wing on the other side than the wanted one", () => {
  assert.equal(needsMirroring("right", "left"), true);
  assert.equal(needsMirroring("left", "right"), true);
  assert.equal(needsMirroring("right", "right"), false);
  assert.equal(needsMirroring("left", "left"), false);
  assert.equal(needsMirroring("original", "left"), false);
  assert.equal(needsMirroring("original", "right"), false);
  assert.equal(needsMirroring("right", undefined), false);
  assert.equal(needsMirroring("left", "up"), false);
});
