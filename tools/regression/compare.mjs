// Compares two snapshots made by run.js (tools/regression/work/collected-<label>.json): node compare.mjs <labelA> <labelB>
// Everything the user can see or the backend receives must be equal. Two things are allowed to differ a little,
// because the browser draws a canvas on the GPU or on the CPU and the results differ by one colour level:
//   - pictures: same size, and either the same pixels or block means within 0.6 on average (3 at most)
//   - landmarks and backend coordinates: within 0.05 px
// Timing is only printed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = join(dirname(fileURLToPath(import.meta.url)), "work");
const load = (label) => JSON.parse(readFileSync(join(dir, `collected-${label}.json`), "utf8"));
const [a, b] = [load(process.argv[2]), load(process.argv[3])];
const diffs = [];
const tally = { exactPictures: 0, tolerantPictures: 0 };
const eq = (what, x, y) => { if (JSON.stringify(x) !== JSON.stringify(y)) diffs.push({ what, a: x, b: y }); };

const picture = (p, q) => {
  if (!p || !q) return p === q ? "exact" : null;
  if (p.w !== q.w || p.h !== q.h) return null;
  if (p.hash === q.hash) return "exact";
  let sum = 0, max = 0;
  for (let i = 0; i < p.sig.length; i += 1) { const d = Math.abs(p.sig[i] - q.sig[i]); sum += d; max = Math.max(max, d); }
  return sum / p.sig.length <= 0.6 && max <= 3 ? "tolerant" : null;
};
const eqPicture = (what, p, q) => {
  const kind = picture(p, q);
  if (kind === "exact") tally.exactPictures += 1; else if (kind === "tolerant") tally.tolerantPictures += 1;
  else diffs.push({ what, a: p && { w: p.w, h: p.h, hash: p.hash }, b: q && { w: q.w, h: q.h, hash: q.hash } });
};
const near = (xs, ys, tol = 0.05) => xs.length === ys.length && xs.every((x, i) => Math.abs(Number(x) - Number(ys[i])) <= tol);

eq("scenario", a.scenario, b.scenario);
eq("orientation setting", a.orient, b.orient);
eq("model setting", a.model, b.model);
eq("files uploaded", a.files, b.files);
eq("names in the list", a.listNames, b.listNames);
eq("banner (flagged images)", a.banner, b.banner);

// what was sent to the backend: matched by name (and by picture when a name occurs twice)
const usedB = new Set();
for (const u of [...a.uploads].sort((p, q) => p.name.localeCompare(q.name))) {
  const j = b.uploads.findIndex((v, k) => !usedB.has(k) && v.name === u.name && v.x_size === u.x_size && v.y_size === u.y_size && v.model === u.model && picture(u.pixels, v.pixels));
  if (j < 0) { diffs.push({ what: `upload ${u.name} (${u.x_size}x${u.y_size}) has no counterpart`, a: { hash: u.pixels.hash }, b: b.uploads.filter((v) => v.name === u.name).map((v) => ({ size: `${v.x_size}x${v.y_size}`, hash: v.pixels.hash })) }); continue; }
  usedB.add(j);
  eqPicture(`upload ${u.name} pixels`, u.pixels, b.uploads[j].pixels);
}
if (a.uploads.length !== b.uploads.length) diffs.push({ what: "number of uploads", a: a.uploads.length, b: b.uploads.length });

// what the backend answered
const usedAns = new Set();
for (const x of [...a.answers].sort((p, q) => p.name.localeCompare(q.name))) {
  const j = b.answers.findIndex((y, k) => !usedAns.has(k) && y.name === x.name && y.status === x.status && y.orientation === x.orientation && y.check === x.check && (x.coords ? near(x.coords, y.coords) : true));
  if (j < 0) { diffs.push({ what: `answer for ${x.name}`, a: { status: x.status, orientation: x.orientation, check: x.check }, b: b.answers.filter((y) => y.name === x.name).map((y) => ({ status: y.status, orientation: y.orientation, check: y.check })) }); continue; }
  usedAns.add(j);
}
if (a.answers.length !== b.answers.length) diffs.push({ what: "number of answers", a: a.answers.length, b: b.answers.length });

// what the review shows
for (let i = 0; i < Math.max(a.images.length, b.images.length); i += 1) {
  const p = a.images[i], q = b.images[i];
  if (!p || !q) { diffs.push({ what: `image ${i} missing`, a: !!p, b: !!q }); continue; }
  for (const key of ["name", "view", "error", "hasTable"]) eq(`image ${i} (${p.name}) ${key}`, p[key], q[key]);
  eqPicture(`image ${i} (${p.name}) picture`, p.picture, q.picture);
  const flat = (c) => c.flat();
  if (!near(flat(p.circles), flat(q.circles))) diffs.push({ what: `image ${i} (${p.name}) landmarks`, a: flat(p.circles).slice(0, 6), b: flat(q.circles).slice(0, 6) });
}
eq("console errors", [...a.console.errors].sort(), [...b.console.errors].sort());
eq("console warnings", [...a.console.warnings].sort(), [...b.console.warnings].sort());

console.log(`${process.argv[2]} vs ${process.argv[3]}: ${a.images.length} images, ${a.uploads.length} uploads, pictures exact ${tally.exactPictures}, within raster tolerance ${tally.tolerantPictures}`);
console.log("timeline A:", JSON.stringify(a.timeline));
console.log("timeline B:", JSON.stringify(b.timeline));
if (diffs.length === 0) console.log("EQUAL (names, uploads, answers, pictures, landmarks, errors, console)");
else { console.log(`${diffs.length} DIFFERENCES:`); for (const d of diffs) console.log(" -", d.what, "\n    A:", JSON.stringify(d.a)?.slice(0, 300), "\n    B:", JSON.stringify(d.b)?.slice(0, 300)); process.exitCode = 1; }
