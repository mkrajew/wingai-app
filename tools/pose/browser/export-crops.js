// Set A, the browser part. Run it in the page of the Vite dev server (http://localhost:5173) with the collect server of tools/pose/browser
// running (collect_server.py). It makes the crops that "Process" would send to the backend, with the app's own code:
// the detector (utils/yoloDetector.ts) and straightenedCrop (utils/obbCrop.ts), one crop per detection, the most confident one marked "main".
// Every crop is shrunk to at most MAXSIDE px on its long side and posted as collected-crop-<id>-<index>.json together with what the detector said.
//
//   window.__ITEMS = [{ id: "IMG_6466_JPG", set: "", rel: "IMG_6466.JPG" }, { id: "bm3", set: "bm", rel: "folder/IMG_1.JPG" }, ...]
//   (set: "" = the 2026 series of the collect server, "bm" or "pl" = the other raw folders; rel = the path inside it)
(async () => {
  const BASE = "http://127.0.0.1:8765";
  const MAXSIDE = 1100;
  const items = window.__ITEMS;
  const { MODEL_URL, CACHE_NAME } = await import("/src/utils/modelCache.ts");
  const cache = await caches.open(CACHE_NAME);
  if (!(await cache.match(MODEL_URL))) await cache.put(MODEL_URL, new Response(await (await fetch(MODEL_URL)).arrayBuffer()));
  const { detectFromUrl } = await import("/src/utils/yoloDetector.ts");
  const { straightenedCrop } = await import("/src/utils/obbCrop.ts");
  const { loadImage } = await import("/src/utils/image.ts");
  const { mainDetectionIndex } = await import("/src/utils/mainDetection.ts");

  const log = [];
  for (const it of items) {
    try {
      const href = `${BASE}/raw${it.set}/` + it.rel.split("/").map(encodeURIComponent).join("/");
      let blob = null;
      for (let attempt = 0; attempt < 3 && !blob; attempt += 1) {
        try { blob = await (await fetch(href)).blob(); } catch (e) { await new Promise((r) => setTimeout(r, 1500)); }
      }
      if (!blob) throw new Error("cannot fetch " + it.rel);
      const url = URL.createObjectURL(blob);
      const dets = await detectFromUrl(url);
      const img = await loadImage(url);
      const main = mainDetectionIndex(dets, null, new Set());
      for (let i = 0; i < dets.length; i += 1) {
        const canvas = straightenedCrop(img, dets[i]);
        const scale = Math.min(1, MAXSIDE / Math.max(canvas.width, canvas.height));
        const small = document.createElement("canvas");
        small.width = Math.max(1, Math.round(canvas.width * scale));
        small.height = Math.max(1, Math.round(canvas.height * scale));
        const ctx = small.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(canvas, 0, 0, small.width, small.height);
        const png = small.toDataURL("image/png").split(",")[1];
        const d = dets[i];
        await fetch(`${BASE}/collect/crop-${it.id}-${i}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photo: `${it.set}:${it.rel}`, index: i, main: i === main, confidence: d.confidence, cx: d.cx, cy: d.cy, w: d.w, h: d.h, angle: d.angle,
            photoSize: [img.naturalWidth, img.naturalHeight], cropFull: [canvas.width, canvas.height], cropSent: [small.width, small.height], png,
          }),
        });
        log.push({ id: it.id, i, main: i === main });
      }
      URL.revokeObjectURL(url);
    } catch (e) {
      log.push({ id: it.id, error: String((e && e.message) || e) });
    }
    window.__exportProgress = log.length;
  }
  return { photos: items.length, crops: log.filter((l) => !l.error).length, errors: log.filter((l) => l.error) };
})();
