// Does src/utils/orientPicture.ts read the pose of a real wing from its pixels and turn it to the wanted side, upright?
// Run it in the page of the Vite dev server, with the helper server of tools/pose/browser running (it serves this file and the wings of the
// PL database). The answer is left in window.__orientPictureResult (null while it works); see turn-canvas.js for why it runs on its own:
//   window.__orientPictureResult = null; (0, eval)(await (await fetch("http://127.0.0.1:8765/regression/orient-picture.js", { cache: "no-store" })).text())
//
// Six wings of the PL database (right wings that lie upright) are put in the four poses of a straightened crop: upright, upside down, mirrored,
// mirrored and upside down. Each is read from a canvas (and, for some, from the image of its PNG) and turned to the right and to the left.
// The result must be, pixel for pixel, the wing upright (to the right) or its mirror image (to the left), and only a picture that is
// not as wanted may be turned at all. A flat picture and a small one must be left alone.
(() => {
  const run = async () => {
    const { orientCanvas, orientImage } = await import("/src/utils/orientPicture.ts");
    if (typeof orientCanvas !== "function" || typeof orientImage !== "function") throw new Error("orientPicture.ts has no orientCanvas / orientImage");
    const BASE = "http://127.0.0.1:8765";
    const WINGS = ["PL-0134-000875-R.dw.png", "PL-0212-LP-061-001268-L.dw.png", "PL-0057-000122-R.dw.png", "PL-0001-000420-L.dw.png", "PL-0062-000223-L.dw.png", "PL-0228-LP-077-100483-R.dw.png"];
    // [name, side, upside down, flip columns, flip rows] of the four poses made of the upright right wing
    const POSES = [["id", "right", false, false, false], ["rot180", "right", true, true, true], ["flipH", "left", false, true, false], ["flipV", "left", true, false, true]];
    // the turn to make for [pose][wanted]
    const EXPECTED = {
      id: { right: null, left: { mirror: true, rotate: false } },
      rot180: { right: { mirror: false, rotate: true }, left: { mirror: true, rotate: true } },
      flipH: { right: { mirror: true, rotate: false }, left: null },
      flipV: { right: { mirror: true, rotate: true }, left: { mirror: false, rotate: true } },
    };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const pixelsOf = (canvas) => canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
    const draw = (source, w, h, flipX, flipY) => {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.setTransform(flipX ? -1 : 1, 0, 0, flipY ? -1 : 1, flipX ? w : 0, flipY ? h : 0);
      ctx.drawImage(source, 0, 0);
      return c;
    };
    const differing = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) n += 1; return n; };

    const problems = [];
    let checked = 0;
    let firstBitmap = null;
    for (const [index, name] of WINGS.entries()) {
      const bitmap = await createImageBitmap(await (await fetch(`${BASE}/cropped/PL-wing-images/${name}`)).blob());
      if (index === 0) firstBitmap = bitmap;
      const { width: w, height: h } = bitmap;
      const upright = pixelsOf(draw(bitmap, w, h, false, false)); // the wing upright, to the right
      const mirrored = pixelsOf(draw(bitmap, w, h, true, false)); // to the left
      for (const [pose, side, upsideDown, flipX, flipY] of POSES) {
        const picture = draw(bitmap, w, h, flipX, flipY);
        // the image of the same picture, for the second function (only for two wings: every PNG takes a moment in a hidden pane)
        let image = null;
        if (index < 2) {
          const blob = await new Promise((resolve) => picture.toBlob(resolve, "image/png"));
          image = new Image();
          await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = URL.createObjectURL(blob); });
        }
        for (const wanted of ["right", "left"]) {
          const label = `${name} ${pose} -> ${wanted}`;
          const fromCanvas = orientCanvas(picture, wanted);
          checked += 1;
          if (!fromCanvas.reading || fromCanvas.reading.side !== side || fromCanvas.reading.upsideDown !== upsideDown || !fromCanvas.reading.sure) problems.push([label, "reading", fromCanvas.reading && { side: fromCanvas.reading.side, upsideDown: fromCanvas.reading.upsideDown, margin: fromCanvas.reading.margin }]);
          if (!same(fromCanvas.turn, EXPECTED[pose][wanted])) problems.push([label, "turn", fromCanvas.turn]);
          if ((fromCanvas.turn === null) !== (fromCanvas.canvas === picture)) problems.push([label, "a turned picture is a new canvas, an untouched one is the same", null]);
          const bad = differing(pixelsOf(fromCanvas.canvas), wanted === "right" ? upright : mirrored);
          if (bad) problems.push([label, `the result differs from the wing upright on the ${wanted} in ${bad} values`, null]);
          if (image) {
            const fromImage = orientImage(image, wanted);
            checked += 1;
            if (!same(fromImage.turn, EXPECTED[pose][wanted])) problems.push([label + " (image)", "turn", fromImage.turn]);
            if (fromImage.turn !== null) {
              const badImage = differing(pixelsOf(fromImage.canvas), wanted === "right" ? upright : mirrored);
              if (badImage) problems.push([label + " (image)", `the result differs in ${badImage} values`, null]);
            } else if (fromImage.canvas !== null) problems.push([label + " (image)", "no turn, but a canvas", null]);
          }
        }
      }
    }
    // a picture with more pixels than are read at full size (8 million) is read from a smaller copy, and is turned at its full size
    const big = document.createElement("canvas");
    big.width = 4600; big.height = 1900;
    big.getContext("2d").drawImage(firstBitmap, 0, 0, 4600, 1900);
    const bigUpright = pixelsOf(big);
    for (const [pose, side, upsideDown, flipX, flipY] of POSES) {
      const picture = draw(big, 4600, 1900, flipX, flipY);
      const result = orientCanvas(picture, "right");
      checked += 1;
      const label = `big ${pose} -> right`;
      if (!result.reading || result.reading.side !== side || result.reading.upsideDown !== upsideDown || !result.reading.sure) problems.push([label, "reading", result.reading && { side: result.reading.side, upsideDown: result.reading.upsideDown, margin: result.reading.margin }]);
      if (!same(result.turn, EXPECTED[pose].right)) problems.push([label, "turn", result.turn]);
      if (result.canvas.width !== 4600 || result.canvas.height !== 1900) problems.push([label, "size", `${result.canvas.width}x${result.canvas.height}`]);
      const bad = differing(pixelsOf(result.canvas), bigUpright);
      if (bad) problems.push([label, `the result differs from the wing upright in ${bad} values`, null]);
    }
    // pictures that cannot be read for sure are left alone
    const flat = document.createElement("canvas");
    flat.width = 600; flat.height = 250;
    flat.getContext("2d").fillStyle = "#808080";
    flat.getContext("2d").fillRect(0, 0, 600, 250);
    const flatResult = orientCanvas(flat, "right");
    if (flatResult.turn !== null || flatResult.canvas !== flat || !flatResult.reading || flatResult.reading.sure) problems.push(["flat picture", "must be left alone", flatResult.reading && flatResult.reading.margin]);
    const small = document.createElement("canvas");
    small.width = 200; small.height = 80;
    const smallResult = orientCanvas(small, "left");
    if (smallResult.turn !== null || smallResult.canvas !== small || smallResult.reading !== null) problems.push(["small picture", "must be left alone and not read", smallResult.reading]);
    return { checked, problems, ok: problems.length === 0 };
  };
  window.__orientPictureResult = null;
  run().then((r) => { window.__orientPictureResult = r; }, (e) => { window.__orientPictureResult = { error: String(e), ok: false }; });
  return "started";
})()
