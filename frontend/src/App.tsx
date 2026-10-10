import { useEffect, useRef, useState } from "react";
import UploadImages from "./components/UploadImages";
import ReviewImages from "./components/ReviewImages";
import ConfirmDialog from "./components/ConfirmDialog";
import DetectionModelPanel from "./components/DetectionModelPanel";
import HelpPanel from "./components/HelpPanel";
import LanguageSwitcher from "./components/LanguageSwitcher";
import WingOptionSwitches from "./components/WingOptionSwitches";
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
  turnImage,
  renderTransformedImage,
  renderThumbnail,
  canvasToBlob,
} from "./utils/image";
import type { ImageTransform } from "./utils/image";
import { straightenedCrop } from "./utils/obbCrop";
import { mainDetectionIndex } from "./utils/mainDetection";
import { mapWithConcurrency, runPipeline } from "./utils/async";
import { newImageId, patchImageById } from "./utils/imageState";
import {
  DEFAULT_WING_OPTIONS,
  chooseModel,
  chooseOrientation,
  needsMirroring,
  orientationToApply,
} from "./utils/wingOptions";
import type { WingModel, WingOptions } from "./utils/wingOptions";
import { clampToImage, turnLandmarks } from "./utils/landmarks";
import { needsRotation } from "./utils/wingPose";
import { useT } from "./i18n";

export default App;

export type { Detection };

export type ImageFile = {
  // Stays the same while the name and the picture change during processing.
  id: string;
  filename: string;
  file: File;
  previewUrl: string;
  thumbUrl?: string;
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

// What the first stage of processing (the crop) hands to the second (the request to the backend).
type PreparedImage = {
  // The photo as it is sent to the backend.
  image: ImageFile;
  width: number | undefined;
  height: number | undefined;
  // The picture is a crop, so the screen can show it right away.
  cropped: boolean;
  // Set when preparing failed. The second stage then makes the error result without a request.
  failure?: { error: unknown };
};

const UPLOAD_MAX_EDGE = 400;
const ENABLE_UPLOAD_RESIZE = false;
const THEME_STORAGE_KEY = "wingai-theme";
// Max images processed concurrently. Keeps memory bounded and avoids flooding
// the backend (whose inference is effectively serialized) while overlapping
// client-side crop/encode with in-flight requests.
const PROCESS_CONCURRENCY = 4;
// Photos cropped at the same time (as many as were processed at the same time before). The crop is work for the
// browser, not for the backend, and runs ahead of the requests: a photo is shown cropped and sent as soon as it
// is ready. With 8 photos on a fast computer: 2 at a time shows the first crop sooner (1.3 s, not 2.5 s) but takes
// 6.5 s in all, 4 at a time takes 4.7 s.
const PREPARE_CONCURRENCY = 4;
// Thumbnails for the upload list: render a small downscaled image once per
// file so the browser never decodes full-resolution photos to paint a 56px
// preview. Bounded concurrency keeps only a few full-res decodes in flight.
const THUMBNAIL_MAX_EDGE = 128;
const THUMBNAIL_CONCURRENCY = 3;

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
  // Preserved copy of the edit-page list captured when Process is clicked, so
  // "Edit" can restore the original images (including skipped ones) after
  // processing has replaced the working list with cropped/renamed results.
  const [uploadSnapshot, setUploadSnapshot] = useState<ImageFile[] | null>(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [showDownloadNotice, setShowDownloadNotice] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  // The header's Model and Orientation switches; chooseModel / chooseOrientation
  // keep them consistent. Both are read once, when Process is clicked.
  const [wingOptions, setWingOptions] = useState(DEFAULT_WING_OPTIONS);
  const [editConfirmTrigger, setEditConfirmTrigger] = useState(0);
  const [resetConfirmTrigger, setResetConfirmTrigger] = useState(0);
  const [isUploadResetConfirmOpen, setIsUploadResetConfirmOpen] = useState(false);
  const downloadNoticeTimeout = useRef<number | null>(null);
  const dimensionsRequestedRef = useRef(new Set<string>());
  // The list as last rendered, for processing that runs later and has to know whether a photo is still there.
  const latestImagesRef = useRef<ImageFile[]>([]);
  const thumbnailRequestedRef = useRef(new Set<string>());
  // Ref drives a synchronous re-entry guard (catches same-tick double clicks);
  // the state drives the spinner overlay in the preview modal.
  const transformingRef = useRef(new Set<string>());
  const processingAbortRef = useRef<AbortController | null>(null);
  const [transformingFiles, setTransformingFiles] = useState<Set<string>>(
    new Set(),
  );
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
          id: newImageId(),
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
      if (toRemove) {
        URL.revokeObjectURL(toRemove.previewUrl);
        if (toRemove.thumbUrl) URL.revokeObjectURL(toRemove.thumbUrl);
      }

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
    imageFiles.forEach((it) => {
      URL.revokeObjectURL(it.previewUrl);
      if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
    });
    setImageFiles([]);
  }

  function resetAll() {
    processingAbortRef.current?.abort();
    setImageFiles((prevFiles) => {
      prevFiles.forEach((it) => {
        URL.revokeObjectURL(it.previewUrl);
        if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
      });
      return [];
    });
    if (uploadSnapshot) {
      uploadSnapshot.forEach((it) => {
        URL.revokeObjectURL(it.previewUrl);
        if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
      });
      setUploadSnapshot(null);
    }
    setStep("upload");
    setReviewIndex(0);
    setEditConfirmTrigger(0);
    setResetConfirmTrigger(0);
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

    const filename = image.filename;
    // Ignore extra clicks while this image is already being transformed.
    if (transformingRef.current.has(filename)) return;
    transformingRef.current.add(filename);
    setTransformingFiles((prev) => new Set(prev).add(filename));

    const mimeType = image.file.type || "image/jpeg";
    const quality = mimeType === "image/jpeg" ? 0.95 : undefined;

    try {
      let blob: Blob;
      let width: number;
      let height: number;
      try {
        ({ blob, width, height } = await renderTransformedImage(
          image.previewUrl,
          transform,
          mimeType,
          quality,
        ));
      } catch (err) {
        console.warn("Failed to transform image.", filename, err);
        return;
      }

      const newFile = new File([blob], image.filename, { type: mimeType, lastModified: Date.now() });
      const newPreviewUrl = URL.createObjectURL(blob);
      URL.revokeObjectURL(image.previewUrl);
      if (image.thumbUrl) URL.revokeObjectURL(image.thumbUrl);

      setImageFiles((prev) =>
        prev.map((f, i) =>
          i === imageIndex
            ? {
                ...f,
                file: newFile,
                previewUrl: newPreviewUrl,
                thumbUrl: undefined,
                width,
                height,
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
    } finally {
      transformingRef.current.delete(filename);
      setTransformingFiles((prev) => {
        const next = new Set(prev);
        next.delete(filename);
        return next;
      });
    }
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
      let canvas: HTMLCanvasElement;
      try {
        canvas = straightenedCrop(srcImg, det);
      } catch {
        continue;
      }

      const blob = await canvasToBlob(canvas, "image/png");

      const desiredName = `${baseName}_wing_${n + 1}.png`;
      const filename = ensureUniqueFilenameFromSet(desiredName, used);
      const file = new File([blob], filename, { type: "image/png", lastModified: Date.now() });

      newFiles.push({
        id: newImageId(),
        filename,
        file,
        previewUrl: URL.createObjectURL(blob),
        status: "new",
        width: canvas.width,
        height: canvas.height,
      });
    }

    if (newFiles.length > 0) {
      setImageFiles((prev) => {
        const updated = prev.map((f, i) =>
          i === imageIndex ? { ...f, skipProcessing: true } : f,
        );
        return [
          ...updated.slice(0, imageIndex + 1),
          ...newFiles,
          ...updated.slice(imageIndex + 1),
        ];
      });
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

        nextVector[base] = clampToImage(x, file.width);
        nextVector[base + 1] = clampToImage(y, file.height);

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
    const nextFilename = toPngFilename(image.filename);
    if (image.file.type === "image/png") {
      // A crop is already a PNG but keeps the name of its photo (*.JPG), which is what isJpegFile looks
      // at. Encoding it again would give the same pixels, so only the name changes.
      return {
        ...image,
        filename: nextFilename,
        file: new File([image.file], nextFilename, {
          type: "image/png",
          lastModified: image.file.lastModified,
        }),
      };
    }
    try {
      const pngFile = await convertJpegToPng(image.file, nextFilename);
      const nextPreviewUrl = URL.createObjectURL(pngFile);
      // Note: the original previewUrl is intentionally NOT revoked here — it is
      // kept alive in the upload snapshot so "Edit" can restore the originals.
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
    model: WingModel,
    signal: AbortSignal,
  ) {
    const formData = new FormData();
    const uploadBlob = await resizeImageForUpload(image.file, width, height);
    formData.append("file", uploadBlob, image.filename);
    formData.append("x_size", String(width));
    formData.append("y_size", String(height));
    formData.append("model", model);

    const response = await fetch("/api/analyze", {
      method: "POST",
      body: formData,
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `Backend error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      coords?: unknown;
      check?: unknown;
      orientation?: unknown;
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

    return { coords, check, orientation: data.orientation };
  }

  async function cropImageToBoundingBox(image: ImageFile): Promise<ImageFile> {
    const dets = image.detections;
    if (!dets || dets.length === 0 || !(image.showDetections ?? true)) {
      return image;
    }

    // The same detection that the preview draws in green.
    const mainIndex = mainDetectionIndex(
      dets,
      image.selectedDetectionIndex,
      new Set(image.excludedDetections ?? []),
    );
    if (mainIndex === null) return image;

    try {
      const srcImg = await loadImage(image.previewUrl);
      const canvas = straightenedCrop(srcImg, dets[mainIndex]);
      const blob = await canvasToBlob(canvas, "image/png");

      const croppedFile = new File([blob], image.filename, {
        type: "image/png",
        lastModified: image.file.lastModified,
      });

      return {
        ...image,
        file: croppedFile,
        previewUrl: URL.createObjectURL(blob),
        width: canvas.width,
        height: canvas.height,
      };
    } catch (err) {
      console.warn("Failed to crop image, using original.", image.filename, err);
      return image;
    }
  }

  // The first stage of processing: the crop (when the photo has a detection), the PNG name and the size. It is
  // work for the browser only. A failure does not throw, the second stage turns it into the error result.
  async function prepareImage(
    image: ImageFile,
    signal: AbortSignal,
    madeUrls: Set<string>,
  ): Promise<PreparedImage> {
    let prepared = image;
    let width = image.width;
    let height = image.height;
    let cropped = false;
    // The object URLs made here: released when the run is aborted, otherwise the run keeps track of them.
    const made: string[] = [];
    try {
      const croppedImage = await cropImageToBoundingBox(prepared);
      if (croppedImage !== prepared) {
        made.push(croppedImage.previewUrl);
        prepared = croppedImage;
        width = prepared.width;
        height = prepared.height;
        cropped = true;
      }
      if (signal.aborted) throw signal.reason;
      const normalized = await normalizeJpegToPng(prepared);
      if (normalized.previewUrl !== prepared.previewUrl) {
        made.push(normalized.previewUrl);
      }
      prepared = normalized;
      if (signal.aborted) throw signal.reason;
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
      made.forEach((url) => madeUrls.add(url));
      return { image: prepared, width, height, cropped };
    } catch (error) {
      if (signal.aborted) {
        made.forEach((url) => URL.revokeObjectURL(url));
        throw error;
      }
      made.forEach((url) => madeUrls.add(url));
      return { image: prepared, width, height, cropped, failure: { error } };
    }
  }

  // The second stage of processing: the request to the backend and, when the wing lies on the other side, the
  // mirror image. It makes the final state of the photo, an error one when something failed.
  async function analyzePrepared(
    preparedImage: PreparedImage,
    image: ImageFile,
    model: WingModel,
    orientation: ReturnType<typeof orientationToApply>,
    signal: AbortSignal,
    madeUrls: Set<string>,
  ): Promise<ImageFile> {
    let prepared = preparedImage.image;
    const { width, height } = preparedImage;
    try {
      if (preparedImage.failure) throw preparedImage.failure.error;
      if (width === undefined || height === undefined) {
        throw new Error("Invalid image dimensions.");
      }

      const analysis = await analyzeImageWithBackend(
        prepared,
        width,
        height,
        model,
        signal,
      );
      let landmarks = analysis.coords;
      // When a side is wanted, the wings of the other handedness are mirrored and the wings that lie upside down
      // are turned by 180 degrees (both together mirror the wing vertically).
      const turn = {
        mirror: needsMirroring(orientation, analysis.orientation),
        rotate: needsRotation(orientation, analysis.coords, analysis.orientation),
      };
      if (turn.mirror || turn.rotate) {
        // The picture and its landmarks are turned together. If that fails, the wing
        // stays as it was with its original landmarks, never one turned without the other.
        try {
          const turned = await turnImage(
            prepared.previewUrl,
            prepared.filename,
            prepared.file.lastModified,
            turn,
          );
          if (
            signal.aborted ||
            turned.width !== width ||
            turned.height !== height
          ) {
            URL.revokeObjectURL(turned.previewUrl);
            throw signal.aborted
              ? signal.reason
              : new Error("The turned image has other dimensions.");
          }
          madeUrls.add(turned.previewUrl);
          // The original previewUrl stays alive in the upload snapshot, "Edit" restores it.
          prepared = {
            ...prepared,
            file: turned.file,
            previewUrl: turned.previewUrl,
            thumbUrl: undefined,
          };
          landmarks = turnLandmarks(analysis.coords, width, height, turn);
        } catch (error) {
          if (signal.aborted) throw error;
          console.warn(
            "Failed to turn the image, keeping its orientation.",
            prepared.filename,
            error,
          );
        }
      }
      return {
        ...prepared,
        filename: toDwPngFilename(prepared.filename),
        vector: landmarks,
        check: analysis.check,
        status: "done",
        width,
        height,
      };
    } catch (error) {
      if (signal.aborted) throw error;
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Backend analysis failed.", image.filename, error);
      return {
        ...prepared,
        status: "error",
        error: message,
        width,
        height,
      };
    }
  }

  // Crops and analyses the photos in two stages that run at the same time, and updates each photo on the
  // screen as soon as its crop and then its result are ready.
  async function processImagesWithBackend(
    images: ImageFile[],
    options: WingOptions,
  ) {
    if (images.length === 0) return;

    const { model } = options;
    const orientation = orientationToApply(options);
    const abortController = new AbortController();
    processingAbortRef.current = abortController;
    const { signal } = abortController;

    // The object URLs made by this run, to release those of a photo that was deleted meanwhile.
    const madeUrls = new Set<string>();
    // The name of each photo before the pass that makes the names unique.
    const wantedNames = new Map<string, string>();

    // Updates one photo. It may be gone by now (deleted while processing): then its pictures are released.
    const update = (
      id: string,
      changes: Partial<ImageFile>,
      uniqueName = false,
    ) => {
      if (signal.aborted) return;
      if (!latestImagesRef.current.some((file) => file.id === id)) {
        if (changes.previewUrl && madeUrls.has(changes.previewUrl)) {
          URL.revokeObjectURL(changes.previewUrl);
        }
        return;
      }
      setImageFiles((prev) => {
        const index = prev.findIndex((file) => file.id === id);
        if (index < 0) return prev;
        const patch =
          uniqueName && changes.filename !== undefined
            ? {
                ...changes,
                filename: ensureUniqueFilename(changes.filename, index, prev),
              }
            : changes;
        return patchImageById(prev, id, patch);
      });
    };

    setProcessing({ inProgress: true, completed: 0, total: images.length });

    try {
      await runPipeline(images, {
        prepareLimit: PREPARE_CONCURRENCY,
        analyzeLimit: PROCESS_CONCURRENCY,
        signal,
        prepare: (image) => prepareImage(image, signal, madeUrls),
        onPrepared: (prepared, image) => {
          // Show the crop now, while the backend is still busy with the photos before it.
          if (!prepared.cropped) return;
          update(image.id, {
            file: prepared.image.file,
            previewUrl: prepared.image.previewUrl,
            width: prepared.width,
            height: prepared.height,
          });
        },
        analyze: (prepared, image) =>
          analyzePrepared(prepared, image, model, orientation, signal, madeUrls),
        onAnalyzed: (result, image) => {
          wantedNames.set(image.id, result.filename);
          update(image.id, result, true);
          setProcessing((prev) => ({
            ...prev,
            completed: Math.min(prev.total, prev.completed + 1),
          }));
        },
      });

      // Photos that ended up with the same name get (2), (3)... in the order of the list, whichever
      // of them was ready first.
      setImageFiles((prev) => {
        const used = new Set<string>();
        let changed = false;
        const next = prev.map((file) => {
          const wanted = wantedNames.get(file.id);
          if (wanted === undefined) return file;
          const name = ensureUniqueFilenameFromSet(wanted, used);
          if (name === file.filename) return file;
          changed = true;
          return { ...file, filename: name };
        });
        return changed ? next : prev;
      });
    } finally {
      if (processingAbortRef.current === abortController) {
        processingAbortRef.current = null;
        setProcessing((prev) => ({ ...prev, inProgress: false }));
      }
    }
  }

  async function processImages() {
    const toProcess = imageFiles.filter((f) => !f.skipProcessing);
    if (toProcess.length === 0) return;

    // Preserve the full edit-page list (incl. skipped) so "Edit" can restore it.
    setUploadSnapshot(imageFiles);
    setImageFiles(toProcess);
    setStep("review");
    setReviewIndex(0);

    try {
      await processImagesWithBackend(toProcess, wingOptions);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        throw error;
      }
    }
  }

  function handleBackToEdit() {
    processingAbortRef.current?.abort();
    const snapshot = uploadSnapshot;
    if (!snapshot) return;

    // Revoke the processed results' object URLs, but keep any that the restored
    // originals still reference (an un-cropped PNG keeps its original URL).
    const keep = new Set<string>();
    for (const file of snapshot) {
      keep.add(file.previewUrl);
      if (file.thumbUrl) keep.add(file.thumbUrl);
    }
    for (const file of imageFiles) {
      if (!keep.has(file.previewUrl)) URL.revokeObjectURL(file.previewUrl);
      if (file.thumbUrl && !keep.has(file.thumbUrl)) {
        URL.revokeObjectURL(file.thumbUrl);
      }
    }

    setImageFiles(snapshot);
    setUploadSnapshot(null);
    setStep("upload");
    setReviewIndex(0);
    setEditConfirmTrigger(0);
    setResetConfirmTrigger(0);
  }

  useEffect(() => {
    latestImagesRef.current = imageFiles;
  }, [imageFiles]);

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
    // Generate a small thumbnail once per file (keyed by previewUrl) for the
    // upload list, so the browser never decodes full-resolution photos to paint
    // 56px previews. Flip/rotate/extract all produce a new previewUrl, so this
    // picks them up automatically. Bounded concurrency avoids decoding many
    // full-size images at once.
    if (step !== "upload") return;
    const requested = thumbnailRequestedRef.current;
    const pending: string[] = [];
    for (const file of imageFiles) {
      if (file.thumbUrl || requested.has(file.previewUrl)) continue;
      requested.add(file.previewUrl);
      pending.push(file.previewUrl);
    }
    if (pending.length === 0) return;

    void mapWithConcurrency(pending, THUMBNAIL_CONCURRENCY, async (previewUrl) => {
      try {
        const blob = await renderThumbnail(previewUrl, THUMBNAIL_MAX_EDGE);
        const thumbUrl = URL.createObjectURL(blob);
        setImageFiles((prevFiles) => {
          if (!prevFiles.some((f) => f.previewUrl === previewUrl)) {
            // File was removed or replaced while the thumbnail was rendering.
            URL.revokeObjectURL(thumbUrl);
            return prevFiles;
          }
          return prevFiles.map((f) =>
            f.previewUrl === previewUrl ? { ...f, thumbUrl } : f,
          );
        });
      } catch (error) {
        console.warn("Failed to generate thumbnail.", error);
      }
    });
  }, [imageFiles, step]);

  useEffect(() => {
    return () => {
      imageFiles.forEach((it) => {
        URL.revokeObjectURL(it.previewUrl);
        if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
      });
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
    if (step === "review") {
      history.pushState({ wingaiStep: "review" }, "");
    }
  }, [step]);

  useEffect(() => {
    const handlePopState = () => {
      if (step !== "review") return;
      // Re-push so the back button still works if the user cancels the dialog.
      history.pushState({ wingaiStep: "review" }, "");
      setEditConfirmTrigger((n) => n + 1);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [step]);

  useEffect(() => {
    if (imageFiles.length === 0 && step !== "review") return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [imageFiles.length, step]);

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
            onClick={
              step === "review"
                ? () => setResetConfirmTrigger((n) => n + 1)
                : imageFiles.length > 0
                  ? () => setIsUploadResetConfirmOpen(true)
                  : resetAll
            }
            aria-label={t.homeLabel}
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
            className="d-flex flex-wrap align-items-center justify-content-end column-gap-3 row-gap-4"
            style={{ justifySelf: "end" }}
          >
            <WingOptionSwitches
              model={wingOptions.model}
              orientation={wingOptions.orientation}
              onModelChange={(model) =>
                setWingOptions((options) => chooseModel(options, model))
              }
              onOrientationChange={(orientation) =>
                setWingOptions((options) =>
                  chooseOrientation(options, orientation),
                )
              }
            />
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
                aria-label={t.darkMode}
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
            transformingFiles={transformingFiles}
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
            onBackToEdit={handleBackToEdit}
            onReset={resetAll}
            onClearCheck={clearCheckForIndex}
            onDownloadNotice={triggerDownloadNotice}
            editConfirmTrigger={editConfirmTrigger}
            resetConfirmTrigger={resetConfirmTrigger}
          />
        )}
        <footer className="mt-4 text-center text-muted small">
          © {new Date().getFullYear()} Mateusz Krajewski
        </footer>
      </div>
      {isUploadResetConfirmOpen && (
        <ConfirmDialog
          title={t.resetTitle}
          message={t.resetMessage}
          confirmLabel={t.reset}
          cancelLabel={t.cancel}
          closeLabel={t.close}
          onConfirm={() => {
            setIsUploadResetConfirmOpen(false);
            resetAll();
          }}
          onCancel={() => setIsUploadResetConfirmOpen(false)}
        />
      )}
    </>
  );
}
