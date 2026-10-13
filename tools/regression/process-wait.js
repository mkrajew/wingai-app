// Does Process wait for the photos and for Detect? Runs on its own in a freshly loaded page and needs only the Vite page and the
// helper server (the answers of the backend are replayed from work/collected-trace-responses.json, see the README):
//   Object.assign(window, { __LABEL: "base" }); await (0, eval)(await (await fetch("http://127.0.0.1:8765/regression/process-wait.js", { cache: "no-store" })).text());
// The result is posted to work/collected-process-wait-<label>.json and returned. window.__runStage tells where it is.
//
//   upload   eight photos and a file that is not a picture are uploaded. Process has to be disabled, with a spinner and a hint, until
//            every thumbnail and size has come, and the broken file, which gets neither, must not hold it back
//   detect   the same photos, and Detect is clicked at once, while they are still loading. Process has to be disabled the whole
//            time, and when Detect is over every photo that can be read must still have its thumbnail
//   edit     Process, then Edit: the list of the upload screen is back, every thumbnail in it
//   flip     a photo is flipped in the preview window: Process waits for the new thumbnail
//   polish   in Polish the hint is in Polish
(async () => {
  const BASE = "http://127.0.0.1:8765";
  const LABEL = window.__LABEL || "process-wait";
  const tick = () => new Promise((res) => { const c = new MessageChannel(); c.port1.onmessage = () => res(); c.port2.postMessage(0); });
  const ticks = async (n) => { for (let i = 0; i < n; i += 1) await tick(); };
  const waitFor = async (fn, label, ms = 180000) => { const t0 = performance.now(); for (;;) { const v = fn(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("timeout: " + label); await tick(); } };
  const btn = (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  const processButton = () => btn("Process") ?? btn("Przetwórz");
  const processState = () => {
    const b = processButton();
    return b ? { disabled: b.disabled, spinner: !!b.querySelector(".spinner-border"), title: b.getAttribute("title") } : null;
  };
  const thumbnails = () => ({
    withThumbnail: document.querySelectorAll('li img.rounded.border[width="56"]').length,
    withoutThumbnail: document.querySelectorAll('li div.rounded.border[aria-hidden="true"]').length,
  });
  const upload = async (files) => {
    const input = document.querySelector("input[type=file]");
    const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => files.every((f) => document.body.innerText.includes(f.name)), "listed");
  };
  // the states of the Process button until `done` says stop: one entry for a run of equal states, with the time it began.
  // With `giveUpMs` it stops after that long instead of failing (a version that does not wait never gets there)
  const watch = async (done, label, giveUpMs = 180000) => {
    const t0 = performance.now(), seen = [];
    for (;;) {
      const state = processState(), text = JSON.stringify(state);
      if (!seen.length || seen[seen.length - 1].text !== text) seen.push({ at: Math.round(performance.now() - t0), text, state });
      if (done()) break;
      if (performance.now() - t0 > giveUpMs) {
        if (giveUpMs < 180000) break;
        throw new Error("timeout: " + label);
      }
      await tick();
    }
    return seen.map((x) => ({ at: x.at, ...x.state }));
  };
  const closeDialog = async (re) => { const b = [...document.querySelectorAll("[role=dialog] button")].find((x) => re.test(x.textContent.trim())); b.click(); await ticks(15); };

  const result = { label: LABEL };
  const errors = [], origError = console.error.bind(console);
  console.error = (...a) => { errors.push(a.map((x) => String(x && x.message ? x.message : x)).join(" ").slice(0, 140)); origError(...a); };

  // the detection model has to be in the cache of the page (the Detect step uses it), the answers of the backend are replayed
  const origFetch = window.fetch.bind(window);
  let modelUrl = "/models/best-dota.onnx", cacheName = "wingai-models-v1";
  try { ({ MODEL_URL: modelUrl, CACHE_NAME: cacheName } = await import("/src/utils/modelCache.ts")); } catch { /* production bundle */ }
  const cache = await caches.open(cacheName);
  if (!(await cache.match(modelUrl))) await cache.put(modelUrl, new Response(await (await fetch(modelUrl)).arrayBuffer()));
  const replay = await (await origFetch(`${BASE}/regression/work/collected-trace-responses.json`, { cache: "no-store" })).json();
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (!(url.includes("/api/analyze") && init && init.body instanceof FormData)) return origFetch(input, init);
    const f = init.body.get("file");
    const answer = replay[[f.name, init.body.get("x_size"), init.body.get("y_size"), init.body.get("model")].join("|")];
    return answer ? new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } }) : new Response("not recorded", { status: 500 });
  };
  let n = 0;
  const mk = (blob, name, type = "image/jpeg") => new File([blob], name, { type, lastModified: 1700000000000 + n++ });
  const photos = async (suffix = "") => {
    const out = [];
    for (const id of [6466, 6467, 6468, 6469, 6470, 6471, 6472, 6473]) out.push(mk(await (await origFetch(`${BASE}/raw/IMG_${id}.JPG`)).blob(), `IMG_${id}${suffix}.JPG`));
    return out;
  };
  const broken = () => mk(new Blob(["this is not a jpeg ".repeat(200)]), "broken.jpg");
  const clear = async () => { btn("Clear").click(); await ticks(10); await closeDialog(/^Clear$/); await waitFor(() => !document.querySelector("li"), "the list is empty"); };

  // ---- upload
  window.__runStage = "upload";
  await upload([...(await photos()), broken()]);
  result.upload = {
    states: await watch(() => { const s = processState(); return s && !s.disabled; }, "Process enabled after the upload"),
    thumbnailsWhenEnabled: thumbnails(),
  };
  await ticks(30);
  result.upload.thumbnailsAfterwards = thumbnails();

  // ---- detect, started at once
  window.__runStage = "detect";
  await clear();
  await upload(await photos());
  btn("Detect").click();
  await waitFor(() => btn("Detect").disabled, "Detect has started");
  const detectStates = await watch(() => !btn("Detect").disabled && document.querySelectorAll("li .badge").length >= 8, "Detect over");
  result.detect = { states: detectStates, thumbnailsAfterDetect: thumbnails() };
  result.detect.statesAfter = await watch(() => { const s = processState(); return s && !s.disabled; }, "Process enabled after Detect");
  await ticks(30);
  result.detect.thumbnailsLater = thumbnails();

  // ---- Process, then Edit
  window.__runStage = "edit";
  document.querySelector('[role=radio][aria-label="Orient all wings to the right"]')?.click();
  await ticks(20);
  btn("Process").click();
  await waitFor(() => { const b = btn("Generate data"); return b && !b.disabled && !document.querySelector("[role=progressbar]"); }, "the review screen", 180000);
  btn("Edit").click(); await ticks(15); await closeDialog(/^Edit$/);
  await waitFor(() => btn("Process"), "back on the upload screen");
  await ticks(40);
  result.edit = { process: processState(), thumbnails: thumbnails() };

  // ---- a photo is flipped in the preview window
  window.__runStage = "flip";
  btn("Preview").click();
  await waitFor(() => document.querySelector("[role=dialog] img"), "the preview window");
  await ticks(20);
  const flip = [...document.querySelectorAll("[role=dialog] button")].find((b) => /Flip H/.test(b.textContent));
  flip.click();
  let sawDisabled = false;
  const flipStates = await watch(() => { const s = processState(); if (s && s.disabled) sawDisabled = true; return sawDisabled && s && !s.disabled; }, "Process after the flip", 20000);
  result.flip = { sawDisabled, states: flipStates };
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await ticks(20);

  // ---- Polish
  window.__runStage = "polish";
  document.querySelector('[aria-label="Select language"]').click(); await ticks(10); btn("Polski").click(); await ticks(10);
  const extra = (await photos("_p")).slice(0, 1);
  await upload(extra);
  result.polish = { firstState: processState(), states: await watch(() => { const s = processState(); return s && !s.disabled; }, "Process enabled (Polish)") };
  document.querySelector('[aria-label="Wybierz język"]').click(); await ticks(10); btn("English").click(); await ticks(10);

  result.errors = errors;
  window.__runStage = "reporting";
  await origFetch(`${BASE}/regression/collect/process-wait-${LABEL}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
  return result;
})();
