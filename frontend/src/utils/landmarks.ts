// Landmark coordinates are pixel indices, as in the training data: the landmark (c, r) is the centre of
// the pixel in column c, row r. The review draws in an SVG with one user unit per image pixel, where that
// pixel spans [c, c + 1) x [r, r + 1), so its centre is at (c + 0.5, r + 0.5).
// Exports round to the nearest pixel index.

const PIXEL_CENTER = 0.5;

/** Landmark coordinate -> SVG user unit (where to draw it). */
export const toSvg = (index: number) => index + PIXEL_CENTER;

/** SVG user unit (e.g. the pointer) -> landmark coordinate. */
export const fromSvg = (svg: number) => svg - PIXEL_CENTER;

/** Pixel indices run from 0 to size - 1. */
export const clampToImage = (index: number, size: number) =>
  Math.min(size - 1, Math.max(0, index));

/** IdentiFly metadata, "landmarks:x1 y1 x2 y2 ...;", counted from the top-left corner. */
export function buildLandmarksMetadata(vector: number[]) {
  const values: number[] = [];
  for (let i = 0; i < vector.length; i += 2) {
    const x = vector[i];
    const y = vector[i + 1];
    values.push(
      Number.isFinite(x) ? Math.round(x) : 0,
      Number.isFinite(y) ? Math.round(y) : 0,
    );
  }
  return `landmarks:${values.join(" ")};`;
}

/**
 * The 19 landmarks of one CSV row (x1, y1, x2, y2, ...), laid out like the training CSVs: counted from
 * the bottom-left corner, so the row from the bottom is height - 1 - row from the top. The row is
 * rounded first, exactly as in the metadata, so both exports always name the same pixel (also for a
 * coordinate exactly between two pixels). Without a known height y is left as it is.
 */
export function csvCoordinates(vector: number[], height: number | null) {
  const values: string[] = [];
  for (let i = 0; i < 19; i += 1) {
    const x = vector[i * 2];
    const y = vector[i * 2 + 1];
    values.push(Number.isFinite(x) ? Math.round(x).toString() : "");
    if (!Number.isFinite(y)) {
      values.push("");
      continue;
    }
    const row = Math.round(y);
    values.push((height !== null && height > 0 ? height - 1 - row : row).toString());
  }
  return values;
}
