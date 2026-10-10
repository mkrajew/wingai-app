/**
 * Filename helpers for the upload/review workflow.
 *
 * Pure functions — no React, no DOM. Extracted from App.tsx so they can be
 * reused and reasoned about in isolation.
 */

export const fileKey = (file: File) =>
  `${file.name}|${file.size}|${file.lastModified}`;

export const isJpegFile = (file: File) =>
  file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);

export const toPngFilename = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return "image.png";
  const base = trimmed.replace(/\.[^.]+$/, "");
  return `${base}.png`;
};

export const toDwPngFilename = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return "image.dw.png";
  if (/\.dw\.png$/i.test(trimmed)) return trimmed;
  const base = trimmed.replace(/\.[^.]+$/, "");
  return `${base}.dw.png`;
};

export const splitFilename = (name: string) => {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  if (lower.endsWith(".dw.png")) {
    return { base: trimmed.slice(0, -7), ext: trimmed.slice(-7) };
  }
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot > 0) {
    return { base: trimmed.slice(0, lastDot), ext: trimmed.slice(lastDot) };
  }
  return { base: trimmed, ext: "" };
};

export const ensureUniqueFilenameFromSet = (
  desiredName: string,
  used: Set<string>,
) => {
  const normalized = desiredName.toLowerCase();
  if (!used.has(normalized)) {
    used.add(normalized);
    return desiredName;
  }

  const { base, ext } = splitFilename(desiredName);
  const match = base.match(/^(.*)\((\d+)\)$/);
  let root = base;
  let counter = 2;
  if (match) {
    root = match[1];
    const parsed = Number(match[2]);
    if (Number.isFinite(parsed)) {
      counter = Math.max(2, parsed + 1);
    }
  }

  let candidate = `${root}(${counter})${ext}`;
  while (used.has(candidate.toLowerCase())) {
    counter += 1;
    candidate = `${root}(${counter})${ext}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
};

export const ensureUniqueFilename = (
  desiredName: string,
  currentIndex: number,
  files: { filename: string }[],
) => {
  const used = new Set(
    files
      .filter((_file, idx) => idx !== currentIndex)
      .map((file) => file.filename.toLowerCase()),
  );
  return ensureUniqueFilenameFromSet(desiredName, used);
};
