// Compares two traces made by review-trace.js: node compare-trace.mjs <label A> <label B>
// (tools/regression/work/collected-trace-<label>.json). Exit code 0 when every step shows the same thing, 1 otherwise.
//
// The size of the points on the picture follows the measured size of the picture, and that changes by a fraction of a
// pixel from run to run when the pane of the browser is scaled (a border of 1 px is drawn as 0.8 px). Such a difference
// is reported as "layout noise", not as a difference; what a drag does depends on that size too, so a drag that lands
// elsewhere in a run with another size is reported with the sizes of both runs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const work = join(dirname(fileURLToPath(import.meta.url)), "work");
const load = (label) => JSON.parse(readFileSync(join(work, `collected-trace-${label}.json`), "utf8"));
const [a, b] = [load(process.argv[2]), load(process.argv[3])];

// what is computed from the measured scale of the picture: the radius and the lines of the points, their labels
const withoutScale = (html) => html
  .replace(/(<circle [^>]*?) r="[\d.]+"/g, '$1 r="R"')
  .replace(/ stroke-width="[\d.]+"/g, ' stroke-width="W"')
  .replace(/<line x1="[\d.]+" y1="[\d.]+" x2="[\d.]+" y2="[\d.]+"/g, "<line L")
  .replace(/(<text x="[\d.]+") y="[\d.]+" text-anchor="middle" font-size="[\d.]+"/g, '$1 y="Y" text-anchor="middle" font-size="F"');

// a few characters around the first place where two long strings differ
const around = (x, y) => {
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i += 1;
  const cut = (s) => JSON.stringify(s.slice(Math.max(0, i - 90), i + 130));
  return `at character ${i} of ${x.length}/${y.length}\n      A: ${cut(x)}\n      B: ${cut(y)}`;
};

let real = 0, noise = 0;
const fields = ["extra", "html", "inputs", "active", "listScroll", "historyState", "lang", "page", "dialogs"];
const n = Math.max(a.trace.length, b.trace.length);
for (let i = 0; i < n; i += 1) {
  const x = a.trace[i], y = b.trace[i];
  if (!x || !y) { real += 1; console.log(`step ${i}: only in ${x ? a.label : b.label}: ${(x || y).name}`); continue; }
  if (x.name !== y.name) { real += 1; console.log(`step ${i}: other step "${x.name}" / "${y.name}"`); continue; }
  const bad = fields.filter((f) => JSON.stringify(x[f]) !== JSON.stringify(y[f]));
  if (!bad.length) continue;
  const sameLayout = JSON.stringify(x.layout) === JSON.stringify(y.layout);
  const onlyScale = bad.length === 1 && bad[0] === "html" && withoutScale(x.html) === withoutScale(y.html);
  if (onlyScale && !sameLayout) { noise += 1; continue; }
  real += 1;
  console.log(`step ${i} "${x.name}": differs in ${bad.join(", ")}${sameLayout ? "" : `  (the picture was measured differently: A ${JSON.stringify(x.layout)} B ${JSON.stringify(y.layout)})`}`);
  for (const f of bad) {
    if (f === "html") console.log(`    html ${around(withoutScale(x.html), withoutScale(y.html))}`);
    else console.log(`    ${f}: A ${JSON.stringify(x[f])}  B ${JSON.stringify(y[f])}`);
  }
}
console.log(`${a.label}: ${a.trace.length} steps, ${a.errors.length} console errors | ${b.label}: ${b.trace.length} steps, ${b.errors.length} console errors`);
if (a.errors.length || b.errors.length) console.log("console errors:", JSON.stringify({ [a.label]: a.errors, [b.label]: b.errors }));
if (noise) console.log(`${noise} step(s) differ only in the size of the points (layout noise)`);
console.log(real === 0 ? (noise ? "SAME: no difference apart from layout noise" : "IDENTICAL: every step shows the same thing") : `${real} step(s) differ`);
process.exit(real === 0 ? 0 : 1);
