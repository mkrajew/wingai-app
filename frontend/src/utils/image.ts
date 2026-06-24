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
