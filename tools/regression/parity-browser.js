// Does the pose reading of the app, run in the browser on the pixels that a canvas gives, say what the Python reference says?
// check_ts_parity.mjs does it in Node with its own PNG decoder; this is the same in the page, where the PNG is decoded by the browser and drawn on a canvas.
// Run it in the page of the Vite dev server, with the helper server of tools/pose/browser running and work/parity/table.json made by tools/pose/parity_table.py.
// It runs on its own and leaves the answer in window.__parityResult (null while it works):
//   window.__PARITY_STEP = 12; window.__parityResult = null; (0, eval)(await (await fetch("http://127.0.0.1:8765/regression/parity-browser.js", { cache: "no-store" })).text())
//   window.__PARITY_STEP: every n-th picture of the table is taken (default 12, about 430 pictures)
(() => {
  const run = async () => {
    const BASE = "http://127.0.0.1:8765";
    const STEP = window.__PARITY_STEP || 12;
    const { shrinkArea } = await import("/src/utils/areaResize.ts");
    const { POSE_WIDTH, POSE_HEIGHT, descriptorOf, grayOf, readingFromScores, scoresOf, validMask } = await import("/src/utils/poseFromPixels.ts");
    const table = (await (await fetch(`${BASE}/work/parity/table.json`, { cache: "no-store" })).json()).filter((_, i) => i % STEP === 0);
    const hex = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const poseOf = (r) => (r.side === "right" ? (r.upsideDown ? "rot180" : "id") : r.upsideDown ? "flipV" : "flipH");

    const different = { gray: 0, mask: 0, descriptor: 0, scores: 0, pose: 0, margin: 0 };
    let worstScore = 0, wrongPoses = 0, good = 0;
    for (const row of table) {
      const bitmap = await createImageBitmap(await (await fetch(`${BASE}/work/${row.png}`)).blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      const { width: w, height: h } = canvas;
      const gray = grayOf(ctx.getImageData(0, 0, w, h).data, w, h);
      const small = shrinkArea(gray, w, h, POSE_WIDTH, POSE_HEIGHT);
      if (!small) { different.gray += 1; continue; }
      const valid = validMask(gray, w, h);
      const descriptor = descriptorOf(small, valid);
      const scores = scoresOf(descriptor);
      const reading = readingFromScores(scores);
      if ((await hex(small)) !== row.gray_sha256) different.gray += 1;
      if ((valid === null) !== row.valid_all || (await hex(valid ?? new Uint8Array(POSE_WIDTH * POSE_HEIGHT).fill(1))) !== row.valid_sha256) different.mask += 1;
      if ((await hex(descriptor)) !== row.descriptor_sha256) different.descriptor += 1;
      const ds = Math.max(...scores.map((s, i) => Math.abs(s - row.scores[i])));
      worstScore = Math.max(worstScore, ds);
      if (ds > 1e-5) different.scores += 1;
      if (poseOf(reading) !== row.best) different.pose += 1;
      if (Math.abs(reading.margin - row.margin) > 1e-5) different.margin += 1;
      if (row.good) { good += 1; if (poseOf(reading) !== row.truth) wrongPoses += 1; }
    }
    const equal = Object.values(different).every((n) => n === 0);
    return { pictures: table.length, good, wrongPosesAmongGood: wrongPoses, differentFromReference: different, worstScoreDifference: worstScore, ok: equal && wrongPoses === 0 };
  };
  window.__parityResult = null;
  run().then((r) => { window.__parityResult = r; }, (e) => { window.__parityResult = { error: String(e), ok: false }; });
  return "started";
})()
