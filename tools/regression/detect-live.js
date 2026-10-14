// Does Detect show its results photo by photo, and what does that cost? Runs on its own in a freshly loaded page and needs only the Vite
// page and the helper server (dev build: it reads what React 19 writes with console.timeStamp):
//   Object.assign(window, { __LABEL: "base", __COPIES: 3 }); await (0, eval)(await (await fetch("http://127.0.0.1:8765/regression/detect-live.js", { cache: "no-store" })).text());
// The result is posted to work/collected-detect-live-<label>.json and returned.
//
// 8 x __COPIES photos (24 by default) are uploaded and loaded, the preview window is opened on the first photo, and Detect is clicked. It records
//   badges      the number of photos that show their number of detections, over the time of Detect: one entry for every change
//   boxes       when the boxes of the first photo are drawn in the open preview window
//   work        the commits of React while Detect ran, the time of the renders and of the commits (JavaScript only, no painting)
//   final       the numbers of detections of the photos at the end, in the order of the list: they must be the same in every version
(async () => {
  const BASE = "http://127.0.0.1:8765";
  const LABEL = window.__LABEL || "detect-live";
  const COPIES = window.__COPIES || 3;
  const tick = () => new Promise((res) => { const c = new MessageChannel(); c.port1.onmessage = () => res(); c.port2.postMessage(0); });
  const ticks = async (n) => { for (let i = 0; i < n; i += 1) await tick(); };
  const waitFor = async (fn, label, ms = 240000) => { const t0 = performance.now(); for (;;) { const v = fn(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("timeout: " + label); await tick(); } };
  const btn = (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  const median = (xs) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
  const badges = () => [...document.querySelectorAll("li .badge")].map((b) => Number(b.textContent));

  // the detection model has to be in the cache of the page
  let modelUrl = "/models/best-dota.onnx", cacheName = "wingai-models-v1";
  try { ({ MODEL_URL: modelUrl, CACHE_NAME: cacheName } = await import("/src/utils/modelCache.ts")); } catch { /* production bundle */ }
  const cache = await caches.open(cacheName);
  if (!(await cache.match(modelUrl))) await cache.put(modelUrl, new Response(await (await fetch(modelUrl)).arrayBuffer()));

  // the photos
  const blobs = {};
  const files = [];
  let n = 0;
  for (let copy = 0; copy < COPIES; copy += 1) {
    for (const id of [6466, 6467, 6468, 6469, 6470, 6471, 6472, 6473]) {
      blobs[id] ??= await (await fetch(`${BASE}/raw/IMG_${id}.JPG`)).blob();
      files.push(new File([blobs[id]], `IMG_${id}${copy ? `_${copy}` : ""}.JPG`, { type: "image/jpeg", lastModified: 1700000000000 + n++ }));
    }
  }
  const input = document.querySelector("input[type=file]");
  const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f));
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  window.__runStage = "loading the photos";
  await waitFor(() => files.every((f) => document.body.innerText.includes(f.name)), "listed");
  await waitFor(() => !document.querySelector('li div.rounded.border[aria-hidden="true"]'), "every thumbnail");
  await ticks(30);

  // the preview window on the first photo (window.__PREVIEW = false leaves it closed)
  if (window.__PREVIEW !== false) {
    btn("Preview").click();
    await waitFor(() => document.querySelector("[role=dialog] img")?.complete, "the preview window"); // no canvas yet: it comes with the detections
    await ticks(30);
  }
  const canvasDrawn = () => {
    const c = document.querySelector("[role=dialog] canvas");
    if (!c || !c.width || !c.height) return 0;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let drawn = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) drawn += 1;
    return drawn;
  };

  // what React reports, only while Detect runs
  let counting = false;
  const work = { commits: 0, renderMs: 0, commitMs: 0, renders: [] };
  const original = console.timeStamp.bind(console);
  console.timeStamp = (...a) => {
    const [label, start, end, , group] = a;
    if (counting && group === "Scheduler ⚛" && typeof start === "number" && typeof end === "number") {
      if (label === "Commit") { work.commits += 1; work.commitMs += end - start; }
      if (label === "Render") { work.renderMs += end - start; work.renders.push(end - start); }
    }
    return original(...a);
  };

  window.__runStage = "Detect";
  const t0 = performance.now();
  counting = true;
  btn("Detect").click();
  await waitFor(() => btn("Detect").disabled, "Detect has started");
  const timeline = [], boxes = { atMs: null, atBadges: null };
  for (;;) {
    const now = Math.round(performance.now() - t0), shown = badges().length;
    if (!timeline.length || timeline[timeline.length - 1][1] !== shown) timeline.push([now, shown]);
    if (boxes.atMs === null && canvasDrawn() > 0) { boxes.atMs = now; boxes.atBadges = shown; }
    if (!btn("Detect").disabled && shown >= files.length) break;
    if (performance.now() - t0 > 240000) throw new Error("timeout: Detect");
    await tick();
  }
  const detectMs = Math.round(performance.now() - t0);
  await ticks(30);
  counting = false;
  console.timeStamp = original;
  if (boxes.atMs === null && canvasDrawn() > 0) boxes.atMs = detectMs;
  const result = {
    label: LABEL, photos: files.length, detectMs,
    badges: timeline, boxes, work: { commits: work.commits, renderMs: Math.round(work.renderMs * 10) / 10, commitMs: Math.round(work.commitMs * 10) / 10, renderMedianMs: Math.round(median(work.renders) * 10) / 10, renderMaxMs: Math.round(Math.max(0, ...work.renders) * 10) / 10 },
    final: badges(),
  };
  await fetch(`${BASE}/regression/collect/detect-live-${LABEL}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
  window.__runStage = "reporting";
  return result;
})();
