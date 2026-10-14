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

/**
 * The name that a photo gets when `typed` is entered in its name field, before it is made different from the names of
 * the other photos (`null` when nothing is typed). The photo keeps the extension it has: `.dw.png` after Process, else
 * the last one, which comes back at the end of the name whatever ending is typed.
 */
export const renamedFilename = (
  typed: string,
  currentName: string,
): string | null => {
  const trimmed = typed.trim();
  if (!trimmed) return null;

  const hasDwPng = /\.dw\.png$/i.test(currentName);
  const lastDot = currentName.lastIndexOf(".");
  const ext = hasDwPng ? ".dw.png" : lastDot > 0 ? currentName.slice(lastDot) : "";

  // The extension is in the typed text, but not at its end: text was typed after the whole name, so all of it is the
  // name. Without this, that text would be taken for another extension and thrown away.
  const lower = trimmed.toLowerCase();
  const typedAfterExt =
    ext !== "" && lower.includes(ext.toLowerCase()) && !lower.endsWith(ext.toLowerCase());

  let base = trimmed;
  if (ext !== "" && !typedAfterExt) {
    if (hasDwPng) base = base.replace(/\.dw\.png$/i, "");
    base = base.replace(/\.[^.]+$/, "");
  }
  return `${base}${ext}`;
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
