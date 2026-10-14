// Is a name that is being typed in the preview window kept while the photo changes in other ways (it is marked to be skipped, Detect gives it its
// boxes), and does the field still follow the photo when another photo is shown and when a name is committed? A committed name shows as the name the photo
// has: also when it comes out the same as before (typed without the extension, a name of another photo typed twice) and when text was typed after the whole
// name (it stays, the extension goes to the end). Runs on its own in a freshly loaded page
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
  nameField().focus();
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

  // 4b. a name is committed by leaving the field
  const leftWith = "renamed-by-leaving.JPG";
  nameField().focus();
  setValue(nameField(), leftWith);
  await ticks(10);
  nameField().blur();
  nameField().dispatchEvent(new FocusEvent("focusout", { bubbles: true })); // a window that does not have the focus sends no blur
  await ticks(30);
  result.afterBlurCommit = nameField().value;
  result.blurCommittedNameInTheList = document.body.innerText.includes(leftWith);

  // 4c. a name that comes out the same as the one the photo has (typed without its extension): the field shows the name of the photo, not what was typed
  const typeAndEnter = async (text) => {
    nameField().focus();
    setValue(nameField(), text);
    await ticks(10);
    nameField().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await ticks(30);
    return nameField().value;
  };
  const typeAndLeave = async (text) => {
    nameField().focus();
    setValue(nameField(), text);
    await ticks(10);
    nameField().blur();
    nameField().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await ticks(30);
    return nameField().value;
  };
  const withoutExtension = leftWith.replace(/\.JPG$/, "");
  result.afterNoExtensionEnter = await typeAndEnter(withoutExtension);
  result.afterNoExtensionLeave = await typeAndLeave(withoutExtension);

  // 4d. text typed after the whole name stays in the name, and the extension goes to the end
  const appendedName = `${leftWith}abc.JPG`;
  result.afterAppendedEnter = await typeAndEnter(`${leftWith}abc`);
  result.appendedNameInTheList = document.body.innerText.includes(appendedName);
  result.afterAppendedLeave = await typeAndLeave(`${appendedName}_2`);
  result.appendedAgainInTheList = document.body.innerText.includes(`${appendedName}_2.JPG`);

  // 4e. a name that another photo has: the photo gets a number, and typing the same again gives the name it has, so the field shows that
  const taken = files[2].name;
  const takenWithNumber = taken.replace(/\.JPG$/, "(2).JPG");
  result.afterTakenName = await typeAndEnter(taken);
  result.afterTakenNameAgain = await typeAndEnter(taken);
  result.afterTakenNameAgainLeave = await typeAndLeave(taken);

  // 5. a photo that is renamed while Detect runs keeps its new name, and still gets its boxes (its number of detections in the list)
  window.__runStage = "rename while Detect runs";
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await ticks(20);
  btn("Clear").click(); await ticks(10);
  [...document.querySelectorAll("[role=dialog] button")].find((b) => b.textContent.trim() === "Clear").click();
  await waitFor(() => !document.querySelector("li"), "the list is empty");
  const again = files.map((f, i) => new File([f], f.name, { type: f.type, lastModified: 1800000000000 + i }));
  const dt2 = new DataTransfer(); again.forEach((f) => dt2.items.add(f));
  input.files = dt2.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await waitFor(() => again.every((f) => document.body.innerText.includes(f.name)), "listed again");
  await waitFor(() => !document.querySelector('li div.rounded.border[aria-hidden="true"]'), "every thumbnail again");
  await ticks(30);
  btn("Detect").click();
  await waitFor(() => btn("Detect").disabled, "Detect has started again");
  [...document.querySelectorAll("li")].at(-1).click();
  await waitFor(() => nameField(), "the preview window again");
  const duringDetect = "renamed-during-detect.JPG";
  const detectedBeforeRename = document.querySelectorAll("li .badge").length;
  nameField().focus();
  setValue(nameField(), duringDetect);
  await ticks(10);
  nameField().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await ticks(20);
  result.renamedWhileDetectingAfterRename = nameField().value;
  result.detectedBeforeRename = detectedBeforeRename;
  await waitFor(() => !btn("Detect").disabled, "Detect over again", 120000);
  await ticks(40);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await ticks(20);
  const item = [...document.querySelectorAll("li")].find((li) => li.innerText.includes(duringDetect));
  result.renamedWhileDetectingInTheList = !!item;
  result.renamedWhileDetectingBadge = item ? (item.querySelector(".badge")?.textContent ?? null) : null;
  result.noOneLostItsName = files.slice(0, -1).every((f) => document.body.innerText.includes(f.name));

  result.ok = result.start === files[0].name && result.typed === draft && result.afterSkipToggle === draft && result.afterSkipToggleBack === draft
    && result.afterDetect === draft && result.afterNext === files[1].name && result.afterCommit === renamed && result.committedNameInTheList
    && result.afterBlurCommit === leftWith && result.blurCommittedNameInTheList
    && result.afterNoExtensionEnter === leftWith && result.afterNoExtensionLeave === leftWith
    && result.afterAppendedEnter === appendedName && result.appendedNameInTheList
    && result.afterAppendedLeave === `${appendedName}_2.JPG` && result.appendedAgainInTheList
    && result.afterTakenName === takenWithNumber && result.afterTakenNameAgain === takenWithNumber && result.afterTakenNameAgainLeave === takenWithNumber
    && result.detectedBeforeRename < again.length && result.renamedWhileDetectingAfterRename === duringDetect && result.renamedWhileDetectingInTheList && Number(result.renamedWhileDetectingBadge) >= 1 && result.noOneLostItsName;
  window.__runStage = "reporting";
  await fetch(`${BASE}/regression/collect/rename-draft-${LABEL}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
  return result;
})();
