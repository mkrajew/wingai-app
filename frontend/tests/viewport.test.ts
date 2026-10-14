import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INITIAL_VIEW,
  dragView,
  viewGeometry,
  viewOrigin,
  wheelView,
  zoomView,
} from "../src/utils/viewport.ts";
import type { Pan, View } from "../src/utils/viewport.ts";

// ---- what the review screen did before the zoom and the pan moved into viewport.ts: the code of ReviewImages.tsx, copied,
// with `zoom`, `viewWidth`, `viewHeight` and `panOffset` as its inputs. The new functions have to give the same numbers.
const oldClamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
function oldGeometry(viewWidth: number, viewHeight: number, zoom: number) {
  const zoomedWidth = viewWidth / zoom;
  const zoomedHeight = viewHeight / zoom;
  const zoomedX = (viewWidth - zoomedWidth) / 2;
  const zoomedY = (viewHeight - zoomedHeight) / 2;
  const maxPanX = Math.max(0, viewWidth - zoomedWidth);
  const maxPanY = Math.max(0, viewHeight - zoomedHeight);
  return { zoomedWidth, zoomedHeight, zoomedX, zoomedY, maxPanX, maxPanY };
}
type OldGeometry = ReturnType<typeof oldGeometry>;
const oldViewBox = (g: OldGeometry, panOffset: Pan) => ({
  x: oldClamp(g.zoomedX + panOffset.x, 0, g.maxPanX),
  y: oldClamp(g.zoomedY + panOffset.y, 0, g.maxPanY),
});
// the effect that ran after the zoom had changed
const oldKeepPanInside = (g: OldGeometry, prev: Pan): Pan => {
  const nextX = oldClamp(g.zoomedX + prev.x, 0, g.maxPanX) - g.zoomedX;
  const nextY = oldClamp(g.zoomedY + prev.y, 0, g.maxPanY) - g.zoomedY;
  return { x: nextX, y: nextY };
};
// the handler of the pointer move over the picture, deltaX and deltaY are in the units of the picture
const oldDrag = (g: OldGeometry, prev: Pan, deltaX: number, deltaY: number): Pan => {
  const nextX = oldClamp(g.zoomedX + prev.x - deltaX, 0, g.maxPanX);
  const nextY = oldClamp(g.zoomedY + prev.y - deltaY, 0, g.maxPanY);
  return { x: nextX - g.zoomedX, y: nextY - g.zoomedY };
};
// the handler of the wheel
const oldWheelZoom = (prev: number, deltaY: number) => {
  const delta = -deltaY * 0.002;
  return Math.min(3, Math.max(1, prev + delta));
};

// ---- a small seeded generator, so that the sequences are the same on every run
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SIZES: Array<[number, number]> = [[2154, 935], [2149, 928], [600, 300], [937, 2126], [2200.5, 950.25], [1, 1], [0, 0]];
const SLIDER_STEPS = Array.from({ length: 21 }, (_, i) => 1 + i / 10); // 1, 1.1 ... 3 as the slider gives them

test("viewGeometry gives the numbers that ReviewImages computed inline", () => {
  for (const [w, h] of SIZES) {
    for (const zoom of [...SLIDER_STEPS, 1.0000001, 2.718281828, 2.9999999]) {
      assert.deepStrictEqual(viewGeometry(w, h, zoom), oldGeometry(w, h, zoom), `${w}x${h} at ${zoom}`);
    }
  }
});

test("viewOrigin puts the view box where the inline code put it, for pans inside and far outside the limits", () => {
  const rnd = random(1);
  for (const [w, h] of SIZES) {
    for (const zoom of SLIDER_STEPS) {
      const g = oldGeometry(w, h, zoom);
      for (let i = 0; i < 20; i += 1) {
        const pan = { x: (rnd() - 0.5) * 4 * (w + 1), y: (rnd() - 0.5) * 4 * (h + 1) };
        assert.deepStrictEqual(viewOrigin(viewGeometry(w, h, zoom), pan), oldViewBox(g, pan));
      }
    }
  }
});

test("zoomView sets the zoom and keeps the pan where the effect after the zoom put it", () => {
  const rnd = random(2);
  for (const [w, h] of SIZES) {
    for (const from of SLIDER_STEPS) {
      for (const to of SLIDER_STEPS) {
        if (to === from) continue;
        const pan = { x: (rnd() - 0.5) * (w + 1), y: (rnd() - 0.5) * (h + 1) };
        const view: View = { zoom: from, pan };
        assert.deepStrictEqual(
          zoomView(view, to, w, h),
          { zoom: to, pan: oldKeepPanInside(oldGeometry(w, h, to), pan) },
          `${w}x${h}: ${from} to ${to}`,
        );
      }
    }
  }
});

test("zoomView to the zoom that is already set changes nothing, as the effect did not run then", () => {
  const view: View = { zoom: 2.3, pan: { x: 123.456789, y: -45.6789 } };
  assert.equal(zoomView(view, 2.3, 2154, 935), view);
});

test("zooming out to 1 brings the pan back to the centre, and zooming in again starts from the centre", () => {
  let view: View = { zoom: 3, pan: { x: 400, y: -150 } };
  view = zoomView(view, 1, 2154, 935);
  assert.deepStrictEqual(view, { zoom: 1, pan: { x: 0, y: 0 } });
  view = zoomView(view, 3, 2154, 935);
  assert.deepStrictEqual(view.pan, { x: 0, y: 0 });
});

test("dragView moves the pan as the handler of the pointer did, and not out of the picture", () => {
  const rnd = random(3);
  for (const [w, h] of SIZES) {
    for (const zoom of SLIDER_STEPS) {
      const g = oldGeometry(w, h, zoom);
      let pan: Pan = { x: 0, y: 0 };
      for (let i = 0; i < 30; i += 1) {
        const dx = (rnd() - 0.5) * 3 * (w + 1), dy = (rnd() - 0.5) * 3 * (h + 1);
        const expected = oldDrag(g, pan, dx, dy);
        const got = dragView({ zoom, pan }, dx, dy, viewGeometry(w, h, zoom));
        assert.deepStrictEqual(got, { zoom, pan: expected });
        pan = expected;
      }
    }
  }
});

test("wheelView changes the zoom as the wheel handler did and stays between 1 and 3", () => {
  const rnd = random(4);
  for (const [w, h] of SIZES) {
    let view: View = INITIAL_VIEW;
    for (let i = 0; i < 200; i += 1) {
      const deltaY = (rnd() - 0.5) * 900;
      const next = wheelView(view, deltaY, w, h);
      assert.equal(next.zoom, oldWheelZoom(view.zoom, deltaY));
      assert.ok(next.zoom >= 1 && next.zoom <= 3);
      view = next;
    }
  }
  assert.equal(wheelView(INITIAL_VIEW, 100000, 2154, 935).zoom, 1);
  assert.equal(wheelView(INITIAL_VIEW, -100000, 2154, 935).zoom, 3);
});

// ---- the strongest check: the old screen as a machine (state, a render after every action, and the effect that follows a
// render in which the numbers of the geometry changed) against the new functions, on long random sequences of actions
type Action =
  | { kind: "slider"; zoom: number }
  | { kind: "wheel"; deltaY: number }
  | { kind: "drag"; dx: number; dy: number };

function oldMachine(w: number, h: number, actions: Action[]): View[] {
  let zoom = 1;
  let pan: Pan = { x: 0, y: 0 };
  let seen: number[] | null = null;
  const settle = () => {
    const g = oldGeometry(w, h, zoom);
    const deps = [g.zoomedX, g.zoomedY, g.maxPanX, g.maxPanY];
    if (seen === null || deps.some((value, i) => !Object.is(value, seen![i]))) pan = oldKeepPanInside(g, pan);
    seen = deps;
  };
  settle(); // the first render
  const states: View[] = [];
  for (const action of actions) {
    if (action.kind === "slider") zoom = action.zoom;
    else if (action.kind === "wheel") zoom = oldWheelZoom(zoom, action.deltaY);
    else pan = oldDrag(oldGeometry(w, h, zoom), pan, action.dx, action.dy);
    settle();
    states.push({ zoom, pan });
  }
  return states;
}

function newMachine(w: number, h: number, actions: Action[]): View[] {
  let view: View = INITIAL_VIEW;
  const states: View[] = [];
  for (const action of actions) {
    if (action.kind === "slider") view = zoomView(view, action.zoom, w, h);
    else if (action.kind === "wheel") view = wheelView(view, action.deltaY, w, h);
    else view = dragView(view, action.dx, action.dy, viewGeometry(w, h, view.zoom));
    states.push(view);
  }
  return states;
}

test("long random sequences of slider, wheel and drag end in the same state, step by step, as the old screen", () => {
  const rnd = random(5);
  for (const [w, h] of SIZES) {
    for (let run = 0; run < 40; run += 1) {
      const actions: Action[] = [];
      for (let i = 0; i < 150; i += 1) {
        const r = rnd();
        if (r < 0.3) actions.push({ kind: "slider", zoom: SLIDER_STEPS[Math.floor(rnd() * SLIDER_STEPS.length)] });
        else if (r < 0.55) actions.push({ kind: "wheel", deltaY: (rnd() - 0.5) * 600 });
        else actions.push({ kind: "drag", dx: (rnd() - 0.5) * 0.4 * (w + 1), dy: (rnd() - 0.5) * 0.4 * (h + 1) });
      }
      const before = oldMachine(w, h, actions);
      const after = newMachine(w, h, actions);
      for (let i = 0; i < actions.length; i += 1) {
        assert.deepStrictEqual(after[i], before[i], `${w}x${h}, run ${run}, after action ${i}: ${JSON.stringify(actions[i])}`);
      }
    }
  }
});
