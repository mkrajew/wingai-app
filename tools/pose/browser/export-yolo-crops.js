// Set B', the browser part (see make_bprime_items.py). Run it in the page of the Vite dev server (http://localhost:5173) with the collect server
// of tools/pose/browser running. For every item it draws a synthetic photo (the database picture, mirrored or not, turned, scaled, on a bigger
// canvas), finds the wing with the app's own detector, cuts it with the app's own straightenedCrop and posts the crop together with the manual
// landmarks carried into the frame of the crop (y down).
//
//   window.__FROM, window.__TO: the slice of the list of items to make (several tabs can take different slices)
//   window.__ITEMS_FILE: the list in tools/pose/work (default bprime_items.json), window.__PREFIX: the name of the posted batches (default bp)
(async () => {
  const BASE = "http://127.0.0.1:8765";
  const FROM = window.__FROM, TO = window.__TO, BATCH = 20;
  const items = (await (await fetch(`${BASE}/work/${window.__ITEMS_FILE || "bprime_items.json"}`, { cache: "no-store" })).json()).slice(FROM, TO);
  const { MODEL_URL, CACHE_NAME } = await import("/src/utils/modelCache.ts");
  const cache = await caches.open(CACHE_NAME);
  if (!(await cache.match(MODEL_URL))) await cache.put(MODEL_URL, new Response(await (await fetch(MODEL_URL)).arrayBuffer()));
  const { detectFromUrl } = await import("/src/utils/yoloDetector.ts");
  const { straightenedCrop } = await import("/src/utils/obbCrop.ts");
  const { axisAngle } = await import("/src/utils/obb.ts");
  const { mainDetectionIndex } = await import("/src/utils/mainDetection.ts");

  const loadImg = (src) => new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("cannot load " + src.slice(0, 80)));
    i.src = src;
  });
  // the colour of the background of the database picture: the mean of its four corners
  const backgroundOf = (img) => {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const k = 6, w = c.width, h = c.height;
    let r = 0, g = 0, b = 0, n = 0;
    for (const [px, py] of [[0, 0], [w - k, 0], [0, h - k], [w - k, h - k]]) {
      const d = x.getImageData(px, py, k, k).data;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n += 1; }
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  };

  let batch = [], seq = 0, done = 0;
  const failed = [];
  const flush = async () => {
    if (!batch.length) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await fetch(`${BASE}/collect/${window.__PREFIX || "bp"}-${FROM}-${seq}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch) });
        break;
      } catch (e) { await new Promise((r) => setTimeout(r, 1000)); }
    }
    seq += 1; batch = [];
  };

  for (const it of items) {
    try {
      const img = await loadImg(it.url ? `${BASE}${it.url}` : `${BASE}/cropped/${it.cc}-wing-images/${encodeURIComponent(it.name)}`);
      const w = img.naturalWidth, h = img.naturalHeight;
      const C = Math.ceil(Math.hypot(w, h) * it.scale * 1.5);
      const cv = document.createElement("canvas");
      cv.width = C; cv.height = C;
      const ctx = cv.getContext("2d");
      const [r, g, b] = backgroundOf(img);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, C, C);
      // picture pixel -> photo pixel: centre, turn, scale (mirror = negative x scale), back to the corner
      const M = new DOMMatrix().translate(C / 2, C / 2).rotate(it.theta).scale(it.mirror ? -it.scale : it.scale, it.scale).translate(-w / 2, -h / 2);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.setTransform(M);
      ctx.drawImage(img, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
      const url = URL.createObjectURL(blob);
      const rec = { id: it.id, cc: it.cc, name: it.name, mirror: it.mirror, theta: it.theta, scale: it.scale, canvas: C };
      try {
        const dets = await detectFromUrl(url);
        rec.ndet = dets.length;
        if (dets.length) {
          const main = mainDetectionIndex(dets, null, new Set());
          const d = dets[main];
          const photo = await loadImg(url);
          const crop = straightenedCrop(photo, d);
          const ax = axisAngle(d.w, d.h, d.angle);
          // the same matrix that straightenedCrop uses: centre of the crop, turn by -angle, back by the centre of the box
          const Mc = new DOMMatrix().translate(crop.width / 2, crop.height / 2).rotate((-ax.angle * 180) / Math.PI).translate(-d.cx, -d.cy);
          rec.landmarks = (it.lm || []).map(([x, y]) => {
            const p = Mc.transformPoint(M.transformPoint(new DOMPoint(x, h - 1 - y)));
            return [p.x, p.y];
          });
          rec.det = { cx: d.cx, cy: d.cy, w: d.w, h: d.h, angle: d.angle, conf: d.confidence };
          rec.axisAngle = ax.angle;
          rec.crop = [crop.width, crop.height];
          rec.others = dets.filter((_, k) => k !== main).map((x) => +x.confidence.toFixed(3));
          rec.png = crop.toDataURL("image/png").split(",")[1];
        }
      } finally {
        URL.revokeObjectURL(url);
      }
      batch.push(rec);
    } catch (e) {
      failed.push({ id: it.id, error: String((e && e.message) || e) });
    }
    done += 1;
    window.__bpProgress = { done, failed: failed.length };
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  return { slice: [FROM, TO], items: items.length, failed };
})();
