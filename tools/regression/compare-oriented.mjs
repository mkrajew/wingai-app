// Compares a run of the new flow (the wings are turned from their pixels BEFORE the request) with the baseline of main (the wings are turned AFTER the
// answer of the backend):   node compare-oriented.mjs <baseline label> <new label>
//
// Both runs have the same scenario and the same switches, and the baseline was made with window.__REANALYZE: its second analysis is the backend's
// answer for the picture that the review ends with. What has to be true:
//  1. what the review shows is the same: names, banner, sizes of the views, texts of errors, the console and every picture (the same pixels);
//  2. what was sent to the backend are the pictures that the baseline's review ends with: the wings were already turned, and the same number was sent;
//  3. the landmarks of the review are the ones that the backend finds on the final picture, those of the baseline's second analysis (within 0.05 px);
//  4. the backend is told about wings on the wanted side only (the wings that it does not flag), and the console has no warning that it turned one.
// A photo whose request failed (it has no landmarks) is shown as it was sent. In the baseline that is the picture as it was, because it is turned only
// after a good answer; in the new flow it is the picture already turned like the others. For such a photo the picture shown has to be the one that was sent.
// A picture may differ by one colour level when the browser draws a canvas on the GPU or on the CPU: block means within 0.6 on average (3 at most).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "work");
const load = (label) => JSON.parse(readFileSync(join(dir, `collected-${label}.json`), "utf8"));
const [a, b] = [load(process.argv[2]), load(process.argv[3])];
const diffs = [];
const tally = { exact: 0, tolerant: 0 };
const eq = (what, x, y) => { if (JSON.stringify(x) !== JSON.stringify(y)) diffs.push({ what, a: x, b: y }); };
const near = (xs, ys, tol) => xs.length === ys.length && xs.every((x, i) => Math.abs(Number(x) - Number(ys[i])) <= tol);
const kindOf = (p, q) => {
  if (!p || !q) return p === q ? "exact" : null;
  if (p.w !== q.w || p.h !== q.h) return null;
  if (p.hash === q.hash) return "exact";
  let sum = 0, max = 0;
  for (let i = 0; i < p.sig.length; i += 1) { const d = Math.abs(p.sig[i] - q.sig[i]); sum += d; max = Math.max(max, d); }
  return sum / p.sig.length <= 0.6 && max <= 3 ? "tolerant" : null;
};

eq("scenario", a.scenario, b.scenario);
eq("orientation setting", a.orient, b.orient);
eq("names in the list", a.listNames, b.listNames);
eq("banner (flagged images)", a.banner, b.banner);
eq("console errors", [...a.console.errors].sort(), [...b.console.errors].sort());
eq("console warnings", [...a.console.warnings].sort(), [...b.console.warnings].sort());
if (b.console.warnings.some((w) => /turns a wing whose pose was read/.test(w))) diffs.push({ what: "the backend turned a wing that was read for sure", a: null, b: b.console.warnings });

// 1. what the review shows
const failedPhotos = [];
for (let i = 0; i < Math.max(a.images.length, b.images.length); i += 1) {
  const p = a.images[i], q = b.images[i];
  if (!p || !q) { diffs.push({ what: `image ${i} missing`, a: !!p, b: !!q }); continue; }
  for (const key of ["name", "view", "error", "hasTable"]) eq(`image ${i} (${p.name}) ${key}`, p[key], q[key]);
  if (p.error && p.circles.length === 0) {
    // the request failed: the picture shown is the picture that was sent
    failedPhotos.push(p.name);
    if (q.picture && !b.uploads.some((u) => u.name === q.name && kindOf(q.picture, u.pixels))) diffs.push({ what: `image ${i} (${p.name}) failed, and the picture shown is not the one that was sent`, a: null, b: q.picture.hash });
    continue;
  }
  const kind = kindOf(p.picture, q.picture);
  if (kind) tally[kind] += 1; else diffs.push({ what: `image ${i} (${p.name}) picture`, a: p.picture && { w: p.picture.w, h: p.picture.h, hash: p.picture.hash }, b: q.picture && { w: q.picture.w, h: q.picture.h, hash: q.picture.hash } });
}

// 2. what was sent: every picture is one of the final pictures of the baseline (each used once)
const finals = a.images.filter((im) => im.picture && im.circles.length === 19).map((im) => ({ name: im.name, picture: im.picture, used: false }));
if (a.uploads.length !== b.uploads.length) diffs.push({ what: "number of uploads", a: a.uploads.length, b: b.uploads.length });
let alreadyTurned = 0;
for (const u of b.uploads) {
  if (failedPhotos.includes(u.name)) continue; // judged above
  const j = finals.findIndex((f) => !f.used && kindOf(f.picture, u.pixels));
  if (j < 0) { diffs.push({ what: `upload ${u.name} (${u.x_size}x${u.y_size}) is not a final picture of the baseline`, a: null, b: u.pixels.hash }); continue; }
  finals[j].used = true;
  // it was sent turned when the baseline sent it as it was and turned it afterwards
  const baselineUpload = a.uploads.find((v) => v.name === u.name && v.pixels.hash === u.pixels.hash);
  if (!baselineUpload) alreadyTurned += 1;
}

// 3. the landmarks of the review are the answer of the backend for the final picture
let landmarkPictures = 0, worst = 0;
for (let i = 0; i < b.images.length; i += 1) {
  const q = b.images[i], r = a.reanalysis?.[i];
  if (!q || q.circles.length !== 19 || !r || r.skipped || r.error) continue;
  landmarkPictures += 1;
  const mine = q.circles.flat().map((v) => Number(v) - 0.5);
  worst = Math.max(worst, ...mine.map((v, k) => Math.abs(v - r.coords[k])));
  if (!near(mine, r.coords, 0.05)) diffs.push({ what: `image ${i} (${q.name}) landmarks are not those of the backend on the final picture`, a: r.coords.slice(0, 4), b: mine.slice(0, 4) });
}

// 4. the wings that the backend does not flag are on the wanted side
const wanted = a.orient;
if (wanted === "left" || wanted === "right") {
  for (const x of b.answers) if (x.status === 200 && !x.check && x.orientation !== wanted) diffs.push({ what: `the backend says ${x.orientation} for ${x.name}, wanted ${wanted}`, a: null, b: x.orientation });
}

if (failedPhotos.length) console.log(`photos whose request failed (shown as they were sent, not as in the baseline): ${failedPhotos.join(", ")}`);
console.log(`${process.argv[2]} (after the answer) vs ${process.argv[3]} (before the request): ${a.images.length} images, ${b.uploads.length} uploads of which ${alreadyTurned} were sent already turned; pictures exact ${tally.exact}, within raster tolerance ${tally.tolerant}; landmarks of ${landmarkPictures} pictures equal to the backend's on the final picture (worst difference ${worst.toFixed(4)} px)`);
console.log("timeline before:", JSON.stringify(a.timeline));
console.log("timeline after: ", JSON.stringify(b.timeline));
if (diffs.length === 0) console.log("AS EXPECTED (the same final pictures, sent already turned, with the backend's own landmarks)");
else { console.log(`${diffs.length} DIFFERENCES:`); for (const d of diffs) console.log(" -", d.what, "\n    A:", JSON.stringify(d.a)?.slice(0, 300), "\n    B:", JSON.stringify(d.b)?.slice(0, 300)); process.exitCode = 1; }
