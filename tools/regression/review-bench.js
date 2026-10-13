// How much work the review screen does for what the user does: the zoom slider, ctrl + wheel, dragging, and moving between
// the photos. It counts what React reports for the dev build (the "Scheduler" and "Components" tracks that React 19 writes
// with console.timeStamp): the commits, and how many times the component of the review screen was rendered. Unlike a stopwatch
// this does not change with the load of the machine or with a window that is hidden, so two builds can be compared.
// Run it in the page after run.js (S1) has left the page on the review screen:
//   (0,eval)(await (await fetch("http://127.0.0.1:8765/regression/review-bench.js")).text())
//   -> { slider: { events, commits, reviewRenders }, wheel: ..., drag: ..., photos: ... }
(async () => {
  const tick = () => new Promise((res) => { const c = new MessageChannel(); c.port1.onmessage = () => res(); c.port2.postMessage(0); });
  const ticks = async (n) => { for (let i = 0; i < n; i += 1) await tick(); };
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  const range = () => document.querySelector("input[type=range]");
  const reviewSvg = () => document.querySelector("svg image")?.closest("svg") ?? null;
  const setValue = (el, v) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v));
  const key = (k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

  let counts = null;
  const original = console.timeStamp.bind(console);
  console.timeStamp = (...args) => {
    const [label, , , track, group] = args;
    if (counts && group === "Scheduler ⚛" && label === "Commit") counts.commits += 1;
    if (counts && track === "Components ⚛" && label === "ReviewImagesContent") counts.reviewRenders += 1;
    return original(...args);
  };
  const measure = async (events, fn) => {
    await ticks(10);
    counts = { events, commits: 0, reviewRenders: 0 };
    await fn();
    await ticks(30); // what is still waiting to be rendered
    const result = counts;
    counts = null;
    return result;
  };

  const steps = Array.from({ length: 21 }, (_, i) => 1 + i / 10);
  const out = {};
  out.slider = await measure(42, async () => {
    for (const z of [...steps, ...steps.slice().reverse()]) { setValue(range(), z); range().dispatchEvent(new Event("input", { bubbles: true })); await tick(); }
  });
  out.wheel = await measure(60, async () => {
    for (let i = 0; i < 60; i += 1) { reviewSvg().dispatchEvent(new WheelEvent("wheel", { deltaY: i % 2 ? 120 : -120, ctrlKey: true, bubbles: true, cancelable: true })); await tick(); }
  });
  setValue(range(), 3); range().dispatchEvent(new Event("input", { bubbles: true })); await ticks(10);
  out.drag = await measure(60, async () => {
    const svg = reviewSvg(), r = svg.getBoundingClientRect();
    const fire = (type, x, y, mx, my) => svg.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, movementX: mx, movementY: my, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, bubbles: true, cancelable: true }));
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    fire("pointerdown", x0, y0, 0, 0);
    for (let i = 0; i < 60; i += 1) { fire("pointermove", x0, y0, i % 2 ? 6 : -6, i % 3 ? 2 : -2); await tick(); }
    fire("pointerup", x0, y0, 0, 0);
  });
  setValue(range(), 1); range().dispatchEvent(new Event("input", { bubbles: true })); await ticks(10);
  out.photos = await measure(20, async () => {
    for (let i = 0; i < 20; i += 1) { key(i % 2 ? "ArrowLeft" : "ArrowRight"); await ticks(3); }
  });
  console.timeStamp = original;
  return out;
})();
