import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { formatBytes } from "../utils";
import type { ImageFile, Detection } from "../App";

export type ImagePreviewModalProps = {
  images: ImageFile[];
  previewIndex: number | null;
  onPreviewIndexChange: (index: number | null) => void;
  onClose: () => void;
  onRemove: (filename: string) => void;
  onRename: (index: number, newName: string) => void;
  onToggleDetections: (index: number) => void;
};

export default function ImagePreviewModal({
  images,
  previewIndex,
  onPreviewIndexChange,
  onClose,
  onRemove,
  onRename,
  onToggleDetections,
}: ImagePreviewModalProps) {
  const previewImage =
    previewIndex === null ? null : images[previewIndex] ?? null;
  const [previewDimensions, setPreviewDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const showBoxes = previewImage?.showDetections ?? true;
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const drawBoxes = useCallback(
    (detections: Detection[] | undefined) => {
      const img = imgRef.current;
      const canvas = canvasRef.current;
      if (!img || !canvas || !detections || detections.length === 0) return;

      const dispW = img.offsetWidth;
      const dispH = img.offsetHeight;
      if (dispW === 0 || dispH === 0) return;

      canvas.width = dispW;
      canvas.height = dispH;

      const scaleX = dispW / img.naturalWidth;
      const scaleY = dispH / img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, dispW, dispH);

      const topDetection = detections.reduce((best, det) =>
        det.confidence > best.confidence ? det : best,
      );
      for (const det of [topDetection]) {
        const x = det.x1 * scaleX;
        const y = det.y1 * scaleY;
        const w = (det.x2 - det.x1) * scaleX;
        const h = (det.y2 - det.y1) * scaleY;

        ctx.strokeStyle = "#00e676";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
      }
    },
    [],
  );

  useEffect(() => {
    if (showBoxes) drawBoxes(previewImage?.detections);
  }, [drawBoxes, previewImage, showBoxes]);

  useEffect(() => {
    if (!previewImage) return;
    setRenameValue(previewImage.filename);
  }, [previewImage]);

  useEffect(() => {
    if (!previewImage) return;
    const width = previewImage.width;
    const height = previewImage.height;
    const hasDimensions =
      typeof width === "number" &&
      Number.isFinite(width) &&
      width > 0 &&
      typeof height === "number" &&
      Number.isFinite(height) &&
      height > 0;

    if (hasDimensions) {
      setPreviewDimensions({ width, height });
      return;
    }

    const img = new Image();
    img.onload = () => {
      setPreviewDimensions({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };
    img.src = previewImage.previewUrl;
  }, [previewImage]);

  useEffect(() => {
    if (!previewImage) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement;
      const isEditingName =
        active instanceof HTMLInputElement && active.type === "text";

      if (!isEditingName && (event.key === "n" || event.key === "N")) {
        event.preventDefault();
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
        return;
      }

      if (
        isEditingName &&
        (event.key === "ArrowRight" || event.key === "ArrowLeft")
      ) {
        return;
      }

      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "Delete") {
        if (isEditingName || !previewImage || previewIndex === null) return;
        onRemove(previewImage.filename);
        const nextIndex =
          previewIndex < images.length - 1 ? previewIndex : previewIndex - 1;
        if (nextIndex >= 0) {
          onPreviewIndexChange(nextIndex);
        } else {
          onClose();
        }
      } else if (event.key === "ArrowRight") {
        if (previewIndex === null) return;
        onPreviewIndexChange(
          Math.min(images.length - 1, previewIndex + 1),
        );
      } else if (event.key === "ArrowLeft") {
        if (previewIndex === null) return;
        onPreviewIndexChange(Math.max(0, previewIndex - 1));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    images.length,
    onClose,
    onPreviewIndexChange,
    onRemove,
    previewImage,
    previewIndex,
  ]);

  if (!previewImage) return null;

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1050,
        padding: "1rem",
      }}
    >
      <div
        role="dialog"
        aria-label="Podglad obrazu"
        onClick={(event) => event.stopPropagation()}
        style={{
          position: "relative",
          width: "min(80vw, 900px)",
          height: "80vh",
          background: "var(--bs-body-bg)",
          borderRadius: "8px",
          padding: "0.75rem",
          boxShadow: "var(--bs-box-shadow-lg)",
          border: "1px solid var(--bs-border-color)",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
        }}
      >
        <button
          type="button"
          aria-label="Zamknij"
          onClick={onClose}
          className="btn btn-close"
          style={{ position: "absolute", top: "0.5rem", right: "0.5rem" }}
        />
        <div className="text-center text-muted">
          {previewIndex === null
            ? ""
            : `Image ${previewIndex + 1} of ${images.length}`}
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <div style={{ position: "relative", lineHeight: 0 }}>
            <img
              ref={imgRef}
              src={previewImage.previewUrl}
              alt={previewImage.filename}
              onLoad={() => { if (showBoxes) drawBoxes(previewImage.detections); }}
              style={{
                display: "block",
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
              }}
            />
            {showBoxes && previewImage.detections && previewImage.detections.length > 0 && (
              <canvas
                ref={canvasRef}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  pointerEvents: "none",
                }}
              />
            )}
          </div>
        </div>
        <input
          type="text"
          className="form-control text-center fw-semibold"
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          ref={renameInputRef}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            if (!renameValue.trim() || previewIndex === null) return;
            onRename(previewIndex, renameValue.trim());
            event.currentTarget.blur();
          }}
        />
        <div className="text-center text-muted">
          {formatBytes(previewImage.file.size)}
          {" • "}
          {previewDimensions
            ? `${previewDimensions.width}×${previewDimensions.height}px`
            : "Wymiary: ..."}
          {" • "}
          {previewImage.file.type
            ? previewImage.file.type.replace(/^image\//, "")
            : "unknown type"}
        </div>
        <div className="d-flex justify-content-end">
          <button
            type="button"
            className="btn btn-outline-danger"
            onClick={() => {
              if (!previewImage || previewIndex === null) return;
              onRemove(previewImage.filename);
              const nextIndex =
                previewIndex < images.length - 1
                  ? previewIndex
                  : previewIndex - 1;
              if (nextIndex >= 0) {
                onPreviewIndexChange(nextIndex);
              } else {
                onClose();
              }
            }}
          >
            Delete
          </button>
        </div>
        <div className="d-flex justify-content-between align-items-center gap-2">
          <button
            type="button"
            className="btn btn-outline-secondary"
            disabled={previewIndex === null || previewIndex <= 0}
            onClick={() =>
              previewIndex === null
                ? null
                : onPreviewIndexChange(Math.max(0, previewIndex - 1))
            }
          >
            Previous
          </button>
          {previewImage.detections && previewImage.detections.length > 0 ? (
            <button
              type="button"
              className={`btn btn-sm d-flex align-items-center gap-2 ${
                showBoxes ? "btn-success" : "btn-outline-secondary"
              }`}
              onClick={() => {
                if (previewIndex !== null) onToggleDetections(previewIndex);
              }}
            >
              <Check size={14} />
              {showBoxes ? "Bounding box on" : "Bounding box off"}
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            className="btn btn-outline-secondary"
            disabled={previewIndex === null || previewIndex >= images.length - 1}
            onClick={() =>
              previewIndex === null
                ? null
                : onPreviewIndexChange(
                    Math.min(images.length - 1, previewIndex + 1),
                  )
            }
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
