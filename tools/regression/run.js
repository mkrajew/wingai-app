// Regression snapshot of "Process" through the real UI, the real detector and the user's local backend (Vite dev
// server, the helper server of tools/pose/browser). It records what goes to the backend and what the review screen
// shows when processing is done, so the same run before and after a change can be compared (compare.mjs).
//   window.__SCENARIO  "S1" (default): 8 photos, all cropped
//                      "S2": 6 photos + another photo under a name that gives the same output name, then, after Detect, a clean
//                          wing saved as JPEG (no detections: converted, not cropped) and a broken .jpg; the backend answers 500 for one photo;
//                          the orientation switch is set (window.__ORIENT: right | left | original, default right)
//                      "S3": seven wings that are already cut (no Detect), upright or upside down, on either side
//   window.__ORIENT    right | left | original: the orientation switch (S1 and S3 leave it alone when it is not set)
//   window.__MODEL     precise | rotation: the model switch (not touched when it is not set; precise puts the orientation on "original")
//   window.__REANALYZE true: send every picture of the review to the backend again (judged offline by check_upright.py)
//   window.__LABEL     name of the result file (tools/regression/work/collected-<label>.json)
(async () => {
  const BASE = "http://127.0.0.1:8765";
  const SCENARIO = window.__SCENARIO || "S1";
  const LABEL = window.__LABEL || `run-${SCENARIO}`;
  const ORIENT = window.__ORIENT || "right";
  const MODEL = window.__MODEL || null;
  const FAIL = window.__FAIL || (SCENARIO === "S2" ? ["IMG_6470"] : []);
  const ORIENT_LABEL = { right: "Orient all wings to the right", left: "Orient all wings to the left", original: "Keep original orientation" };
  const MODEL_LABEL = { precise: "Model for horizontally aligned wings", rotation: "Model for rotated wings" };

  const tick = () => new Promise((res) => { const c = new MessageChannel(); c.port1.onmessage = () => res(); c.port2.postMessage(0); });
  const ticks = async (n) => { for (let i = 0; i < n; i += 1) await tick(); };
  const waitFor = async (fn, label, ms = 300000) => { const t0 = performance.now(); for (;;) { const v = fn(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("timeout: " + label); await tick(); } };
  const btn = (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  const radio = (label) => document.querySelector(`[role=radio][aria-label="${label}"]`);
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // exact hash plus a coarse signature (mean colour of a 16 x 8 grid of blocks, sampled), so that a one-level raster
  // difference (GPU or CPU drawing) can be told apart from a real change
  const pixelHash = async (blob) => {
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, bmp.width, bmp.height);
    bmp.close();
    const GX = 16, GY = 8, sums = new Float64Array(GX * GY * 3), counts = new Float64Array(GX * GY);
    for (let py = 0; py < d.height; py += 3) for (let px = 0; px < d.width; px += 3) {
      const g = Math.min(GY - 1, Math.floor((py * GY) / d.height)) * GX + Math.min(GX - 1, Math.floor((px * GX) / d.width));
      const o = (py * d.width + px) * 4;
      sums[g * 3] += d.data[o]; sums[g * 3 + 1] += d.data[o + 1]; sums[g * 3 + 2] += d.data[o + 2]; counts[g] += 1;
    }
    const sig = Array.from(sums, (v, k) => Math.round((v / Math.max(1, counts[Math.floor(k / 3)])) * 10) / 10);
    // the hash of the same picture turned by 180 degrees (the pixels in reverse order), to recognise a turned picture
    const reversed = new Uint32Array(d.data.buffer.slice(0)).reverse();
    return {
      w: d.width, h: d.height, hash: hex(await crypto.subtle.digest("SHA-256", d.data.buffer)).slice(0, 24), sig,
      hashRot180: hex(await crypto.subtle.digest("SHA-256", reversed.buffer)).slice(0, 24),
    };
  };

  // ---- spies: console and the backend
  const errors = [], warnings = [];
  const origError = console.error.bind(console), origWarn = console.warn.bind(console);
  console.error = (...a) => { errors.push(a.map((x) => String(x && x.message ? x.message : x)).join(" ").slice(0, 140)); origError(...a); };
  console.warn = (...a) => { warnings.push(String(a[0]).slice(0, 90)); origWarn(...a); };
  const uploads = [], answers = [];
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (!(url.includes("/api/analyze") && init && init.body instanceof FormData)) return origFetch(input, init);
    const file = init.body.get("file");
    uploads.push({ name: file.name, x_size: init.body.get("x_size"), y_size: init.body.get("y_size"), model: init.body.get("model"), bytes: file.size, blob: file });
    if (FAIL.some((p) => file.name.startsWith(p))) { answers.push({ name: file.name, status: 500 }); return new Response("injected failure", { status: 500, statusText: "Injected" }); }
    const res = await origFetch(input, init);
    res.clone().json().then((d) => answers.push({ name: file.name, status: res.status, orientation: d.orientation, check: d.check, coords: d.coords })).catch(() => {});
    return res;
  };

  // ---- the model must be in the cache (the Detect step uses it)
  let MODEL_URL = "/models/best-dota.onnx", CACHE_NAME = "wingai-models-v1"; // the built app has no /src modules
  try { ({ MODEL_URL, CACHE_NAME } = await import("/src/utils/modelCache.ts")); } catch { /* production bundle */ }
  const cache = await caches.open(CACHE_NAME);
  if (!(await cache.match(MODEL_URL))) await cache.put(MODEL_URL, new Response(await (await fetch(MODEL_URL)).arrayBuffer()));

  // ---- the files
  const raw = async (name) => (await origFetch(`${BASE}/raw/${name}`)).blob();
  let n = 0;
  const mk = (blob, name, type = "image/jpeg") => new File([blob], name, { type, lastModified: 1700000000000 + n++ });
  const upload = async (files) => {
    const input = document.querySelector("input[type=file]");
    const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => files.every((f) => document.body.innerText.includes(f.name)), "listed " + files.map((f) => f.name).join());
    await ticks(30);
  };
  const first = [], late = [];
  if (SCENARIO === "S1") {
    for (const id of [6466, 6467, 6468, 6469, 6470, 6471, 6472, 6473]) first.push(mk(await raw(`IMG_${id}.JPG`), `IMG_${id}.JPG`));
  } else if (SCENARIO === "S3") {
    // cut and turned wings of the PL set: flagged or not, upright or upside down, a right or a left wing (a vertical mirror image)
    const wingBmp = async (name) => createImageBitmap(await (await origFetch(`${BASE}/cropped/PL-wing-images/${name}`)).blob());
    const make = async (bmp, { cutLeft = 0, cutRight = 0, how = "id" }) => {
      const sx = Math.round(bmp.width * cutLeft), sw = Math.round(bmp.width * (1 - cutLeft - cutRight));
      const oc = new OffscreenCanvas(sw, bmp.height), x = oc.getContext("2d");
      if (how === "rot180") x.setTransform(-1, 0, 0, -1, sw, bmp.height);
      if (how === "flipV") x.setTransform(1, 0, 0, -1, 0, bmp.height);
      if (how === "flipH") x.setTransform(-1, 0, 0, 1, sw, 0);
      x.drawImage(bmp, sx, 0, sw, bmp.height, 0, 0, sw, bmp.height);
      return oc.convertToBlob({ type: "image/png" });
    };
    const a = await wingBmp("PL-0134-000875-R.dw.png"), b = await wingBmp("PL-0057-000122-R.dw.png");
    const spec = [
      ["flag-up.png", a, { cutLeft: 0.12 }], ["flag-down.png", a, { cutLeft: 0.12, how: "rot180" }],
      ["ok-up.png", a, {}], ["ok-down.png", a, { how: "rot180" }],
      ["flag2-down.png", b, { cutRight: 0.12, how: "rot180" }], ["mirror-down.png", a, { how: "flipV" }], ["mirror-up.png", b, { how: "flipH" }],
    ];
    for (const [name, bmp, how] of spec) first.push(mk(await make(bmp, how), name, "image/png"));
  } else {
    for (const id of [6466, 6467, 6468, 6469, 6470, 6471]) first.push(mk(await raw(`IMG_${id}.JPG`), `IMG_${id}.JPG`));
    first.push(mk(await raw("IMG_6468.JPG"), "IMG_6466.jpeg")); // another photo that gets the same output name as IMG_6466.JPG
    // a clean wing saved as JPEG, added after Detect: no detections, so it is not cropped, only converted to PNG
    const wing = await (await origFetch(`${BASE}/cropped/PL-wing-images/PL-0134-000875-R.dw.png`)).blob();
    const bmp = await createImageBitmap(wing);
    const oc = new OffscreenCanvas(bmp.width, bmp.height); oc.getContext("2d").drawImage(bmp, 0, 0);
    late.push(mk(await oc.convertToBlob({ type: "image/jpeg", quality: 0.95 }), "PLwing.jpg"));
    late.push(mk(new Blob(["this is not a jpeg ".repeat(200)]), "broken.jpg")); // cannot be decoded
  }
  await upload(first);
  if (SCENARIO !== "S3") {
    btn("Detect").click();
    await waitFor(() => document.querySelectorAll("li .badge").length >= first.length, "detections");
    await ticks(30);
  }
  if (late.length) await upload(late);
  if (SCENARIO === "S2" || window.__ORIENT) { radio(ORIENT_LABEL[ORIENT]).click(); await ticks(40); }
  if (MODEL) { radio(MODEL_LABEL[MODEL]).click(); await ticks(40); } // after the orientation: precise puts it back on "original"
  const all = [...first, ...late];

  // ---- Process, and watch what the screen does
  const reviewSvg = () => document.querySelector("svg image")?.closest("svg") ?? null;
  const href = () => document.querySelector("svg image")?.getAttribute("href") ?? null;
  const circles = () => reviewSvg()?.querySelectorAll("circle").length ?? 0;
  const bar = () => document.querySelector("[role=progressbar]");
  const ready = () => { const b = btn("Generate data"); return !!b && !b.disabled && !bar(); };
  const timeline = {};
  // how long the page is blocked while processing (tasks over 50 ms on the main thread)
  const longTasks = [];
  let observer = null;
  try { observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) longTasks.push(e.duration); }); observer.observe({ entryTypes: ["longtask"] }); } catch { /* not supported */ }
  const t0 = performance.now();
  btn("Process").click();
  let firstHref = null, barSeen = false;
  for (;;) {
    const t = Math.round(performance.now() - t0);
    const h = href();
    if (!firstHref && h) { firstHref = h; timeline.firstPictureMs = t; }
    const v = bar() ? Number(bar().getAttribute("aria-valuenow")) : null;
    if (v !== null) barSeen = true;
    if (v && !timeline.firstProgressMs) timeline.firstProgressMs = t;
    if (firstHref && h && h !== firstHref && !timeline.pictureChangeMs) timeline.pictureChangeMs = t;
    if (circles() >= 19 && !timeline.firstLandmarksMs) timeline.firstLandmarksMs = t;
    if (barSeen && ready()) { timeline.allDoneMs = t; break; }
    if (t > 900000) { timeline.timeout = true; break; }
    await tick();
  }
  await ticks(40);
  if (observer) { for (const e of observer.takeRecords()) longTasks.push(e.duration); observer.disconnect(); }
  timeline.longTasks = { count: longTasks.length, maxMs: longTasks.length ? Math.round(Math.max(...longTasks)) : 0, totalMs: Math.round(longTasks.reduce((a, b) => a + b, 0)) };
  const banner = document.querySelector("[style*='danger-bg-subtle']")?.innerText?.replace(/\s+/g, " ").trim() ?? null;
  const listNames = [...document.querySelectorAll(".list-group button .text-truncate")].map((e) => e.textContent);

  // ---- what the review shows for every image
  const images = [];
  for (let i = 0; i < listNames.length; i += 1) {
    if (i > 0) { window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await ticks(20); }
    const img = document.querySelector("svg image");
    const pic = img ? await pixelHash(await (await origFetch(img.getAttribute("href"))).blob()) : null;
    images.push({
      i,
      name: document.querySelector("input.form-control.text-center")?.value ?? null,
      view: img ? `${img.getAttribute("width")}x${img.getAttribute("height")}` : null,
      picture: pic,
      circles: img ? [...reviewSvg().querySelectorAll("circle")].map((c) => [c.getAttribute("cx"), c.getAttribute("cy")]) : [],
      error: document.querySelector(".text-danger.small")?.textContent ?? null,
      hasTable: !!document.querySelector("table"),
    });
  }

  // ---- window.__REANALYZE: send every picture the review shows to the backend again. This is the independent proof
  // that the final pictures are upright and on the wanted side: the answers are judged offline with the backend's
  // own alignment to the mean shape (check-upright.py).
  const reanalysis = [];
  if (window.__REANALYZE) {
    for (let i = 1; i < listNames.length; i += 1) { window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); await ticks(5); } // back to the first photo
    await ticks(20);
    for (let i = 0; i < listNames.length; i += 1) {
      if (i > 0) { window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await ticks(20); }
      const img = document.querySelector("svg image");
      if (!img || reviewSvg().querySelectorAll("circle").length !== 19) { reanalysis.push({ i, skipped: true }); continue; }
      const blob = await (await origFetch(img.getAttribute("href"))).blob();
      const f = new FormData();
      f.append("file", blob, "again.png"); f.append("x_size", img.getAttribute("width")); f.append("y_size", img.getAttribute("height")); f.append("model", "rotation");
      let d = null, failure = null;
      for (let attempt = 0; attempt < 3 && !d; attempt += 1) { // a network error here must not lose the whole run
        try { d = await (await origFetch("/api/analyze", { method: "POST", body: f })).json(); } catch (e) { failure = String(e); await ticks(50); }
      }
      reanalysis.push(d
        ? { i, name: listNames[i], w: Number(img.getAttribute("width")), h: Number(img.getAttribute("height")), coords: d.coords, orientation: d.orientation, check: d.check }
        : { i, name: listNames[i], error: failure });
    }
  }

  // ---- what went to the backend
  const sent = [];
  for (const u of uploads) sent.push({ name: u.name, x_size: u.x_size, y_size: u.y_size, model: u.model, bytes: u.bytes, pixels: await pixelHash(u.blob) });
  const result = {
    scenario: SCENARIO, label: LABEL, orient: SCENARIO === "S2" || window.__ORIENT ? ORIENT : "default", model: MODEL ?? "default", files: all.map((f) => f.name),
    listNames, banner, uploads: sent, answers, images, reanalysis, console: { errors, warnings }, timeline,
  };
  await origFetch(`${BASE}/regression/collect/${LABEL}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
  const mirrored = images.filter((im) => { const u = sent.find((s) => s.name.replace(/\.png$/i, "") === (im.name || "").replace(/\.dw\.png$/i, "").replace(/\(\d+\)$/, "")); return u && im.picture && u.pixels.hash !== im.picture.hash; }).length;
  return { label: LABEL, files: all.length, answers: answers.length, failedAnswers: answers.filter((a) => a.status !== 200).length, images: images.length, withLandmarks: images.filter((im) => im.circles.length === 19).length, shownDiffersFromSent: mirrored, banner, errors: errors.length, warnings: warnings.length, timeline };
})()
