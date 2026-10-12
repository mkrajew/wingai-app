// End-to-end test of the orientation switch, through the real UI and the real backend (run on the Vite dev
// server). A mixed set is uploaded: natural wings (the backend says "right"), their mirror images (the backend
// says "left") and two wings turned by 180 degrees (upside down). The switch is set to TARGET, Process
// is clicked, the ZIP (images with metadata + points.csv) is downloaded and checked against what the backend said:
//  - pixels: with a side wanted (right | left) a wing on the other side is mirrored and a wing that lies upside down (the two
//    that were turned by 180 degrees: R-*) is turned by 180 degrees, both exactly (a permutation of the pixels), the others are
//    untouched; with "original" nothing is touched
//  - landmarks (metadata and CSV): the mirrored wings' numbers are W - 1 - x of what the backend returned, y unchanged
//  - the pixel under every landmark is the same pixel as before
//  - the backend now sees every (unflagged) exported wing on the TARGET side
//  - Edit brings the originals back: Process again uploads exactly the same bytes
// The verdicts go to tools/regression/work/collected-e2e-<LABEL>-<TARGET>.json (check_upright.py e2e <LABEL> <TARGET> judges them).
//   window.__TARGET  right | left | original (default right)
//   window.__LABEL   the name of the run, e.g. base (default run)
(async () => {
  const TARGET = window.__TARGET || "right"; // "right" | "left" | "original"
  const LABEL = window.__LABEL || "run";
  const BASE = "http://127.0.0.1:8765";
  const NATURAL = ["PL-0134-000875-R.dw.png", "PL-0212-LP-061-001268-L.dw.png", "PL-0057-000122-R.dw.png", "PL-0001-000420-L.dw.png"];
  const TURNED = ["PL-0062-000223-L.dw.png", "PL-0228-LP-077-100483-R.dw.png"];

  const tick = () => new Promise((res) => { const c = new MessageChannel(); c.port1.onmessage = () => res(); c.port2.postMessage(0); });
  const ticks = async (n) => { for (let i = 0; i < n; i += 1) await tick(); };
  const waitFor = async (fn, label, ms = 240000) => { const t0 = performance.now(); for (;;) { const v = fn(); if (v) return v; if (performance.now() - t0 > ms) throw new Error("timeout: " + label); await tick(); } };

  // window.__BREAK_MIRROR: make every canvas export fail after the set-up, so mirroring a picture fails
  const BREAK = !!window.__BREAK_MIRROR;
  const errors = [], warnings = [];
  const origError = console.error.bind(console);
  console.error = (...a) => { errors.push(a.map((x) => String(x && x.message ? x.message : x)).join(" ").slice(0, 160)); origError(...a); };
  const origWarn = console.warn.bind(console);
  console.warn = (...a) => { warnings.push(String(a[0]).slice(0, 80) + " | " + String(a[1])); origWarn(...a); };

  // ---- spy on the backend calls and capture downloads
  let round = 1;
  const uploads = [], answers = [];
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const isAnalyze = url.includes("/api/analyze") && init && init.body instanceof FormData;
    const file = isAnalyze ? init.body.get("file") : null;
    if (isAnalyze) uploads.push({ round, name: file.name, blob: file, model: init.body.get("model") });
    const res = await origFetch(input, init);
    if (isAnalyze) { const r = round; res.clone().json().then((d) => answers.push({ round: r, name: file.name, orientation: d.orientation, check: d.check, coords: d.coords })); }
    return res;
  };
  const blobs = new Map(), downloads = [];
  const origCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (obj) => { const u = origCreate(obj); if (obj instanceof Blob) blobs.set(u, obj); return u; };
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) { downloads.push({ name: this.download, blob: blobs.get(this.href) }); return; } return origClick.call(this); };

  // ---- helpers
  const btn = (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  const box = (label) => [...document.querySelectorAll("input[type=checkbox]")].find((c) => (c.closest("label") || c.parentElement)?.textContent?.trim() === label);
  const radio = (label) => document.querySelector(`[role=radio][aria-label="${label}"]`);
  const decode = async (blob) => {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    return { w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
  };
  const same = (a, ao, b, bo) => a[ao] === b[bo] && a[ao + 1] === b[bo + 1] && a[ao + 2] === b[bo + 2] && a[ao + 3] === b[bo + 3];
  const sha = async (blob) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const transformed = async (blob, name, how) => {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d");
    if (how === "mirror") { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    if (how === "turn") { ctx.translate(c.width, c.height); ctx.rotate(Math.PI); }
    ctx.drawImage(bmp, 0, 0);
    const out = await new Promise((res) => c.toBlob(res, "image/png"));
    return new File([out], name, { type: "image/png", lastModified: 1700000000000 });
  };
  const parseZip = (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Map(); let p = 0;
    while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
      const method = dv.getUint16(p + 8, true), size = dv.getUint32(p + 18, true);
      const nameLen = dv.getUint16(p + 26, true), extraLen = dv.getUint16(p + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nameLen));
      const start = p + 30 + nameLen + extraLen;
      if (method !== 0) throw new Error("compressed entry " + name);
      out.set(name, bytes.slice(start, start + size));
      p = start + size;
    }
    return out;
  };
  const pngText = (bytes, keyword) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let p = 8;
    while (p + 8 <= bytes.length) {
      const len = dv.getUint32(p), type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
      if (type === "tEXt") {
        const data = bytes.subarray(p + 8, p + 8 + len), z = data.indexOf(0);
        if (new TextDecoder().decode(data.subarray(0, z)) === keyword) return new TextDecoder().decode(data.subarray(z + 1));
      }
      if (type === "IEND") break;
      p += 12 + len;
    }
    return null;
  };
  const analyze = async (blob, name, w, h) => {
    const f = new FormData();
    f.append("file", blob, name); f.append("x_size", String(w)); f.append("y_size", String(h)); f.append("model", "rotation");
    const r = await origFetch("/api/analyze", { method: "POST", body: f });
    return r.json();
  };

  // ---- the mixed set
  const files = [];
  for (const n of NATURAL) {
    const blob = await (await origFetch(`${BASE}/cropped/PL-wing-images/${n}`)).blob();
    files.push(new File([blob], n, { type: "image/png", lastModified: 1700000000000 }));
    files.push(await transformed(blob, `M-${n}`, "mirror"));
  }
  for (const n of TURNED) {
    const blob = await (await origFetch(`${BASE}/cropped/PL-wing-images/${n}`)).blob();
    files.push(await transformed(blob, `R-${n}`, "turn"));
  }
  const input = document.querySelector("input[type=file]");
  const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f));
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await waitFor(() => files.every((f) => document.body.innerText.includes(f.name)), "list rendered");
  await ticks(30);

  // ---- the switch, Process, export
  const label = { right: "Orient all wings to the right", left: "Orient all wings to the left", original: "Keep original orientation" }[TARGET];
  radio(label).click();
  await ticks(40);
  const switchState = radio(label).getAttribute("aria-checked");
  if (BREAK) HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); };
  btn("Process").click();
  await waitFor(() => answers.filter((a) => a.round === 1).length === files.length, "answers");
  await waitFor(() => { const b = btn("Generate data"); return b && !b.disabled; }, "review ready");
  await ticks(250);

  btn("Generate data").click(); await ticks(40);
  if (!box("Image metadata").checked) box("Image metadata").click();
  await ticks(10);
  if (!box("CSV").checked) box("CSV").click();
  await ticks(10);
  btn("Download").click();
  await waitFor(() => downloads.length > 0, "download");
  const zip = parseZip(new Uint8Array(await downloads[downloads.length - 1].blob.arrayBuffer()));
  const csvRows = new Map();
  for (const line of new TextDecoder().decode(zip.get("points.csv")).split("\n").slice(1)) {
    const cells = line.slice(1, -1).split('","');
    csvRows.set(cells[0], cells.slice(1).map(Number));
  }

  // ---- checks against what the backend said
  const rh = (v) => Math.floor(v + 0.5);
  const verdicts = [];
  for (const f of files) {
    const up = uploads.find((u) => u.round === 1 && u.name === f.name);
    const ans = answers.find((a) => a.round === 1 && a.name === f.name);
    const bytes = zip.get(f.name);
    if (!up || !ans || !bytes) { verdicts.push({ name: f.name, missing: { up: !up, ans: !ans, exported: !bytes } }); continue; }
    const orig = await decode(f);
    const exportedBlob = new Blob([bytes], { type: "image/png" });
    const exported = await decode(exportedBlob);
    const W = orig.w, H = orig.h;
    const expectFlip = !BREAK && TARGET !== "original" && (ans.orientation === "left" || ans.orientation === "right") && ans.orientation !== TARGET;
    const expectTurn = !BREAK && TARGET !== "original" && f.name.startsWith("R-"); // turned by 180 degrees on purpose: upside down
    const flipX = expectFlip !== expectTurn, flipY = expectTurn; // mirror and turn together = a vertical mirror image

    let pixelMismatches = exported.w === W && exported.h === H ? 0 : -1;
    if (pixelMismatches === 0) {
      for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
        if (!same(exported.data, (y * W + x) * 4, orig.data, ((flipY ? H - 1 - y : y) * W + (flipX ? W - 1 - x : x)) * 4)) pixelMismatches += 1;
      }
    }
    const meta = pngText(bytes, "IdentiFly").replace("landmarks:", "").replace(";", "").split(" ").map(Number);
    const row = csvRows.get(f.name) ?? [];
    const clamp = (v, max) => Math.min(max - 1, Math.max(0, v));
    let coordMismatches = 0, csvMismatches = 0, underPointMismatches = 0;
    for (let i = 0; i < 19; i += 1) {
      const ex = rh(ans.coords[i * 2]), ey = rh(ans.coords[i * 2 + 1]);
      if (meta[i * 2] !== (flipX ? W - 1 - ex : ex) || meta[i * 2 + 1] !== (flipY ? H - 1 - ey : ey)) coordMismatches += 1;
      if (row[i * 2] !== meta[i * 2] || row[i * 2 + 1] !== H - 1 - meta[i * 2 + 1]) csvMismatches += 1;
      if (!same(orig.data, (clamp(ey, H) * W + clamp(ex, W)) * 4, exported.data, (clamp(meta[i * 2 + 1], H) * W + clamp(meta[i * 2], W)) * 4)) underPointMismatches += 1;
    }
    const after = await analyze(exportedBlob, f.name, W, H);
    verdicts.push({
      name: f.name, size: `${W}x${H}`, backendSaid: ans.orientation, check: ans.check, expectFlip, expectTurn,
      afterCoords: after.coords, afterH: H, afterSide: after.orientation,
      pixelMismatches, coordMismatches, csvMismatches, underPointMismatches,
      uploadUnchanged: (await sha(up.blob)) === (await sha(f)),
      sideAfter: after.orientation, checkAfter: after.check,
    });
  }

  // ---- Edit brings the originals back
  const hashes1 = new Map();
  for (const u of uploads.filter((x) => x.round === 1)) hashes1.set(u.name, await sha(u.blob));
  btn("Edit").click(); await ticks(60);
  const dialog = document.querySelector("[role=dialog]");
  const dialogButtons = dialog ? [...dialog.querySelectorAll("button")].map((b) => b.textContent.trim()) : [];
  const confirm = dialog ? [...dialog.querySelectorAll("button")].reverse().find((b) => !["Cancel", "Close", ""].includes(b.textContent.trim())) : null;
  if (confirm) confirm.click();
  await waitFor(() => btn("Process"), "back on the upload screen");
  await ticks(60);
  round = 2;
  btn("Process").click();
  await waitFor(() => answers.filter((a) => a.round === 2).length === files.length, "second answers");
  let same2 = 0, differ2 = [];
  for (const u of uploads.filter((x) => x.round === 2)) {
    if (hashes1.get(u.name) === (await sha(u.blob))) same2 += 1; else differ2.push(u.name);
  }

  await origFetch(`${BASE}/regression/collect/e2e-${LABEL}-${TARGET}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: TARGET, verdicts }) });
  const bad = verdicts.filter((v) => v.missing || v.pixelMismatches !== 0 || v.coordMismatches || v.csvMismatches || v.underPointMismatches || !v.uploadUnchanged);
  const sideWrong = BREAK ? [] : verdicts.filter((v) => !v.missing && TARGET !== "original" && !v.check && !v.checkAfter && v.sideAfter !== TARGET).map((v) => v.name);
  return {
    target: TARGET, switchState, files: files.length,
    flippedCount: verdicts.filter((v) => v.expectFlip).length, turnedCount: verdicts.filter((v) => v.expectTurn).length,
    flaggedAndFlipped: verdicts.filter((v) => v.check && v.expectFlip).map((v) => v.name),
    failing: bad.map((v) => v.name), sideWrong,
    editRestore: { dialogButtons, secondRoundSameBytes: `${same2}/${files.length}`, differ: differ2 },
    errors, warnings: warnings.length ? [`${warnings.length} x ${warnings[0]}`] : [], verdicts: verdicts.map(({ afterCoords, ...rest }) => rest),
  };
})()
