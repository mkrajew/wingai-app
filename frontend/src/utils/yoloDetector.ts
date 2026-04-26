import * as ort from "onnxruntime-web";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import mjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";

ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
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
const INPUT_SIZE = 640;
const CONF_THRESHOLD = 0.25;
const IOU_THRESHOLD = 0.45;

// ─── Session singleton ────────────────────────────────────────────────────────

let _session: ort.InferenceSession | null = null;

async function getSession(): Promise<ort.InferenceSession> {
  if (_session) return _session;

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
  return _session;
}

// ─── Preprocessing ─────────────────────────────────────────────────────────────

function preprocessImage(img: HTMLImageElement): {
  tensor: ort.Tensor;
  scale: number;
  padX: number;
  padY: number;
} {
  const canvas = document.createElement("canvas");
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D context");

  const scale = Math.min(
    INPUT_SIZE / img.naturalWidth,
    INPUT_SIZE / img.naturalHeight,
  );
  const scaledW = Math.round(img.naturalWidth * scale);
  const scaledH = Math.round(img.naturalHeight * scale);
  const padX = Math.floor((INPUT_SIZE - scaledW) / 2);
  const padY = Math.floor((INPUT_SIZE - scaledH) / 2);

  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(img, padX, padY, scaledW, scaledH);

  const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const pixels = INPUT_SIZE * INPUT_SIZE;
  const float32 = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i++) {
    float32[i] = data[i * 4] / 255;
    float32[i + pixels] = data[i * 4 + 1] / 255;
    float32[i + 2 * pixels] = data[i * 4 + 2] / 255;
  }

  return {
    tensor: new ort.Tensor("float32", float32, [1, 3, INPUT_SIZE, INPUT_SIZE]),
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

  // --- Format detection ---
  // v8/v9 canonical  [1, 4+C, N]  dim1 < dim2, no objectness
  // v5/v7            [1, N, 5+C]  dim2 = 5+C,  with objectness
  // v8 transposed    [1, N, 4+C]  dim2 = 4+C,  no objectness
  // decoded-nms      [1, N, 6]    model has NMS baked in;
  //                               rows = [x1,y1,x2,y2,conf,cls_id] in model px space
  //                               KEY indicator: negative coordinate values appear
  const isV8Canonical = dim1 < dim2;

  // Scan a small slice for negative values — impossible in raw YOLO prob outputs
  // but common in decoded absolute-coordinate outputs (letterbox spill-over)
  let isDecodedNMS = false;
  if (!isV8Canonical) {
    const scanLen = Math.min(dim1 * dim2, 600);
    for (let k = 0; k < scanLen; k++) {
      if (data[k] < -1) { isDecodedNMS = true; break; }
    }
  }

  const isV8Transposed = !isV8Canonical && !isDecodedNMS && dim2 === 4 + numClasses;
  const isV5           = !isV8Canonical && !isDecodedNMS && dim2 === 5 + numClasses;

  console.log(
    "[YOLO] format:",
    isV8Canonical  ? "v8-canonical"  :
    isDecodedNMS   ? "decoded-nms"   :
    isV8Transposed ? "v8-transposed" :
    isV5           ? "v5"            : "unknown",
    `dim1=${dim1} dim2=${dim2} classes=${numClasses}`,
  );

  const numBoxes = isV8Canonical ? dim2 : dim1;
  const detections: Detection[] = [];

  if (isDecodedNMS) {
    // [1, N, 6] — model includes NMS; each row: [x1,y1,x2,y2,conf,cls_id]
    // Coordinates are in the letterboxed model input space (640×640).
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
  const sess = await getSession();

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Failed to load image for detection"));
    el.src = url;
  });

  const { tensor, scale, padX, padY } = preprocessImage(img);
  const feeds = { [sess.inputNames[0]]: tensor };
  const results = await sess.run(feeds);
  const output = results[sess.outputNames[0]];
  if (!output) throw new Error("No output tensor from model");

  const data = output.data as Float32Array;
  const maxVal = data.reduce((m, v) => (v > m ? v : m), -Infinity);
  const minVal = data.reduce((m, v) => (v < m ? v : m), Infinity);
  console.log(
    "[YOLO] output tensor:",
    output.name,
    "dims:", JSON.stringify(output.dims),
    "min:", minVal.toFixed(4),
    "max:", maxVal.toFixed(4),
    "dtype:", output.type,
  );

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
