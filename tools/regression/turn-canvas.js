// Does turnedCanvas (src/utils/image.ts) move the pixels exactly as the turn of the app has always done (turnImage)?
// Run it in the page of the Vite dev server, with the helper server of tools/pose/browser running (it serves this file). It takes
// a while (in a hidden Browser pane every toBlob waits about a second), so it runs on its own and leaves the answer in
// window.__turnCanvasResult (null while it works):
//   window.__turnCanvasResult = null; (0, eval)(await (await fetch("http://127.0.0.1:8765/regression/turn-canvas.js", { cache: "no-store" })).text())
//   ... later: window.__turnCanvasResult
//
// A canvas of noise is turned in the four ways (none, mirror, rotate, both) and every result must be the exact permutation of its
// pixels that the turn describes: pixel (x, y) comes from (width - 1 - x when columns are flipped, height - 1 - y when rows are). It is
// made from a canvas, from the decoded PNG of the same canvas and by turnImage, and all must agree. Sizes are odd on purpose.
(() => {
  const run = async () => {
    const { turnedCanvas, turnImage } = await import("/src/utils/image.ts");
    if (typeof turnedCanvas !== "function") throw new Error("turnedCanvas is not exported by src/utils/image.ts");

    const TURNS = [
      ["none", { mirror: false, rotate: false }, false, false],
      ["mirror", { mirror: true, rotate: false }, true, false],
      ["rotate", { mirror: false, rotate: true }, true, true],
      ["mirror and rotate", { mirror: true, rotate: true }, false, true],
    ];
    const SIZES = [[301, 147], [1203, 517], [256, 96]];

    let state = 2463534242;
    const next = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state; };
    const pixelsOf = (canvas) => canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
    const toCanvas = (bitmap) => {
      const c = document.createElement("canvas");
      c.width = bitmap.width; c.height = bitmap.height;
      c.getContext("2d").drawImage(bitmap, 0, 0);
      return c;
    };
    // the number of pixels of `got` that are not the pixels that the turn puts there
    const mismatches = (original, got, w, h, flipX, flipY) => {
      let bad = 0;
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const from = ((flipY ? h - 1 - y : y) * w + (flipX ? w - 1 - x : x)) * 4, to = (y * w + x) * 4;
          if (original[from] !== got[to] || original[from + 1] !== got[to + 1] || original[from + 2] !== got[to + 2] || original[from + 3] !== got[to + 3]) bad += 1;
        }
      }
      return bad;
    };

    const cases = [];
    for (const [w, h] of SIZES) {
      const source = document.createElement("canvas");
      source.width = w; source.height = h;
      const data = new ImageData(w, h);
      for (let i = 0; i < w * h; i += 1) { const v = next(); data.data.set([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, 255], i * 4); }
      source.getContext("2d").putImageData(data, 0, 0);
      const original = pixelsOf(source);
      const blob = await new Promise((resolve) => source.toBlob(resolve, "image/png"));
      const url = URL.createObjectURL(blob);
      const img = new Image(); // not img.decode(): it does not settle in a hidden pane
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error("cannot load the PNG")); img.src = url; });

      for (const [name, turn, flipX, flipY] of TURNS) {
        const fromCanvas = turnedCanvas(source, w, h, turn);
        const fromImage = turnedCanvas(img, w, h, turn);
        const old = await turnImage(url, "x.png", 0, turn);
        const oldCanvas = toCanvas(await createImageBitmap(old.file));
        URL.revokeObjectURL(old.previewUrl);
        cases.push({
          size: `${w}x${h}`, turn: name,
          canvasSize: `${fromCanvas.width}x${fromCanvas.height}`,
          wrongFromCanvas: mismatches(original, pixelsOf(fromCanvas), w, h, flipX, flipY),
          wrongFromImage: mismatches(original, pixelsOf(fromImage), w, h, flipX, flipY),
          wrongInTurnImage: mismatches(original, pixelsOf(oldCanvas), w, h, flipX, flipY),
        });
      }
      URL.revokeObjectURL(url);
    }
    const failures = cases.filter((c) => c.wrongFromCanvas || c.wrongFromImage || c.wrongInTurnImage || c.canvasSize !== c.size);
    return { cases: cases.length, failures, ok: failures.length === 0 };
  };
  window.__turnCanvasResult = null;
  run().then((r) => { window.__turnCanvasResult = r; }, (e) => { window.__turnCanvasResult = { error: String(e), ok: false }; });
  return "started";
})()
