// Is a name that is being typed in the preview window kept while the photo changes in other ways (it is marked to be skipped, Detect gives it its
// boxes), and does the field still follow the photo when another photo is shown and when a name is committed? Runs on its own in a freshly loaded page
// and needs only the Vite page and the helper server (a window of a proper size, see the README):
//   Object.assign(window, { __LABEL: "before" }); await (0, eval)(await (await fetch("http://127.0.0.1:8765/regression/rename-draft.js", { cache: "no-store" })).text());
// The result is posted to work/collected-rename-draft-<label>.json and returned. `ok` says whether every check came out as it should.
(async () => {
  const BASE = "http://127.0.0.1:8765";
  const LABEL = window.__LABEL || "rename-draft";
  const tick = () => new Promise((res) => { const c = new MessageChannel(); c.port1.onmessage = () => res(); c.port2.postMessage(0); });
  const ticks = async (n) => { for (let i = 0; i < n; i += 1) await tick(); };
  const waitFor = async (fn, label, ms = 180000) => { const t0 = performance.now(); for (;;) { const v = fn(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("timeout: " + label); await tick(); } };
  const btn = (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  const inDialog = (text) => [...document.querySelectorAll("[role=dialog] button")].find((b) => b.textContent.trim() === text);
  const nameField = () => document.querySelector("[role=dialog] input[type=text]");
  const setValue = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); };

  let modelUrl = "/models/best-dota.onnx", cacheName = "wingai-models-v1";
  try { ({ MODEL_URL: modelUrl, CACHE_NAME: cacheName } = await import("/src/utils/modelCache.ts")); } catch { /* production bundle */ }
  const cache = await caches.open(cacheName);
  if (!(await cache.match(modelUrl))) await cache.put(modelUrl, new Response(await (await fetch(modelUrl)).arrayBuffer()));

  const files = [];
  let n = 0;
  for (const id of [6466, 6467, 6468, 6469, 6470, 6471, 6472, 6473]) {
    files.push(new File([await (await fetch(`${BASE}/raw/IMG_${id}.JPG`)).blob()], `IMG_${id}.JPG`, { type: "image/jpeg", lastModified: 1700000000000 + n++ }));
  }
  const input = document.querySelector("input[type=file]");
  const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f));
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  window.__runStage = "loading the photos";
  await waitFor(() => files.every((f) => document.body.innerText.includes(f.name)), "listed");
  await waitFor(() => !document.querySelector('li div.rounded.border[aria-hidden="true"]'), "every thumbnail");
  await ticks(30);

  window.__runStage = "preview";
  btn("Preview").click();
  await waitFor(() => nameField(), "the name field of the preview window");
  await ticks(20);
  const result = { label: LABEL, start: nameField().value };
  const draft = "typed-draft.JPG";

  // 1. the photo is marked to be skipped: its data change, its name does not (a click that is not made with the mouse does not take the focus away)
  setValue(nameField(), draft);
  await ticks(10);
  result.typed = nameField().value;
  (inDialog("Process") ?? inDialog("Skip")).click();
  await ticks(25);
  result.afterSkipToggle = nameField().value;
  (inDialog("Skip") ?? inDialog("Process")).click();
  await ticks(25);
  result.afterSkipToggleBack = nameField().value;

  // 2. Detect gives the photo its boxes while the name is being typed
  window.__runStage = "Detect";
  btn("Detect").click();
  await waitFor(() => btn("Detect").disabled, "Detect has started");
  await waitFor(() => !btn("Detect").disabled && document.querySelectorAll("li .badge").length >= files.length, "Detect over");
  await ticks(30);
  result.afterDetect = nameField().value;

  // 3. another photo is shown: the field takes its name
  inDialog("Next").click();
  await ticks(25);
  result.afterNext = nameField().value;

  // 4. a name is committed with Enter: the photo is renamed and the field shows the new name
  const renamed = "renamed-in-preview.JPG";
  setValue(nameField(), renamed);
  await ticks(10);
  nameField().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await ticks(30);
  result.afterCommit = nameField().value;
  result.committedNameInTheList = document.body.innerText.includes(renamed);

  result.ok = result.start === files[0].name && result.typed === draft && result.afterSkipToggle === draft && result.afterSkipToggleBack === draft
    && result.afterDetect === draft && result.afterNext === files[1].name && result.afterCommit === renamed && result.committedNameInTheList;
  window.__runStage = "reporting";
  await fetch(`${BASE}/regression/collect/rename-draft-${LABEL}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
  return result;
})();
