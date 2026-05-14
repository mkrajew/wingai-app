import * as ort from "onnxruntime-web/wasm";

// Serve WASM/MJS files from the root so their filenames stay unhashed.
// The ortAssetsPlugin in vite.config.ts copies them there during build
// and serves them with correct MIME types in dev.
ort.env.wasm.wasmPaths = "/";
ort.env.wasm.numThreads = 1;

// ─── Public types ─────────────────────────────────────────────────────────────

export type Detection = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
  classId: number;
  className: string;
};

// ─── Configuration ─────────────────────────────────────────────────────────────
// Update CLASS_NAMES to match your model's classes.

export const CLASS_NAMES: string[] = ["object"];

const CACHE_NAME = "wingai-models-v1";
const MODEL_URL = "/models/detector.onnx";

// Defaults chosen to match Ultralytics inference (`YOLO(...).predict(img)`):
// - imgsz 640 (used only for dynamic-input ONNX; static-input models use their
//   declared HxW from the model graph).
// - stride 32 (max stride for YOLOv5/v8/v9/v11).
// - pad color 114 (Ultralytics LetterBox default).
// - conf 0.25, iou 0.7 (Ultralytics predict() defaults).
const DEFAULT_IMGSZ = 640;
const STRIDE = 32;
const PAD_COLOR = 114;
const CONF_THRESHOLD = 0.25;
const IOU_THRESHOLD = 0.7;

// ─── Session singleton ────────────────────────────────────────────────────────

type InputShape =
  | { kind: "static"; w: number; h: number }
  | { kind: "dynamic" };

let _session: ort.InferenceSession | null = null;
let _inputShape: InputShape | null = null;

function detectInputShape(session: ort.InferenceSession): InputShape {
  const meta = session.inputMetadata[0];
  if (!meta || !meta.isTensor) {
    throw new Error("Model has no tensor input");
  }
  const shape = meta.shape;
  if (shape.length !== 4) {
    throw new Error(`Expected NCHW input (rank 4), got rank ${shape.length}`);
  }
  const h = shape[2];
  const w = shape[3];
  // Symbolic dims are strings; numeric dims are fixed sizes.
  if (typeof h === "number" && typeof w === "number" && h > 0 && w > 0) {
    return { kind: "static", w, h };
  }
  return { kind: "dynamic" };
}

async function getSession(): Promise<{
  session: ort.InferenceSession;
  inputShape: InputShape;
}> {
  if (_session && _inputShape) {
    return { session: _session, inputShape: _inputShape };
  }

  if (!("caches" in window)) throw new Error("Cache API not available.");

  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(MODEL_URL);
  if (!cached) {
    throw new Error(
      "Model not loaded. Use the 'Detection model' panel to load it first.",
    );
  }

  const buffer = await cached.arrayBuffer();
  _session = await ort.InferenceSession.create(buffer, {
    executionProviders: ["wasm"],
  });
  _inputShape = detectInputShape(_session);
  return { session: _session, inputShape: _inputShape };
}

// ─── Preprocessing ─────────────────────────────────────────────────────────────
//
// Mirrors ultralytics.data.augment.LetterBox with the defaults used by
// `predict()`: center=True, scaleup=True, value=(114,114,114), interpolation
// bilinear. When the ONNX accepts dynamic spatial dims, we also mirror
// `auto=True`, padding only to the next multiple of `STRIDE` — this is what
// `YOLO('model.pt').predict(img)` does on a .pt model. Static-export ONNX
// models force a fixed input size, so we fall back to square (or whatever
// HxW the model declares).

function computeLetterbox(
  origW: number,
  origH: number,
  inputShape: InputShape,
) {
  const newW = inputShape.kind === "static" ? inputShape.w : DEFAULT_IMGSZ;
  const newH = inputShape.kind === "static" ? inputShape.h : DEFAULT_IMGSZ;

  const r = Math.min(newW / origW, newH / origH);
  const scaledW = Math.round(origW * r);
  const scaledH = Math.round(origH * r);

  let dw = newW - scaledW;
  let dh = newH - scaledH;
  if (inputShape.kind === "dynamic") {
    // auto=True: strip whole stride multiples, keep only the residual padding.
    dw = ((dw % STRIDE) + STRIDE) % STRIDE;
    dh = ((dh % STRIDE) + STRIDE) % STRIDE;
  }

  const targetW = scaledW + dw;
  const targetH = scaledH + dh;

  // Ultralytics' `±0.1` split keeps total padding correct when dw/dh is odd.
  // We only need the left/top amount; right/bottom is implicit in the canvas size.
  const padX = Math.round(dw / 2 - 0.1);
  const padY = Math.round(dh / 2 - 0.1);

  return { targetW, targetH, scaledW, scaledH, scale: r, padX, padY };
}

// Bilinear resize that matches cv2.resize(..., interpolation=cv2.INTER_LINEAR).
// OpenCV samples source pixels using center-aligned coordinates:
//   src_x = (dst_x + 0.5) * (src_w / dst_w) - 0.5
//   src_y = (dst_y + 0.5) * (src_h / dst_h) - 0.5
// with clamping to the source bounds at the edges. The default browser canvas
// scaler does not follow this convention and can shift the result by ~1 pixel
// at the model's output level.
function resizeBilinearRGBA(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  const dst = new Float32Array(dstW * dstH * 3);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    let sy = (dy + 0.5) * scaleY - 0.5;
    let y0 = Math.floor(sy);
    let wy: number;
    if (y0 < 0) {
      y0 = 0;
      wy = 0;
    } else if (y0 >= srcH - 1) {
      y0 = srcH - 1;
      wy = 0;
    } else {
      wy = sy - y0;
    }
    const y1 = Math.min(srcH - 1, y0 + 1);
    const row0 = y0 * srcW;
    const row1 = y1 * srcW;

    for (let dx = 0; dx < dstW; dx++) {
      let sx = (dx + 0.5) * scaleX - 0.5;
      let x0 = Math.floor(sx);
      let wx: number;
      if (x0 < 0) {
        x0 = 0;
        wx = 0;
      } else if (x0 >= srcW - 1) {
        x0 = srcW - 1;
        wx = 0;
      } else {
        wx = sx - x0;
      }
      const x1 = Math.min(srcW - 1, x0 + 1);

      const w00 = (1 - wx) * (1 - wy);
      const w10 = wx * (1 - wy);
      const w01 = (1 - wx) * wy;
      const w11 = wx * wy;

      const i00 = (row0 + x0) * 4;
      const i10 = (row0 + x1) * 4;
      const i01 = (row1 + x0) * 4;
      const i11 = (row1 + x1) * 4;

      // Round to uint8 to match cv2.resize's intermediate output. Ultralytics
      // does the float32 / 255 conversion only after this uint8 step, so we
      // mirror the same quantization here.
      const dstIdx = (dy * dstW + dx) * 3;
      dst[dstIdx] = Math.round(
        src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11,
      );
      dst[dstIdx + 1] = Math.round(
        src[i00 + 1] * w00 +
          src[i10 + 1] * w10 +
          src[i01 + 1] * w01 +
          src[i11 + 1] * w11,
      );
      dst[dstIdx + 2] = Math.round(
        src[i00 + 2] * w00 +
          src[i10 + 2] * w10 +
          src[i01 + 2] * w01 +
          src[i11 + 2] * w11,
      );
    }
  }
  return dst;
}

function preprocessImage(
  img: HTMLImageElement,
  inputShape: InputShape,
): { tensor: ort.Tensor; scale: number; padX: number; padY: number } {
  const { targetW, targetH, scaledW, scaledH, scale, padX, padY } =
    computeLetterbox(img.naturalWidth, img.naturalHeight, inputShape);

  // Read original-resolution pixels (no canvas scaling).
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = img.naturalWidth;
  srcCanvas.height = img.naturalHeight;
  const srcCtx = srcCanvas.getContext("2d");
  if (!srcCtx) throw new Error("Could not get 2D context");
  srcCtx.drawImage(img, 0, 0);
  const { data: srcData } = srcCtx.getImageData(
    0,
    0,
    img.naturalWidth,
    img.naturalHeight,
  );

  // cv2.INTER_LINEAR-style resize, then build NCHW float32 with letterbox padding.
  const resized = resizeBilinearRGBA(
    srcData,
    img.naturalWidth,
    img.naturalHeight,
    scaledW,
    scaledH,
  );

  const pixels = targetW * targetH;
  const float32 = new Float32Array(3 * pixels);
  const padNorm = PAD_COLOR / 255;
  float32.fill(padNorm);

  const inv255 = 1 / 255;
  for (let y = 0; y < scaledH; y++) {
    const dstRow = (y + padY) * targetW + padX;
    const srcRow = y * scaledW;
    for (let x = 0; x < scaledW; x++) {
      const s = (srcRow + x) * 3;
      const d = dstRow + x;
      float32[d] = resized[s] * inv255;
      float32[d + pixels] = resized[s + 1] * inv255;
      float32[d + 2 * pixels] = resized[s + 2] * inv255;
    }
  }

  return {
    tensor: new ort.Tensor("float32", float32, [1, 3, targetH, targetW]),
    scale,
    padX,
    padY,
  };
}

// ─── Postprocessing ────────────────────────────────────────────────────────────

function makeDetection(
  cx: number,
  cy: number,
  bw: number,
  bh: number,
  confidence: number,
  classId: number,
  classNames: string[],
  origW: number,
  origH: number,
  scale: number,
  padX: number,
  padY: number,
): Detection {
  const x1 = Math.max(0, Math.min(origW, (cx - bw / 2 - padX) / scale));
  const y1 = Math.max(0, Math.min(origH, (cy - bh / 2 - padY) / scale));
  const x2 = Math.max(0, Math.min(origW, (cx + bw / 2 - padX) / scale));
  const y2 = Math.max(0, Math.min(origH, (cy + bh / 2 - padY) / scale));
  return {
    x1,
    y1,
    x2,
    y2,
    confidence,
    classId,
    className: classNames[classId] ?? `class_${classId}`,
  };
}

function decodeBoxes(
  output: ort.Tensor,
  origW: number,
  origH: number,
  scale: number,
  padX: number,
  padY: number,
  classNames: string[],
): Detection[] {
  const data = output.data as Float32Array;
  const [, dim1, dim2] = output.dims as [number, number, number];
  const numClasses = classNames.length;

  const maxVal = data.reduce((m, v) => (v > m ? v : m), -Infinity);

  // --- Format detection ---
  // v8/v9 canonical  [1, 4+C, N]  dim1 < dim2, no objectness
  // v5/v7            [1, N, 5+C]  dim2 = 5+C,  with objectness
  // v8 transposed    [1, N, 4+C]  dim2 = 4+C,  no objectness
  // decoded-nms      [1, N, 6]    model has NMS baked in;
  //                               rows = [x1,y1,x2,y2,conf,cls_id] in absolute pixel coords
  //                               KEY indicator: maxVal >> 1 (pixel coords, not probabilities)
  const isV8Canonical = dim1 < dim2;

  // decoded-nms: dim2 must be 6 and max value is in pixel range (>2), not a probability.
  // This is robust even when all boxes are inside the padding-free region (no negatives).
  const isDecodedNMS = !isV8Canonical && dim2 === 6 && numClasses === 1 && maxVal > 2;

  const isV8Transposed = !isV8Canonical && !isDecodedNMS && dim2 === 4 + numClasses;
  const isV5           = !isV8Canonical && !isDecodedNMS && dim2 === 5 + numClasses;

  const numBoxes = isV8Canonical ? dim2 : dim1;
  const detections: Detection[] = [];

  if (isDecodedNMS) {
    // [1, N, 6] — model includes NMS; each row: [x1,y1,x2,y2,conf,cls_id]
    // Coordinates are in the letterboxed model input space.
    // Unused slots are zero-padded.
    for (let i = 0; i < numBoxes; i++) {
      const base = i * dim2;
      const conf = data[base + 4];
      if (conf < CONF_THRESHOLD) continue;

      const x1m = data[base];
      const y1m = data[base + 1];
      const x2m = data[base + 2];
      const y2m = data[base + 3];
      const classId = Math.round(Math.max(0, data[base + 5]));

      // Undo letterbox: map from model coords → original image coords
      const x1 = Math.max(0, Math.min(origW, (x1m - padX) / scale));
      const y1 = Math.max(0, Math.min(origH, (y1m - padY) / scale));
      const x2 = Math.max(0, Math.min(origW, (x2m - padX) / scale));
      const y2 = Math.max(0, Math.min(origH, (y2m - padY) / scale));

      if (x2 <= x1 || y2 <= y1) continue;

      detections.push({
        x1, y1, x2, y2,
        confidence: conf,
        classId,
        className: classNames[classId] ?? `class_${classId}`,
      });
    }
    // NMS already applied by model — skip additional NMS
    return detections;
  }

  for (let i = 0; i < numBoxes; i++) {
    if (isV8Canonical) {
      const cx = data[0 * numBoxes + i];
      const cy = data[1 * numBoxes + i];
      const bw = data[2 * numBoxes + i];
      const bh = data[3 * numBoxes + i];
      let maxScore = 0;
      let classId = 0;
      for (let c = 0; c < numClasses; c++) {
        const s = data[(4 + c) * numBoxes + i];
        if (s > maxScore) { maxScore = s; classId = c; }
      }
      if (maxScore < CONF_THRESHOLD) continue;
      detections.push(
        makeDetection(cx, cy, bw, bh, maxScore, classId, classNames, origW, origH, scale, padX, padY),
      );
    } else if (isV8Transposed) {
      const base = i * (4 + numClasses);
      const cx = data[base];
      const cy = data[base + 1];
      const bw = data[base + 2];
      const bh = data[base + 3];
      let maxScore = 0;
      let classId = 0;
      for (let c = 0; c < numClasses; c++) {
        const s = data[base + 4 + c];
        if (s > maxScore) { maxScore = s; classId = c; }
      }
      if (maxScore < CONF_THRESHOLD) continue;
      detections.push(
        makeDetection(cx, cy, bw, bh, maxScore, classId, classNames, origW, origH, scale, padX, padY),
      );
    } else if (isV5) {
      const base = i * (5 + numClasses);
      const cx = data[base];
      const cy = data[base + 1];
      const bw = data[base + 2];
      const bh = data[base + 3];
      const obj = data[base + 4];
      let maxScore = 0;
      let classId = 0;
      for (let c = 0; c < numClasses; c++) {
        const s = obj * data[base + 5 + c];
        if (s > maxScore) { maxScore = s; classId = c; }
      }
      if (maxScore < CONF_THRESHOLD) continue;
      detections.push(
        makeDetection(cx, cy, bw, bh, maxScore, classId, classNames, origW, origH, scale, padX, padY),
      );
    }
  }

  return nms(detections);
}

// ─── NMS ───────────────────────────────────────────────────────────────────────

function iou(a: Detection, b: Detection): number {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (areaA + areaB - inter);
}

function nms(dets: Detection[]): Detection[] {
  const sorted = [...dets].sort((a, b) => b.confidence - a.confidence);
  const kept: Detection[] = [];
  const suppressed = new Set<number>();
  for (let i = 0; i < sorted.length; i++) {
    if (suppressed.has(i)) continue;
    kept.push(sorted[i]);
    for (let j = i + 1; j < sorted.length; j++) {
      if (iou(sorted[i], sorted[j]) > IOU_THRESHOLD) suppressed.add(j);
    }
  }
  return kept;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function detectFromUrl(
  url: string,
  classNames = CLASS_NAMES,
): Promise<Detection[]> {
  const { session, inputShape } = await getSession();

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Failed to load image for detection"));
    el.src = url;
  });

  const { tensor, scale, padX, padY } = preprocessImage(img, inputShape);
  const feeds = { [session.inputNames[0]]: tensor };
  const results = await session.run(feeds);
  const output = results[session.outputNames[0]];
  if (!output) throw new Error("No output tensor from model");

  return decodeBoxes(
    output,
    img.naturalWidth,
    img.naturalHeight,
    scale,
    padX,
    padY,
    classNames,
  );
}
