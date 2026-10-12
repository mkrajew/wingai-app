/**
 * Shrinking a plane of 8 bit values by averaging areas.
 *
 * It does what OpenCV's `cv2.resize(plane, size, interpolation=cv2.INTER_AREA)` does, in the same float32 arithmetic and in the same
 * order, so that the result is the same byte for byte. The templates that read the pose of a wing (see poseFromPixels.ts) were made
 * from pictures shrunk by OpenCV, and a picture that is shrunk the same way gives the same reading. tools/pose/make_golden.py makes
 * the vectors that the tests compare with.
 */

type Plane = Uint8Array | Uint8ClampedArray;

/** How the target pixels are made of the source pixels along one axis: target pixel `dx` takes `alpha` of the source pixels `si`. */
type Weights = {
  /** For every target pixel, where its entries start (and `start[size]` is the number of entries). */
  start: Int32Array;
  si: Int32Array;
  alpha: Float32Array;
};

const fround = Math.fround;

// OpenCV's computeResizeAreaTab. `scale` is the number of source pixels under one target pixel.
function areaWeights(sourceSize: number, targetSize: number, scale: number): Weights {
  const start = new Int32Array(targetSize + 1);
  const si: number[] = [];
  const alpha: number[] = [];
  for (let dx = 0; dx < targetSize; dx += 1) {
    start[dx] = si.length;
    const from = dx * scale;
    const to = from + scale;
    const cell = Math.min(scale, sourceSize - from);
    const sx2 = Math.min(Math.floor(to), sourceSize - 1);
    const sx1 = Math.min(Math.ceil(from), sx2);
    if (sx1 - from > 1e-3) {
      si.push(sx1 - 1);
      alpha.push(fround((sx1 - from) / cell));
    }
    for (let sx = sx1; sx < sx2; sx += 1) {
      si.push(sx);
      alpha.push(fround(1.0 / cell));
    }
    if (to - sx2 > 1e-3) {
      si.push(sx2);
      alpha.push(fround(Math.min(Math.min(to - sx2, 1.0), cell) / cell));
    }
  }
  start[targetSize] = si.length;
  return { start, si: Int32Array.from(si), alpha: Float32Array.from(alpha) };
}

// cvRound of a float that is not negative: to the nearest integer, a tie goes to the even one; then saturated to a byte.
function toByte(v: number): number {
  let r = Math.round(v);
  if (r - v === 0.5 && r % 2 === 1) r -= 1;
  return r > 255 ? 255 : r;
}

/**
 * The plane `source` (w x h) shrunk to outW x outH, or null when it is smaller than that in either direction (OpenCV would
 * enlarge it by interpolation, which is not what is wanted here). A plane of the target size is copied.
 */
export function shrinkArea(source: Plane, w: number, h: number, outW: number, outH: number): Uint8Array | null {
  if (w < outW || h < outH) return null;
  if (w === outW && h === outH) return Uint8Array.from(source);

  // OpenCV works out the scale from the ratio of the sizes, as a double
  const scaleX = 1 / (outW / w);
  const scaleY = 1 / (outH / h);
  const wholeX = Math.round(scaleX);
  const wholeY = Math.round(scaleY);
  if (Math.abs(scaleX - wholeX) < Number.EPSILON && Math.abs(scaleY - wholeY) < Number.EPSILON) {
    return shrinkWhole(source, w, outW, outH, wholeX, wholeY);
  }

  const xs = areaWeights(w, outW, scaleX);
  const ys = areaWeights(h, outH, scaleY);
  const out = new Uint8Array(outW * outH);
  const row = new Float32Array(outW);
  const sum = new Float32Array(outW);
  for (let dy = 0; dy < outH; dy += 1) {
    sum.fill(0);
    for (let j = ys.start[dy]; j < ys.start[dy + 1]; j += 1) {
      const base = ys.si[j] * w;
      const beta = ys.alpha[j];
      for (let dx = 0; dx < outW; dx += 1) {
        let acc = 0;
        for (let k = xs.start[dx]; k < xs.start[dx + 1]; k += 1) acc = fround(acc + fround(source[base + xs.si[k]] * xs.alpha[k]));
        row[dx] = acc;
      }
      for (let dx = 0; dx < outW; dx += 1) sum[dx] = fround(sum[dx] + fround(beta * row[dx]));
    }
    for (let dx = 0; dx < outW; dx += 1) out[dy * outW + dx] = toByte(sum[dx]);
  }
  return out;
}

// OpenCV's resizeAreaFast: the sizes are whole multiples of the target size, so every target pixel is the mean of a block.
function shrinkWhole(source: Plane, w: number, outW: number, outH: number, kx: number, ky: number): Uint8Array {
  const out = new Uint8Array(outW * outH);
  const scale = fround(1 / (kx * ky));
  for (let dy = 0; dy < outH; dy += 1) {
    for (let dx = 0; dx < outW; dx += 1) {
      let sum = 0;
      for (let j = 0; j < ky; j += 1) {
        const base = (dy * ky + j) * w + dx * kx;
        for (let i = 0; i < kx; i += 1) sum += source[base + i];
      }
      // OpenCV has a vectorised version of the 2 x 2 case that rounds a tie up
      out[dy * outW + dx] = kx === 2 && ky === 2 ? (sum + 2) >> 2 : toByte(fround(fround(sum) * scale));
    }
  }
  return out;
}
