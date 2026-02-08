import { useEffect, useRef, useState } from "react";
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

const UPLOAD_MAX_EDGE = 256;

function App() {
  const [imageFiles, setImageFiles] = useState<ImageFile[]>([]);
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [reviewIndex, setReviewIndex] = useState(0);
  const [showDownloadNotice, setShowDownloadNotice] = useState(false);
  const downloadNoticeTimeout = useRef<number | null>(null);
  const pendingDimensionsRef = useRef(new Set<string>());
  const [processing, setProcessing] = useState({
    inProgress: false,
    completed: 0,
    total: 0,
  });

  const fileKey = (file: File) =>
    `${file.name}|${file.size}|${file.lastModified}`;

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

  async function resizeImageForUpload(
    file: File,
    width: number,
    height: number,
  ) {
    const longestEdge = Math.max(width, height);
    if (!Number.isFinite(longestEdge) || longestEdge <= 0) {
      throw new Error("Invalid dimensions for resize.");
    }
    if (longestEdge <= UPLOAD_MAX_EDGE) {
      return file;
    }

    const scale = UPLOAD_MAX_EDGE / longestEdge;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to access canvas context");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (!result) {
            reject(new Error("Failed to resize image"));
            return;
          }
          resolve(result);
        }, "image/png");
      });
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
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

  async function analyzeImageWithBackend(
    image: ImageFile,
    width: number,
    height: number,
  ) {
    const formData = new FormData();
    const uploadBlob = await resizeImageForUpload(image.file, width, height);
    formData.append("file", uploadBlob, image.filename);
    formData.append("x_size", String(width));
    formData.append("y_size", String(height));

    const response = await fetch("http://localhost:8000/analyze", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(
        `Backend error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      coords?: unknown;
      check?: unknown;
    };
    const coords = Array.isArray(data.coords)
      ? data.coords.map((value) => Number(value))
      : [];
    const validCoords =
      coords.length === 38 && coords.every((value) => Number.isFinite(value));
    if (!validCoords) {
      throw new Error("Invalid coords from backend.");
    }

    let check = false;
    if (typeof data.check === "boolean") {
      check = data.check;
    } else if (typeof data.check === "string") {
      check = data.check.toLowerCase() === "true";
    } else {
      check = Boolean(data.check);
    }

    return { coords, check };
  }

  async function processImagesWithBackend(
    images: ImageFile[],
    existing: ImageFile[] = [],
  ) {
    if (images.length === 0) return [];

    setProcessing({ inProgress: true, completed: 0, total: images.length });

    try {
      const processed = await Promise.all(
        images.map(async (image): Promise<ImageFile> => {
          let prepared = image;
          let width = image.width;
          let height = image.height;
          try {
            prepared = await normalizeJpegToPng(image);
            const hasDimensions =
              typeof width === "number" &&
              Number.isFinite(width) &&
              width > 0 &&
              typeof height === "number" &&
              Number.isFinite(height) &&
              height > 0;
            if (!hasDimensions) {
              const dimensions = await loadImageDimensions(prepared.previewUrl);
              width = dimensions.width;
              height = dimensions.height;
            }
            if (
              typeof width !== "number" ||
              !Number.isFinite(width) ||
              width <= 0 ||
              typeof height !== "number" ||
              !Number.isFinite(height) ||
              height <= 0
            ) {
              throw new Error("Invalid image dimensions.");
            }

            const analysis = await analyzeImageWithBackend(
              prepared,
              width,
              height,
            );
            return {
              ...prepared,
              filename: toDwPngFilename(prepared.filename),
              vector: analysis.coords,
              check: analysis.check,
              status: "done",
              width,
              height,
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Unknown error";
            console.error("Backend analysis failed.", image.filename, error);
            return {
              ...prepared,
              status: "error",
              error: message,
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

      const used = new Set(existing.map((file) => file.filename.toLowerCase()));
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
    if (imageFiles.length === 0) return;
    const pending = pendingDimensionsRef.current;

    imageFiles.forEach((file) => {
      const hasWidth =
        typeof file.width === "number" && Number.isFinite(file.width);
      const hasHeight =
        typeof file.height === "number" && Number.isFinite(file.height);
      if (hasWidth && hasHeight) return;
      if (pending.has(file.previewUrl)) return;

      pending.add(file.previewUrl);
      void loadImageDimensions(file.previewUrl)
        .then(({ width, height }) => {
          setImageFiles((prevFiles) =>
            prevFiles.map((item) =>
              item.previewUrl === file.previewUrl
                ? { ...item, width, height }
                : item,
            ),
          );
        })
        .catch((error) => {
          console.warn("Failed to read image dimensions.", file.filename, error);
        })
        .finally(() => {
          pending.delete(file.previewUrl);
        });
    });
  }, [imageFiles]);

  useEffect(() => {
    return () => {
      imageFiles.forEach((it) => URL.revokeObjectURL(it.previewUrl));
    };
  }, []);

  useEffect(() => {
    return () => {
      if (downloadNoticeTimeout.current !== null) {
        window.clearTimeout(downloadNoticeTimeout.current);
      }
    };
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

  const triggerDownloadNotice = () => {
    setShowDownloadNotice(true);
    if (downloadNoticeTimeout.current !== null) {
      window.clearTimeout(downloadNoticeTimeout.current);
    }
    downloadNoticeTimeout.current = window.setTimeout(() => {
      setShowDownloadNotice(false);
      downloadNoticeTimeout.current = null;
    }, 2500);
  };

  return (
    <>
      <div className="container py-4">
        <div
          className="mb-3"
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            alignItems: "center",
            columnGap: "0.75rem",
          }}
        >
          <h2 className="mb-0">WingAI</h2>
          {showDownloadNotice && (
            <div
              className="alert alert-success py-2 px-3 mb-0 small"
              role="status"
              style={{ justifySelf: "center" }}
            >
              Download in progress...
            </div>
          )}
        </div>
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
            isProcessing={processing.inProgress}
            onIndexChange={handleReviewIndexChange}
            onUpdatePoint={updatePoint}
            onRename={renameFile}
            onRemove={removeFile}
            onAddFiles={addFilesForReview}
            onReset={resetAll}
            onClearCheck={clearCheckForIndex}
            onDownloadNotice={triggerDownloadNotice}
          />
        )}
        <footer className="mt-4 text-center text-muted small">
          © {new Date().getFullYear()} Mateusz Krajewski
        </footer>
      </div>
    </>
  );
}
