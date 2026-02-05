import { useEffect, useState } from "react";
import UploadImages from "./components/UploadImages";
import ReviewImages from "./components/ReviewImages";

export default App;

export type ImageFile = {
  filename: string;
  file: File;
  previewUrl: string;
  status: "new" | "uploading" | "edit" | "done" | "error";
  vector?: number[];
  check?: boolean;
  width?: number;
  height?: number;
  error?: string;
};

function App() {
  const [imageFiles, setImageFiles] = useState<ImageFile[]>([]);
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [reviewIndex, setReviewIndex] = useState(0);
  const [processing, setProcessing] = useState({
    inProgress: false,
    completed: 0,
    total: 0,
  });

  const fileKey = (file: File) =>
    `${file.name}|${file.size}|${file.lastModified}`;

  const createVector = (width: number, height: number) =>
    Array.from({ length: 38 }, (_, index) => {
      const isX = index % 2 === 0;
      return isX
        ? Math.floor(Math.random() * width)
        : Math.floor(Math.random() * height);
    });

  const isJpegFile = (file: File) =>
    file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);

  const toPngFilename = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return "image.png";
    const base = trimmed.replace(/\.[^.]+$/, "");
    return `${base}.png`;
  };

  const toDwPngFilename = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return "image.dw.png";
    if (/\.dw\.png$/i.test(trimmed)) return trimmed;
    const base = trimmed.replace(/\.[^.]+$/, "");
    return `${base}.dw.png`;
  };

  const splitFilename = (name: string) => {
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

  const ensureUniqueFilenameFromSet = (
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

  const ensureUniqueFilename = (
    desiredName: string,
    currentIndex: number,
    files: ImageFile[],
  ) => {
    const used = new Set(
      files
        .filter((_file, idx) => idx !== currentIndex)
        .map((file) => file.filename.toLowerCase()),
    );
    return ensureUniqueFilenameFromSet(desiredName, used);
  };

  function loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = src;
    });
  }

  const addFiles = (files: File[]) => {
    setImageFiles((prevFiles) => {
      const existingKeys = new Set(prevFiles.map((f) => fileKey(f.file)));

      const newFiles: ImageFile[] = [];
      for (const file of files) {
        const key = fileKey(file);
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        newFiles.push({
          filename: file.name,
          file: file,
          previewUrl: URL.createObjectURL(file),
          status: "new",
        });
      }

      return [...prevFiles, ...newFiles];
    });
  };

  function removeFile(name: string) {
    setImageFiles((prevFiles) => {
      const toRemove = prevFiles.find((f) => f.filename === name);
      if (toRemove) URL.revokeObjectURL(toRemove.previewUrl);

      return prevFiles.filter((f) => f.filename !== name);
    });
  }

  function renameFile(index: number, newName: string) {
    setImageFiles((prevFiles) => {
      const target = prevFiles[index];
      if (!target) return prevFiles;

      const trimmed = newName.trim();
      if (!trimmed) return prevFiles;

      const originalName = target.filename;
      const hasDwPng = /\.dw\.png$/i.test(originalName);
      const lastDot = originalName.lastIndexOf(".");
      const originalExt = lastDot > 0 ? originalName.slice(lastDot) : "";

      let base = trimmed;
      if (hasDwPng) {
        base = base.replace(/\.dw\.png$/i, "");
        base = base.replace(/\.[^.]+$/, "");
      } else if (originalExt.length > 0) {
        base = base.replace(/\.[^.]+$/, "");
      }

      const finalName = hasDwPng
        ? `${base}.dw.png`
        : originalExt.length > 0
          ? `${base}${originalExt}`
          : base;

      const uniqueName = ensureUniqueFilename(finalName, index, prevFiles);
      if (uniqueName === target.filename) return prevFiles;

      return prevFiles.map((file, i) =>
        i === index ? { ...file, filename: uniqueName } : file,
      );
    });
  }

  function clearFiles() {
    imageFiles.forEach((it) => URL.revokeObjectURL(it.previewUrl));
    setImageFiles([]);
  }

  function resetAll() {
    setImageFiles((prevFiles) => {
      prevFiles.forEach((it) => URL.revokeObjectURL(it.previewUrl));
      return [];
    });
    setStep("upload");
    setReviewIndex(0);
  }

  function updatePoint(
    imageIndex: number,
    pointIndex: number,
    x: number,
    y: number,
  ) {
    setImageFiles((prevFiles) =>
      prevFiles.map((file, idx) => {
        if (idx !== imageIndex || !file.vector || !file.width || !file.height) {
          return file;
        }

        const nextVector = [...file.vector];
        const base = pointIndex * 2;
        if (base < 0 || base + 1 >= nextVector.length) return file;

        const clampedX = Math.min(file.width, Math.max(0, x));
        const clampedY = Math.min(file.height, Math.max(0, y));

        nextVector[base] = clampedX;
        nextVector[base + 1] = clampedY;

        const nextFile = { ...file, vector: nextVector };
        if (file.check) {
          nextFile.check = false;
        }
        return nextFile;
      }),
    );
  }

  async function loadImageDimensions(src: string) {
    const img = await loadImage(src);
    return { width: img.naturalWidth, height: img.naturalHeight };
  }

  async function convertJpegToPng(file: File, targetName: string) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to access canvas context");
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (!result) {
            reject(new Error("Failed to convert image"));
            return;
          }
          resolve(result);
        }, "image/png");
      });
      return new File([blob], targetName, {
        type: "image/png",
        lastModified: file.lastModified,
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function normalizeJpegToPng(image: ImageFile) {
    if (!isJpegFile(image.file)) return image;
    try {
      const nextFilename = toPngFilename(image.filename);
      const pngFile = await convertJpegToPng(image.file, nextFilename);
      const nextPreviewUrl = URL.createObjectURL(pngFile);
      URL.revokeObjectURL(image.previewUrl);
      return {
        ...image,
        filename: nextFilename,
        file: pngFile,
        previewUrl: nextPreviewUrl,
      };
    } catch (error) {
      console.warn("Failed to convert JPEG to PNG.", image.filename, error);
      return image;
    }
  }

  async function processImagesWithBackend(
    images: ImageFile[],
    existing: ImageFile[] = [],
  ) {
    // TODO: Replace mock generation with a real backend request.
    if (images.length === 0) return [];

    setProcessing({ inProgress: true, completed: 0, total: images.length });

    try {
      const processed = await Promise.all(
        images.map(async (image) => {
          try {
            const prepared = await normalizeJpegToPng(image);
            const { width, height } = await loadImageDimensions(
              prepared.previewUrl,
            );
            return {
              ...prepared,
              filename: toDwPngFilename(prepared.filename),
              vector: createVector(width, height),
              check: Math.random() < 0.5,
              width,
              height,
            };
          } finally {
            setProcessing((prev) => ({
              ...prev,
              completed: Math.min(prev.total, prev.completed + 1),
            }));
          }
        }),
      );

      const used = new Set(
        existing.map((file) => file.filename.toLowerCase()),
      );
      return processed.map((file) => {
        const uniqueName = ensureUniqueFilenameFromSet(file.filename, used);
        return uniqueName === file.filename
          ? file
          : { ...file, filename: uniqueName };
      });
    } finally {
      setProcessing((prev) => ({ ...prev, inProgress: false }));
    }
  }

  async function processImages() {
    setStep("review");
    setReviewIndex(0);

    const updated = await processImagesWithBackend(imageFiles);

    setImageFiles(updated);
  }

  async function addFilesForReview(files: File[]) {
    if (files.length === 0) return;
    const existingKeys = new Set(imageFiles.map((f) => fileKey(f.file)));
    const newFiles: ImageFile[] = [];

    for (const file of files) {
      const key = fileKey(file);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      newFiles.push({
        filename: file.name,
        file: file,
        previewUrl: URL.createObjectURL(file),
        status: "new",
      });
    }

    if (newFiles.length === 0) return;

    const processed = await processImagesWithBackend(newFiles, imageFiles);

    setImageFiles((prevFiles) => [...prevFiles, ...processed]);
  }

  useEffect(() => {
    return () => {
      imageFiles.forEach((it) => URL.revokeObjectURL(it.previewUrl));
    };
    // TODO: dowiedziec sie o co tu chodzi
  }, []);

  const clearCheckForIndex = (imageIndex: number) => {
    setImageFiles((prevFiles) => {
      let changed = false;
      const nextFiles = prevFiles.map((file, idx) => {
        if (idx !== imageIndex || !file.check) return file;
        changed = true;
        return { ...file, check: false };
      });
      return changed ? nextFiles : prevFiles;
    });
  };

  const handleReviewIndexChange = (nextIndex: number) => {
    if (nextIndex === reviewIndex) return;
    setReviewIndex(nextIndex);
  };

  return (
    <>
      <div className="container py-4">
        <h2 className="mb-3">WingAI</h2>
        {processing.inProgress && processing.total > 0 && (
          <div className="mb-3">
            <div className="small text-muted mb-1">
              Processing images... {processing.completed}/{processing.total}
            </div>
            <div
              className="progress"
              role="progressbar"
              aria-valuenow={Math.round(
                (processing.completed / processing.total) * 100,
              )}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="progress-bar"
                style={{
                  width: `${Math.round(
                    (processing.completed / processing.total) * 100,
                  )}%`,
                }}
              />
            </div>
          </div>
        )}
        {step === "upload" && (
          <UploadImages
            images={imageFiles}
            addFiles={addFiles}
            removeFile={removeFile}
            clearFiles={clearFiles}
            renameFile={renameFile}
            onProcess={processImages}
          />
        )}
        {step === "review" && (
          <ReviewImages
            images={imageFiles}
            index={reviewIndex}
            onIndexChange={handleReviewIndexChange}
            onUpdatePoint={updatePoint}
            onRename={renameFile}
            onRemove={removeFile}
            onAddFiles={addFilesForReview}
            onReset={resetAll}
            onClearCheck={clearCheckForIndex}
          />
        )}
      </div>
    </>
  );
}
