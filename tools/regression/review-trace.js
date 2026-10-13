// Trace of the review screen and of the upload screen: a fixed list of steps (keys, zoom, wheel, drag, rename, dialogs,
// delete, language, theme, Edit, the preview window) and, after each step, what the page shows: the HTML of the app, the
// values of the inputs, the focus, the scroll of the list, the history state. Two traces (before and after a change of
// the code) are compared by compare-trace.mjs; they must be identical when the change is not meant to be seen.
//   Run it in the page after run.js (S1, orientation right) has left the page on the review screen (see README):
//     window.__LABEL = "main-a"; (0,eval)(await (await fetch("http://127.0.0.1:8765/regression/review-trace.js")).text())
//   window.__runStage tells where it is; the result is posted to tools/regression/work/collected-trace-<label>.json
(async () => {
  const BASE = "http://127.0.0.1:8765";
  const LABEL = window.__LABEL || "trace";
  const tick = () => new Promise((res) => { const c = new MessageChannel(); c.port1.onmessage = () => res(); c.port2.postMessage(0); });
  const ticks = async (n) => { for (let i = 0; i < n; i += 1) await tick(); };
  const waitFor = async (fn, label, ms = 20000) => { const t0 = performance.now(); for (;;) { const v = fn(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("timeout: " + label); await tick(); } };
  const root = document.getElementById("root");
  const trace = [];
  const errors = [];
  const origError = console.error.bind(console);
  console.error = (...a) => { errors.push(a.map((x) => String(x && x.message ? x.message : x)).join(" ").slice(0, 160)); origError(...a); };
  window.addEventListener("error", (e) => errors.push("window error: " + e.message));
  window.addEventListener("unhandledrejection", (e) => errors.push("unhandled rejection: " + String(e.reason)));
  // the pointer capture of a pointer that does not exist (a synthetic event) throws; the same patch is used for every run
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};

  // ---- what is recorded after a step
  // what depends on timing and not on the code: the blob addresses, and, in the list of the upload screen, the thumbnails
  // (they are made in the background, one by one, and an item whose thumbnail was not ready when Process was clicked
  // keeps its placeholder after Edit) and the sizes in pixels that are read in the background too
  const norm = (s) => s
    .replace(/blob:http:\/\/[^"')\s]+/g, "blob:#")
    .replace(/<img alt="[^"]*" width="56" height="56"[^>]*>/g, "<THUMBNAIL>")
    .replace(/<div class="rounded border" aria-hidden="true" style="width: 56px[^>]*><\/div>/g, "<THUMBNAIL>")
    .replace(/(<div class="text-muted">[\d.]+ [KMG]?B • )[^<]*(<\/div>)/g, "$1SIZE$2");
  const describe = (el) => el
    ? [el.tagName.toLowerCase(), el.type ?? "", el.getAttribute("aria-label") ?? "", (el.textContent ?? "").trim().slice(0, 30), el.value ?? "", el.selectionStart ?? "", el.selectionEnd ?? ""].join("|")
    : "none";
  const inputs = () => [...root.querySelectorAll("input")].map((i) => `${i.type}:${i.type === "checkbox" ? i.checked : i.value}`);
  // the sizes of the points on the picture follow the measured scale of the svg, which the page updates when the browser
  // reports a new size (a moment after the layout changed): wait until what is drawn matches what is measured
  const scaleSettled = () => {
    const svg = document.querySelector("svg image")?.closest("svg"), circle = svg?.querySelector("circle");
    if (!svg || !circle) return true;
    const box = svg.getAttribute("viewBox").split(" ").map(Number), rect = svg.getBoundingClientRect();
    return Math.abs(Number(circle.getAttribute("r")) - 7 / Math.min(rect.width / box[2], rect.height / box[3])) < 1e-6;
  };
  const snap = async (name, n = 25, extra = null) => {
    window.__runStage = name;
    await ticks(n);
    await waitFor(scaleSettled, "the scale of the svg", 8000);
    // the picture of the preview window is a big JPEG that is decoded in the background, and the boxes are drawn when it is there
    await waitFor(() => { const img = document.querySelector("[role=dialog] img"); return !img || (img.complete && img.naturalWidth > 0); }, "the picture of the preview window", 30000);
    await ticks(10);
    trace.push({
      name,
      extra,
      html: norm(root.innerHTML),
      inputs: inputs(),
      active: describe(document.activeElement),
      // for finding out why two runs differ, not compared: the window (size, width without the scrollbar, pixel ratio) and the picture of the review
      layout: (() => { const r = document.querySelector("svg image")?.closest("svg")?.getBoundingClientRect(); return [innerWidth, innerHeight, document.documentElement.clientWidth, r ? r.width : null, r ? r.height : null, devicePixelRatio]; })(),
      listScroll: root.querySelector(".list-group")?.scrollTop ?? null,
      historyState: JSON.stringify(history.state),
      lang: localStorage.getItem("wingai-lang"),
      page: norm(document.documentElement.outerHTML.slice(0, document.documentElement.outerHTML.indexOf(">") + 1)) + "|" + document.body.className,
      dialogs: [...document.querySelectorAll("[role=dialog]")].map((d) => d.getAttribute("aria-label")),
    });
  };

  // ---- helpers
  const btn = (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  const byLabel = (label) => document.querySelector(`[aria-label="${label}"]`);
  const key = (k, target = window) => target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  const press = async (k, n = 12) => { key(k); await ticks(n); };
  const range = () => document.querySelector("input[type=range]");
  const nameInput = () => document.querySelector("input[type=text].form-control");
  const reviewSvg = () => document.querySelector("svg image")?.closest("svg") ?? null;
  const setValue = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v)); };
  const setRange = async (v, n = 10) => { const el = range(); setValue(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); await ticks(n); };
  const typeInto = async (el, text, n = 10) => { setValue(el, text); el.dispatchEvent(new Event("input", { bubbles: true })); await ticks(n); };
  const wheel = (dy, ctrl = true) => reviewSvg().dispatchEvent(new WheelEvent("wheel", { deltaY: dy, ctrlKey: ctrl, bubbles: true, cancelable: true }));
  const drag = async (dx, dy, steps = 4) => {
    await waitFor(scaleSettled, "the scale of the svg before a drag", 8000);
    const svg = reviewSvg(), r = svg.getBoundingClientRect();
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    const fire = (type, x, y, mx, my) => svg.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, movementX: mx, movementY: my, pointerId: 1, pointerType: "mouse", button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true }));
    fire("pointerdown", x0, y0, 0, 0);
    for (let i = 1; i <= steps; i += 1) { fire("pointermove", x0 + (dx * i) / steps, y0 + (dy * i) / steps, dx / steps, dy / steps); await ticks(3); }
    fire("pointerup", x0 + dx, y0 + dy, 0, 0);
    await ticks(8);
  };
  const dialogBtn = (re) => [...document.querySelectorAll("[role=dialog] button")].find((b) => re.test(`${b.textContent.trim()}|${b.getAttribute("aria-label") ?? ""}`));
  const closeDialog = async (re = /^Cancel\|/) => { dialogBtn(re).click(); await ticks(12); };
  const listItems = () => [...document.querySelectorAll(".list-group button")];
  // the back button of the browser: wait until the popstate event has really come
  let pops = 0;
  window.addEventListener("popstate", () => { pops += 1; });
  const back = async () => { const before = pops; history.back(); await waitFor(() => pops > before, "popstate"); await ticks(15); };

  // ================= the review screen (the page is on the last photo)
  await waitFor(() => btn("Generate data") && range(), "the review screen");
  // the theme is kept in the local storage of the address, and a new address starts with the theme of the system: start the same way
  document.querySelector('[role=radio][aria-label="Light mode"]')?.click();
  await ticks(15);
  await snap("review: the last photo");

  // moving between the photos
  await press("ArrowLeft"); await snap("ArrowLeft");
  for (let i = 0; i < 6; i += 1) await press("ArrowLeft");
  await snap("ArrowLeft to the first photo");
  await press("ArrowLeft"); await snap("ArrowLeft on the first photo does nothing");
  btn("Next").click(); await snap("Next button");
  btn("Previous").click(); await snap("Previous button");
  listItems()[3].click(); await snap("click on the 4th photo of the list");

  // the zoom slider
  for (const z of [1.1, 1.5, 2, 2.5, 3, 2, 1.2, 1]) { await setRange(z); await snap(`slider ${z}`, 6); }

  // ctrl + wheel, one event at a time and in bursts
  wheel(-500); await snap("ctrl+wheel in, 1 event");
  wheel(-300); await snap("ctrl+wheel in, 1 more");
  wheel(400, false); await snap("wheel without ctrl does nothing");
  wheel(250); await snap("ctrl+wheel out");
  for (let i = 0; i < 6; i += 1) wheel(-150);
  await snap("ctrl+wheel burst in (6 events at once)");
  for (let i = 0; i < 6; i += 1) wheel(150);
  await snap("ctrl+wheel burst out (6 events at once)");
  await setRange(1);

  // panning by dragging the picture
  await drag(-60, -20); await snap("drag at zoom 1 does nothing");
  await setRange(2); await snap("zoom 2");
  await drag(-120, -40); await snap("pan left-up at zoom 2");
  await drag(300, 90); await snap("pan right-down at zoom 2");
  await setRange(3); await snap("zoom 3 from a panned zoom 2");
  await drag(-2000, -900); await snap("pan to the top-left edge at zoom 3");
  await drag(3000, 1500); await snap("pan to the bottom-right edge at zoom 3");
  await setRange(2); await snap("zoom out to 2 from the corner");
  await setRange(1); await snap("zoom out to 1");
  await setRange(3); await snap("zoom 3 again: where is the view?");
  await drag(-500, 0); await snap("pan left at zoom 3");
  await setRange(1.5); await snap("zoom 1.5 after panning at zoom 3");
  await setRange(3); await snap("zoom 3 once more");

  // a new photo starts at zoom 1, and the field of the zoom loses the focus
  await drag(-200, -60); await snap("zoom 3 panned, before changing the photo");
  await press("ArrowRight"); await snap("next photo: zoom and pan reset");
  await setRange(2.5); await drag(-100, -30); range().focus(); await snap("zoom 2.5 panned, the slider has the focus");
  await press("ArrowRight"); await snap("ArrowRight with the slider focused");
  await setRange(2); listItems()[1].click(); await snap("zoom 2, then click on the 2nd photo of the list");
  await setRange(2.2); btn("Next").click(); await snap("zoom 2.2, then the Next button");
  // a photo that changes while the zoom slider has the focus (as when the crop arrives during Process): the slider lets go
  range().focus(); btn("Previous").click(); await snap("the slider is focused, then the picture changes");

  // the name of the photo
  key("n"); await ticks(10); await snap("N focuses and selects the name");
  await typeInto(nameInput(), "renamed-photo.dw.png"); await snap("a new name typed, not committed");
  key("Enter", nameInput()); await ticks(12); await snap("Enter commits the name");
  await typeInto(nameInput(), "other-name.dw.png"); await snap("another name typed");
  nameInput().blur(); await ticks(12); await snap("leaving the field commits the name");
  nameInput().focus(); await typeInto(nameInput(), "   "); nameInput().blur(); await ticks(12); await snap("a blank name is put back");
  await press("ArrowRight"); await snap("the name follows the next photo");
  await press("ArrowLeft"); await snap("the name follows the previous photo");
  nameInput().focus(); await typeInto(nameInput(), "typed-and-not-committed.dw.png"); await snap("typed, then leaving by a click on the list");
  listItems()[5].click(); await snap("click on the list while the name is edited");

  // the dialogs of the review screen: Edit, Reset, the logo, the back button of the browser
  btn("Edit").click(); await snap("Edit button opens its dialog");
  await closeDialog(); await snap("Cancel closes the Edit dialog");
  btn("Edit").click(); await ticks(10); await closeDialog(/\|Close$/); await snap("the X closes the Edit dialog");
  btn("Reset").click(); await snap("Reset button opens its dialog");
  await closeDialog(); await snap("Cancel closes the Reset dialog");
  byLabel("WingAI home").click(); await snap("the logo opens the Reset dialog");
  await closeDialog(); await snap("Cancel closes it");
  byLabel("WingAI home").click(); await ticks(10);
  document.querySelector("[role=presentation]").click(); await ticks(12);
  await snap("a click on the backdrop closes the Reset dialog");
  await back(); await snap("the back button opens the Edit dialog");
  await closeDialog(); await snap("Cancel closes it (the back button)");
  await back(); await back(); await snap("the back button twice");
  await closeDialog(); await snap("Cancel after two back buttons");
  await back(); await snap("the back button, 3rd time");
  await closeDialog(); await snap("Cancel after the 3rd back button");
  btn("Edit").click(); await snap("the Edit button after the back button was used");
  await closeDialog();

  // the export dialog (nothing is downloaded)
  btn("Generate data").click(); await snap("Generate data opens its dialog");
  const csv = [...document.querySelectorAll("[role=dialog] input[type=checkbox]")][1];
  csv.click(); await snap("the CSV box ticked");
  await closeDialog(/^Cancel\|/); await snap("Cancel closes the export dialog");

  // language and theme
  byLabel("Select language").click(); await snap("the language menu");
  btn("Polski").click(); await snap("Polish");
  btn("Edytuj").click(); await snap("Polish: the Edit dialog");
  await closeDialog(/^Anuluj\|/); await snap("Polish: Anuluj closes it");
  byLabel("Wybierz język").click(); await ticks(10); btn("English").click(); await snap("English again");
  document.querySelector('[role=radio][aria-label="Dark mode"]')?.click(); await snap("dark mode");
  document.querySelector('[role=radio][aria-label="Light mode"]')?.click(); await snap("light mode");

  // deleting a photo
  listItems()[0].click(); await ticks(10);
  btn("Delete").click(); await snap("Delete removes the first photo");
  listItems()[listItems().length - 1].click(); await ticks(10);
  btn("Delete").click(); await snap("Delete removes the last photo");

  // ================= back to the upload screen: Edit, the preview window, Reset
  btn("Edit").click(); await ticks(10); dialogBtn(/^Edit\|/).click();
  await waitFor(() => btn("Process"), "the upload screen"); await snap("Edit: back on the upload screen", 40);
  btn("Preview").click(); await waitFor(() => document.querySelector("[role=dialog]"), "the preview window"); await snap("the preview window");
  await press("ArrowRight"); await press("ArrowRight"); await snap("preview: ArrowRight twice");
  await press("ArrowLeft"); await snap("preview: ArrowLeft");
  key("Delete"); await ticks(15); await snap("preview: Delete removes the photo");
  for (let i = 0; i < 8; i += 1) await press("ArrowRight", 6);
  await snap("preview: the last photo");
  key("Delete"); await ticks(15); await snap("preview: Delete on the last photo", 25, { previewOpen: !!document.querySelector("[role=dialog]") });
  key("Escape"); await ticks(15); await snap("preview: Escape closes it", 25, { previewOpen: !!document.querySelector("[role=dialog]") });
  byLabel("WingAI home").click(); await snap("upload screen: the logo opens the Reset dialog");
  await closeDialog(); await snap("upload screen: Cancel");
  byLabel("Select language").click(); await ticks(10); btn("Polski").click(); await snap("upload screen: Polish");
  byLabel("Wybierz język").click(); await ticks(10); btn("English").click(); await snap("upload screen: English again");

  window.__runStage = "reporting";
  const result = { label: LABEL, steps: trace.length, errors, trace };
  await fetch(`${BASE}/regression/collect/trace-${LABEL}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
  return { label: LABEL, steps: trace.length, errors };
})();
