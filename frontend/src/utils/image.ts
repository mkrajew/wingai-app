/**
 * Image loading helpers.
 *
 * Pure DOM helpers — no React. Extracted from App.tsx so canvas/image logic
 * lives in one place and can be reused.
 */

export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

export async function loadImageDimensions(src: string) {
  const img = await loadImage(src);
  return { width: img.naturalWidth, height: img.naturalHeight };
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Failed to export canvas")),
      mimeType,
      quality,
    );
  });
}

export type ImageTransform =
  | { type: "flip"; axis: "horizontal" | "vertical" }
  | { type: "rotate"; direction: "cw" | "ccw" };

/**
 * Loads an image, applies a flip or 90° rotation on a canvas, and returns the
 * re-encoded blob together with the output dimensions. Rotation swaps the
 * dimensions (W↔H); flips leave them unchanged.
 */
export async function renderTransformedImage(
  src: string,
  transform: ImageTransform,
  mimeType: string,
  quality?: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const srcImg = await loadImage(src);
  const canvas = document.createElement("canvas");
  const rotated = transform.type === "rotate";
  canvas.width = rotated ? srcImg.naturalHeight : srcImg.naturalWidth;
  canvas.height = rotated ? srcImg.naturalWidth : srcImg.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");

  if (transform.type === "flip") {
    if (transform.axis === "horizontal") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(0, canvas.height);
      ctx.scale(1, -1);
    }
  } else if (transform.direction === "cw") {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(srcImg, 0, 0);

  const blob = await canvasToBlob(canvas, mimeType, quality);
  return { blob, width: canvas.width, height: canvas.height };
}
