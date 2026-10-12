// Does the TypeScript of the app (frontend/src/utils/poseFromPixels.ts) read the crops saved from the app the way the Python reference does?
//
//   python tools/pose/parity_table.py                 (once: what the reference says about every picture, work/parity/table.json)
//   node tools/pose/check_ts_parity.mjs [work folder]   (Node 22.18 or newer: it runs the TypeScript as it is)
//
// Every PNG is decoded here (no library: zlib and the five PNG filters), and the TypeScript makes of it, step by step, the working gray picture, the mask
// of the photo, the descriptor, the correlations and the pose. All of them are compared with the reference: the first three must be equal byte for byte.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { shrinkArea } from "../../frontend/src/utils/areaResize.ts";
import { POSE_HEIGHT, POSE_SURE_MARGIN, POSE_WIDTH, descriptorOf, grayOf, readingFromScores, scoresOf, validMask } from "../../frontend/src/utils/poseFromPixels.ts";

const work = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "work");
const table = JSON.parse(readFileSync(join(work, "parity", "table.json"), "utf8"));
const POSE_OF = (reading) => `${reading.side === "right" ? (reading.upsideDown ? "rot180" : "id") : reading.upsideDown ? "flipV" : "flipH"}`;
const sha = (bytes) => createHash("sha256").update(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest("hex");

/** An 8 bit PNG without interlacing (gray, RGB, RGBA or gray with alpha) as RGBA bytes. */
function decodePng(file) {
  const png = readFileSync(file);
  let p = 8, w = 0, h = 0, depth = 0, type = 0;
  const idat = [];
  while (p < png.length) {
    const len = png.readUInt32BE(p), kind = png.toString("latin1", p + 4, p + 8), data = png.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; if (data[12] !== 0) throw new Error("interlaced PNG"); }
    if (kind === "IDAT") idat.push(data);
    p += 12 + len;
  }
  if (depth !== 8 || ![0, 2, 4, 6].includes(type)) throw new Error(`unsupported PNG (depth ${depth}, type ${type})`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  const stride = w * channels, raw = inflateSync(Buffer.concat(idat)), px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y += 1) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), at = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? px[at + x - channels] : 0, b = y > 0 ? px[at - stride + x] : 0, c = x >= channels && y > 0 ? px[at - stride + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a; else if (filter === 2) v += b; else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[at + x] = v & 255;
    }
  }
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    const r = px[i * channels], g = channels >= 3 ? px[i * channels + 1] : r, b = channels >= 3 ? px[i * channels + 2] : r;
    rgba.set([r, g, b, channels === 4 ? px[i * channels + 3] : channels === 2 ? px[i * channels + 1] : 255], i * 4);
  }
  return { w, h, rgba };
}

const different = { gray: 0, mask: 0, descriptor: 0, scores: 0, pose: 0, margin: 0 };
let worstScore = 0, worstMargin = 0, unreadable = 0;
const stats = {};
for (const row of table) {
  const { w, h, rgba } = decodePng(join(work, row.png));
  const gray = grayOf(rgba, w, h);
  const small = shrinkArea(gray, w, h, POSE_WIDTH, POSE_HEIGHT);
  if (small === null) { unreadable += 1; continue; }
  const valid = validMask(gray, w, h);
  const descriptor = descriptorOf(small, valid);
  const scores = scoresOf(descriptor);
  const reading = readingFromScores(scores);
  if (sha(small) !== row.gray_sha256) different.gray += 1;
  if ((valid === null) !== row.valid_all || sha(valid ?? new Uint8Array(POSE_WIDTH * POSE_HEIGHT).fill(1)) !== row.valid_sha256) different.mask += 1;
  if (sha(descriptor) !== row.descriptor_sha256) different.descriptor += 1;
  const ds = Math.max(...scores.map((s, i) => Math.abs(s - row.scores[i])));
  worstScore = Math.max(worstScore, ds);
  if (ds > 1e-5) different.scores += 1;
  if (POSE_OF(reading) !== row.best) different.pose += 1;
  worstMargin = Math.max(worstMargin, Math.abs(reading.margin - row.margin));
  if (Math.abs(reading.margin - row.margin) > 1e-5) different.margin += 1;

  const s = (stats[row.set] ??= { all: 0, good: 0, errors: 0, flaggedGood: 0, flaggedErrors: 0, sure: 0, sureErrors: 0, minMargin: Infinity, ok: {} });
  s.all += 1;
  if (row.good) {
    s.good += 1;
    const wrong = row.truth !== null && POSE_OF(reading) !== row.truth;
    if (wrong) s.errors += 1;
    if (reading.sure) { s.sure += 1; if (wrong) s.sureErrors += 1; }
    if (!wrong) s.minMargin = Math.min(s.minMargin, reading.margin);
    const per = (s.ok[row.truth] ??= { n: 0, errors: 0 });
    per.n += 1; if (wrong) per.errors += 1;
  }
}
console.log(`pictures: ${table.length}${unreadable ? ` (${unreadable} too small to read)` : ""}`);
console.log("TypeScript differs from the reference in (count of pictures):", JSON.stringify(different), `| worst score difference ${worstScore.toExponential(2)}, worst margin difference ${worstMargin.toExponential(2)}`);
for (const [name, s] of Object.entries(stats)) {
  console.log(`set ${name}: ${s.good} good crops, ${s.errors} wrong poses, ${s.sure}/${s.good} sure (margin >= ${POSE_SURE_MARGIN}) of which ${s.sureErrors} wrong, smallest margin of a right reading ${s.minMargin.toFixed(3)}; per pose: ${Object.entries(s.ok).map(([k, v]) => `${k} ${v.errors}/${v.n}`).join(", ")}`);
}
const bad = Object.values(different).some((n) => n > 0) || Object.values(stats).some((s) => s.errors > 0);
process.exitCode = bad ? 1 : 0;
console.log(bad ? "NOT EQUAL / WITH ERRORS" : "EQUAL TO THE REFERENCE, no wrong poses");
