// Pictures made by integer formulas, and the golden vectors of tools/pose/make_golden.py. The formulas are the same as in that
// script, so a picture made here is, pixel for pixel, the picture that the Python reference was given.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export type PictureSpec = {
  w: number;
  h: number;
  /** The kinds of the red, green and blue channel. */
  channels: [ChannelKind, ChannelKind, ChannelKind];
  /** Parts of the picture that are black. */
  shapes: Shape[];
};
export type ChannelKind = "formula" | "blocks" | "noise";
export type Shape =
  | { kind: "tri"; corner: "tl" | "tr" | "bl" | "br"; percent: number }
  | { kind: "disc"; cx: number; cy: number; r: number };

/** A stateless 32 bit hash of a pixel position (the finaliser of murmur3). */
function hash32(x: number, y: number, seed: number): number {
  let h = ((x * 73856093) ^ (y * 19349663) ^ Math.imul(seed, 83492791)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 3266489917) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function channelValue(kind: ChannelKind, x: number, y: number, seed: number): number {
  switch (kind) {
    case "formula":
      return (x * 7 + y * 13 + ((x * y) >> 5)) & 255;
    case "blocks": {
      const bx = Math.floor(x / 5);
      const by = Math.floor(y / 7);
      return (((bx * 37 + by * 91) ^ (bx * by)) + seed) & 255;
    }
    case "noise":
      return hash32(x, y, seed) & 255;
  }
}

/** One plane of a picture (w * h values 0 to 255). */
export function plane(kind: ChannelKind, w: number, h: number, seed = 0): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) out[y * w + x] = channelValue(kind, x, y, seed);
  return out;
}

function isBlack(shapes: Shape[], x: number, y: number, w: number, h: number): boolean {
  for (const s of shapes) {
    if (s.kind === "tri") {
      const cx = s.corner === "tl" || s.corner === "bl" ? x : w - 1 - x;
      const cy = s.corner === "tl" || s.corner === "tr" ? y : h - 1 - y;
      if (cx * h + cy * w < Math.floor((s.percent * w * h) / 100)) return true;
    } else if ((x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r ** 2) return true;
  }
  return false;
}

/** The picture as RGBA bytes, like the data of an ImageData. */
export function pictureRgba(spec: PictureSpec): Uint8ClampedArray {
  const { w, h } = spec;
  const planes = spec.channels.map((kind, i) => plane(kind, w, h, i + 1));
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const black = spec.shapes.length > 0 && isBlack(spec.shapes, x, y, w, h);
      rgba[i * 4] = black ? 0 : planes[0][i];
      rgba[i * 4 + 1] = black ? 0 : planes[1][i];
      rgba[i * 4 + 2] = black ? 0 : planes[2][i];
      rgba[i * 4 + 3] = 255;
    }
  }
  return rgba;
}

export function sha256(bytes: Uint8Array | Float32Array): string {
  return createHash("sha256").update(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest("hex");
}

export function float32FromBase64(b64: string): Float32Array {
  const bytes = Buffer.from(b64, "base64");
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

// ------------------------------------------------------------------------------------------------------ golden vectors
export type Golden = {
  hog: { cells: [number, number]; bins: number };
  poses: string[];
  work: [number, number];
  templates_sha256: string;
  area: Array<{ kind: ChannelKind; seed: number; w: number; h: number; threshold?: number; sha256: string }>;
  bins: Array<[number, number, number]>;
  pipeline: Array<{
    spec: PictureSpec;
    luma_sha256: string;
    gray_sha256: string;
    valid_all: boolean;
    valid_cells: number;
    valid_sha256: string;
    descriptor_b64: string;
    scores: number[];
    best: number;
    margin: number;
  }>;
};

export function loadGolden(): Golden {
  return JSON.parse(readFileSync(new URL("./fixtures/pose-golden.json", import.meta.url), "utf8")) as Golden;
}
