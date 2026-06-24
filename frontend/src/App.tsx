import { useEffect, useRef, useState } from "react";
import UploadImages from "./components/UploadImages";
import ReviewImages from "./components/ReviewImages";
import DetectionModelPanel from "./components/DetectionModelPanel";
import HelpPanel from "./components/HelpPanel";
import LanguageSwitcher from "./components/LanguageSwitcher";
import { detectFromUrl } from "./utils/yoloDetector";
import type { Detection } from "./utils/yoloDetector";
import {
  fileKey,
  isJpegFile,
  toPngFilename,
  toDwPngFilename,
  ensureUniqueFilename,
  ensureUniqueFilenameFromSet,
} from "./utils/filename";
import {
  loadImage,
  loadImageDimensions,
  renderTransformedImage,
  canvasToBlob,
} from "./utils/image";
import type { ImageTransform } from "./utils/image";
import { useT } from "./i18n";

export default App;

export type { Detection };

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
  detections?: Detection[];
  showDetections?: boolean;
  selectedDetectionIndex?: number;
  excludedDetections?: number[];
  skipProcessing?: boolean;
};

type ThemeMode = "light" | "dark";

const UPLOAD_MAX_EDGE = 400;
const ENABLE_UPLOAD_RESIZE = false;
const THEME_STORAGE_KEY = "wingai-theme";

const getInitialTheme = (): ThemeMode => {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  const prefersDark = window.matchMedia?.(
    "(prefers-color-scheme: dark)",
  ).matches;
  return prefersDark ? "dark" : "light";
};

function App() {
  const t = useT();
  const [imageFiles, setImageFiles] = useState<ImageFile[]>([]);
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [reviewIndex, setReviewIndex] = useState(0);
  const [showDownloadNotice, setShowDownloadNotice] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const downloadNoticeTimeout = useRef<number | null>(null);
  const dimensionsRequestedRef = useRef(new Set<string>());
  const [processing, setProcessing] = useState({
    inProgress: false,
    completed: 0,
    total: 0,
  });
  const [detection, setDetection] = useState({
    inProgress: false,
    completed: 0,
    total: 0,
  });
  const [detectionError, setDetectionError] = useState<string | null>(null);

  async function resizeImageForUpload(
    file: File,
    width: number,
    height: number,
  ) {
    if (!ENABLE_UPLOAD_RESIZE) {
      return file;
    }
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
      const blob = await canvasToBlob(canvas, "image/png");
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

  async function handleDetect() {
    if (detection.inProgress || imageFiles.length === 0) return;
    const toDetect = imageFiles.filter((img) => !img.skipProcessing && img.detections === undefined);
    if (toDetect.length === 0) return;
    setDetection({ inProgress: true, completed: 0, total: toDetect.length });
    setDetectionError(null);
    try {
      const detectionMap = new Map<string, ImageFile>();
      for (const img of toDetect) {
        try {
          const dets = await detectFromUrl(img.previewUrl);
          detectionMap.set(img.filename, { ...img, detections: dets });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          if (detectionMap.size === 0) {
            setDetectionError(message);
            return;
          }
        } finally {
          setDetection((prev) => ({
            ...prev,
            completed: Math.min(prev.total, prev.completed + 1),
          }));
        }
      }
      setImageFiles((prev) => prev.map((img) => detectionMap.get(img.filename) ?? img));
    } finally {
      setDetection((prev) => ({ ...prev, inProgress: false }));
    }
  }

  async function handleDetectSingle(index: number) {
    if (detection.inProgress) return;
    const img = imageFiles[index];
    if (!img) return;
    setDetection({ inProgress: true, completed: 1, total: 1 });
    setDetectionError(null);
    try {
      const dets = await detectFromUrl(img.previewUrl);
      setImageFiles((prev) =>
        prev.map((f, i) => (i === index ? { ...f, detections: dets } : f)),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setDetectionError(message);
    } finally {
      setDetection({ inProgress: false, completed: 1, total: 1 });
    }
  }

  async function handleTransformImage(
    imageIndex: number,
    transform: ImageTransform,
  ) {
    const image = imageFiles[imageIndex];
    if (!image) return;

    const mimeType = image.file.type || "image/jpeg";
    const quality = mimeType === "image/jpeg" ? 0.95 : undefined;

    let blob: Blob;
    try {
      blob = await renderTransformedImage(
        image.previewUrl,
        transform,
        mimeType,
        quality,
      );
    } catch (err) {
      console.warn("Failed to transform image.", image.filename, err);
      return;
    }

    const newFile = new File([blob], image.filename, { type: mimeType, lastModified: Date.now() });
    const newPreviewUrl = URL.createObjectURL(blob);
    URL.revokeObjectURL(image.previewUrl);

    setImageFiles((prev) =>
      prev.map((f, i) =>
        i === imageIndex
          ? {
              ...f,
              file: newFile,
              previewUrl: newPreviewUrl,
              detections: undefined,
              selectedDetectionIndex: undefined,
              excludedDetections: undefined,
              vector: undefined,
              check: undefined,
              status: "new",
            }
          : f,
      ),
    );
  }

  const handleFlipImage = (
    imageIndex: number,
    direction: "horizontal" | "vertical",
  ) => handleTransformImage(imageIndex, { type: "flip", axis: direction });

  const handleRotateImage = (imageIndex: number, direction: "cw" | "ccw") =>
    handleTransformImage(imageIndex, { type: "rotate", direction });

  function handleToggleSkipProcessing(filename: string) {
    setImageFiles((prev) =>
      prev.map((f) =>
        f.filename === filename ? { ...f, skipProcessing: !f.skipProcessing } : f,
      ),
    );
  }

  function handleToggleDetectionExclusion(imageIndex: number, detIndex: number) {
    setImageFiles((prevFiles) =>
      prevFiles.map((file, i) => {
        if (i !== imageIndex) return file;
        const excluded = new Set(file.excludedDetections ?? []);
        if (excluded.has(detIndex)) excluded.delete(detIndex);
        else excluded.add(detIndex);
        const allExcluded = (file.detections ?? []).every((_, idx) => excluded.has(idx));
        return { ...file, excludedDetections: [...excluded], ...(allExcluded ? { showDetections: false } : {}) };
      }),
    );
  }

  async function handleExtractDetections(imageIndex: number) {
    const image = imageFiles[imageIndex];
    if (!image?.detections || image.detections.length === 0) return;

    const excluded = new Set(image.excludedDetections ?? []);
    const toExtract = image.detections
      .map((det, i) => ({ det, i }))
      .filter(({ i }) => !excluded.has(i));

    if (toExtract.length === 0) return;

    const baseName = image.filename.replace(/\.[^.]+$/, "");
    const srcImg = await loadImage(image.previewUrl);
    const used = new Set(imageFiles.map((f) => f.filename.toLowerCase()));
    const newFiles: ImageFile[] = [];

    for (let n = 0; n < toExtract.length; n++) {
      const { det } = toExtract[n];
      const x1 = Math.max(0, Math.round(det.x1));
      const y1 = Math.max(0, Math.round(det.y1));
      const cropW = Math.max(1, Math.round(det.x2) - x1);
      const cropH = Math.max(1, Math.round(det.y2) - y1);

      const canvas = document.createElement("canvas");
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(srcImg, x1, y1, cropW, cropH, 0, 0, cropW, cropH);

      const blob = await canvasToBlob(canvas, "image/png");

      const desiredName = `${baseName}_wing_${n + 1}.png`;
      const filename = ensureUniqueFilenameFromSet(desiredName, used);
      const file = new File([blob], filename, { type: "image/png", lastModified: Date.now() });

      newFiles.push({
        filename,
        file,
        previewUrl: URL.createObjectURL(blob),
        status: "new",
        width: cropW,
        height: cropH,
      });
    }

    if (newFiles.length > 0) {
      setImageFiles((prev) => [
        ...prev.map((f, i) => (i === imageIndex ? { ...f, skipProcessing: true } : f)),
        ...newFiles,
      ]);
    }
  }

  function handleSelectDetection(imageIndex: number, detIndex: number) {
    setImageFiles((prevFiles) =>
      prevFiles.map((file, i) =>
        i === imageIndex ? { ...file, selectedDetectionIndex: detIndex } : file,
      ),
    );
  }

  function handleToggleDetections(index: number) {
    setImageFiles((prevFiles) =>
      prevFiles.map((file, i) => {
        if (i !== index) return file;
        const turningOn = !(file.showDetections ?? true);
        return {
          ...file,
          showDetections: turningOn,
          ...(turningOn ? { excludedDetections: [] } : {}),
        };
      }),
    );
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
      const blob = await canvasToBlob(canvas, "image/png");
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

    const response = await fetch("/api/analyze", {
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

  async function cropImageToBoundingBox(image: ImageFile): Promise<ImageFile> {
    const dets = image.detections;
    if (!dets || dets.length === 0 || !(image.showDetections ?? true)) {
      return image;
    }

    const topDet =
      image.selectedDetectionIndex !== undefined && dets[image.selectedDetectionIndex]
        ? dets[image.selectedDetectionIndex]
        : dets.reduce((best, det) => det.confidence > best.confidence ? det : best);

    const x1 = Math.max(0, Math.round(topDet.x1));
    const y1 = Math.max(0, Math.round(topDet.y1));
    const cropW = Math.max(1, Math.round(topDet.x2) - x1);
    const cropH = Math.max(1, Math.round(topDet.y2) - y1);

    try {
      const srcImg = await loadImage(image.previewUrl);
      const canvas = document.createElement("canvas");
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return image;
      ctx.drawImage(srcImg, x1, y1, cropW, cropH, 0, 0, cropW, cropH);

      const blob = await canvasToBlob(canvas, "image/png");

      const croppedFile = new File([blob], image.filename, {
        type: "image/png",
        lastModified: image.file.lastModified,
      });

      return {
        ...image,
        file: croppedFile,
        previewUrl: URL.createObjectURL(blob),
        width: cropW,
        height: cropH,
      };
    } catch (err) {
      console.warn("Failed to crop image, using original.", image.filename, err);
      return image;
    }
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
            const cropped = await cropImageToBoundingBox(prepared);
            if (cropped !== prepared) {
              prepared = cropped;
              width = prepared.width;
              height = prepared.height;
            }
            prepared = await normalizeJpegToPng(prepared);
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
    const toProcess = imageFiles.filter((f) => !f.skipProcessing);
    if (toProcess.length === 0) return;

    setImageFiles(toProcess);
    setStep("review");
    setReviewIndex(0);

    const processed = await processImagesWithBackend(toProcess);
    setImageFiles(processed);
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
    // Each previewUrl is considered exactly once. After the first pass every
    // file is in `requested`, so subsequent renders (e.g. landmark dragging,
    // which updates imageFiles on every pointer move) short-circuit cheaply
    // instead of re-scanning and re-querying dimensions.
    const requested = dimensionsRequestedRef.current;

    for (const file of imageFiles) {
      if (requested.has(file.previewUrl)) continue;
      requested.add(file.previewUrl);

      const hasDimensions =
        typeof file.width === "number" &&
        Number.isFinite(file.width) &&
        typeof file.height === "number" &&
        Number.isFinite(file.height);
      if (hasDimensions) continue;

      const { previewUrl, filename } = file;
      void loadImageDimensions(previewUrl)
        .then(({ width, height }) => {
          setImageFiles((prevFiles) =>
            prevFiles.map((item) =>
              item.previewUrl === previewUrl
                ? { ...item, width, height }
                : item,
            ),
          );
        })
        .catch((error) => {
          console.warn("Failed to read image dimensions.", filename, error);
        });
    }
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

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-bs-theme", theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

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
            gridTemplateColumns: "auto 1fr auto",
            alignItems: "center",
            columnGap: "0.75rem",
          }}
        >
          <button
            type="button"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center" }}
            onClick={resetAll}
            aria-label="WingAI Home"
          >
            <img
              src={theme === "dark" ? "/logo-dark.png" : "/logo.png"}
              alt="WingAI"
              style={{ height: "100px", width: "auto" }}
            />
          </button>
          {showDownloadNotice && (
            <div
              className="alert alert-success py-2 px-3 mb-0 small"
              role="status"
              style={{ justifySelf: "center" }}
            >
              {t.downloadInProgress}
            </div>
          )}
          <div
            className="d-flex align-items-center gap-3"
            style={{ justifySelf: "end" }}
          >
            <LanguageSwitcher />
            <HelpPanel />
            <DetectionModelPanel />
            <div className="form-check form-switch m-0">
              <input
                className="form-check-input"
                type="checkbox"
                role="switch"
                id="theme-switch"
                checked={theme === "dark"}
                onChange={() =>
                  setTheme((prev) => (prev === "dark" ? "light" : "dark"))
                }
                aria-label="Toggle dark mode"
              />
              <label className="form-check-label small" htmlFor="theme-switch">
                {t.darkMode}
              </label>
            </div>
          </div>
        </div>
        {detection.inProgress && detection.total > 0 && (
          <div className="mb-3">
            <div className="small text-muted mb-1">
              {detection.total === 1
                ? t.detectingObjects
                : t.detectingObjectsProgress(detection.completed, detection.total)}
            </div>
            <div
              className="progress"
              role="progressbar"
              aria-valuenow={
                detection.total === 1
                  ? 100
                  : Math.round((detection.completed / detection.total) * 100)
              }
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`progress-bar${detection.total === 1 ? " progress-bar-animated progress-bar-striped" : ""}`}
                style={{
                  width:
                    detection.total === 1
                      ? "100%"
                      : `${Math.round(
                          (detection.completed / detection.total) * 100,
                        )}%`,
                }}
              />
            </div>
          </div>
        )}
        {processing.inProgress && processing.total > 0 && (
          <div className="mb-3">
            <div className="small text-muted mb-1">
              {t.processingImages(processing.completed, processing.total)}
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
                  transition: "none",
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
            onDetect={handleDetect}
            isDetecting={detection.inProgress}
            detectionError={detectionError}
            onToggleDetections={handleToggleDetections}
            onDetectSingle={handleDetectSingle}
            onSelectDetection={handleSelectDetection}
            onFlipImage={handleFlipImage}
            onRotateImage={handleRotateImage}
            onToggleSkipProcessing={handleToggleSkipProcessing}
            onToggleDetectionExclusion={handleToggleDetectionExclusion}
            onExtractDetections={handleExtractDetections}
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
