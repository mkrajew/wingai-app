import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { formatBytes } from "../utils";
import type { ImageFile, Detection } from "../App";

const CHECKBOX_SIZE = 14;

export type ImagePreviewModalProps = {
  images: ImageFile[];
  previewIndex: number | null;
  onPreviewIndexChange: (index: number | null) => void;
  onClose: () => void;
  onRemove: (filename: string) => void;
  onRename: (index: number, newName: string) => void;
  onToggleDetections: (index: number) => void;
  onDetectSingle: (index: number) => void;
  onSelectDetection: (imageIndex: number, detIndex: number) => void;
  onToggleDetectionExclusion: (imageIndex: number, detIndex: number) => void;
  onExtractDetections: (imageIndex: number) => void;
  onFlipImage: (imageIndex: number, direction: "horizontal" | "vertical") => void;
  onToggleSkipProcessing: (filename: string) => void;
  isDetecting: boolean;
};

export default function ImagePreviewModal({
  images,
  previewIndex,
  onPreviewIndexChange,
  onClose,
  onRemove,
  onRename,
  onToggleDetections,
  onDetectSingle,
  onSelectDetection,
  onToggleDetectionExclusion,
  onExtractDetections,
  onFlipImage,
  onToggleSkipProcessing,
  isDetecting,
}: ImagePreviewModalProps) {
  const previewImage =
    previewIndex === null ? null : images[previewIndex] ?? null;
  const [previewDimensions, setPreviewDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [hoveredDetIndex, setHoveredDetIndex] = useState<number | null>(null);
  const [showConfidence, setShowConfidence] = useState(true);
  const showBoxes = previewImage?.showDetections ?? true;
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const drawBoxes = useCallback(
    (
      detections: Detection[] | undefined,
      hoveredIndex: number | null = null,
      selectedIndex: number | null = null,
      showConf = true,
      excluded: ReadonlySet<number> = new Set(),
    ) => {
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

      const includedIndices = detections.map((_, i) => i).filter(i => !excluded.has(i));
      if (includedIndices.length === 0) return;

      const topIndex = includedIndices.reduce((best, i) =>
        detections[i].confidence > detections[best].confidence ? i : best,
        includedIndices[0],
      );
      const mainIndex = selectedIndex !== null && !excluded.has(selectedIndex) ? selectedIndex : topIndex;

      ctx.font = "bold 12px sans-serif";
      ctx.textBaseline = "bottom";

      for (let i = 0; i < detections.length; i++) {
        const det = detections[i];
        const x = det.x1 * scaleX;
        const y = det.y1 * scaleY;
        const w = (det.x2 - det.x1) * scaleX;
        const h = (det.y2 - det.y1) * scaleY;
        const isExcluded = excluded.has(i);
        const color = isExcluded ? "#888888" : (i === mainIndex ? "#00e676" : "#2196f3");
        const isHovered = i === hoveredIndex;

        if (isHovered && !isExcluded) {
          ctx.fillStyle = color + "33";
          ctx.fillRect(x, y, w, h);
        }

        ctx.globalAlpha = isExcluded ? 0.45 : 1.0;
        ctx.setLineDash(isExcluded ? [5, 4] : []);
        ctx.strokeStyle = color;
        ctx.lineWidth = isHovered && !isExcluded ? 3 : 2;
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        ctx.globalAlpha = 1.0;

        if (showConf && !isExcluded) {
          const label = (det.confidence * 100).toFixed(1) + "%";
          const textW = ctx.measureText(label).width;
          const labelX = x;
          const labelY = y > CHECKBOX_SIZE ? y : y + h + CHECKBOX_SIZE;
          ctx.fillStyle = color;
          ctx.fillRect(labelX, labelY - CHECKBOX_SIZE, textW + 6, CHECKBOX_SIZE);
          ctx.fillStyle = "#000";
          ctx.fillText(label, labelX + 3, labelY);
        }

        // Checkbox in top-right corner of each box
        const cbX = x + w - CHECKBOX_SIZE;
        const cbY = y;
        ctx.fillStyle = isExcluded ? "rgba(80,80,80,0.85)" : color;
        ctx.fillRect(cbX, cbY, CHECKBOX_SIZE, CHECKBOX_SIZE);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (isExcluded) {
          ctx.moveTo(cbX + 3, cbY + 3);
          ctx.lineTo(cbX + CHECKBOX_SIZE - 3, cbY + CHECKBOX_SIZE - 3);
          ctx.moveTo(cbX + CHECKBOX_SIZE - 3, cbY + 3);
          ctx.lineTo(cbX + 3, cbY + CHECKBOX_SIZE - 3);
        } else {
          ctx.moveTo(cbX + 2, cbY + CHECKBOX_SIZE / 2);
          ctx.lineTo(cbX + CHECKBOX_SIZE / 2 - 1, cbY + CHECKBOX_SIZE - 3);
          ctx.lineTo(cbX + CHECKBOX_SIZE - 2, cbY + 2);
        }
        ctx.stroke();
      }
    },
    [],
  );

  useEffect(() => {
    if (showBoxes) drawBoxes(previewImage?.detections, hoveredDetIndex, previewImage?.selectedDetectionIndex ?? null, showConfidence, new Set(previewImage?.excludedDetections ?? []));
  }, [drawBoxes, previewImage, showBoxes, hoveredDetIndex, showConfidence]);

  useEffect(() => {
    setHoveredDetIndex(null);
  }, [previewImage?.previewUrl]);

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

      if (!isEditingName && (event.key === "b" || event.key === "B")) {
        if (previewIndex !== null && previewImage.detections && previewImage.detections.length > 0) {
          onToggleDetections(previewIndex);
        }
        return;
      }

      if (!isEditingName && (event.key === "h" || event.key === "H")) {
        if (previewIndex !== null) onFlipImage(previewIndex, "horizontal");
        return;
      }

      if (!isEditingName && (event.key === "v" || event.key === "V")) {
        if (previewIndex !== null) onFlipImage(previewIndex, "vertical");
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
    onFlipImage,
    onPreviewIndexChange,
    onRemove,
    onToggleDetections,
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
              onLoad={() => { if (showBoxes) drawBoxes(previewImage.detections, null, previewImage.selectedDetectionIndex ?? null, showConfidence, new Set(previewImage.excludedDetections ?? [])); }}
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
                onMouseMove={(event) => {
                  const detections = previewImage.detections;
                  if (!detections || !imgRef.current) return;
                  const canvas = event.currentTarget;
                  const rect = canvas.getBoundingClientRect();
                  const mouseX = (event.clientX - rect.left) * (canvas.width / rect.width);
                  const mouseY = (event.clientY - rect.top) * (canvas.height / rect.height);
                  const scaleX = canvas.width / imgRef.current.naturalWidth;
                  const scaleY = canvas.height / imgRef.current.naturalHeight;
                  let found = -1;
                  let foundDist = Infinity;
                  for (let i = 0; i < detections.length; i++) {
                    const det = detections[i];
                    const cx = ((det.x1 + det.x2) / 2) * scaleX;
                    const cy = ((det.y1 + det.y2) / 2) * scaleY;
                    const dist = (mouseX - cx) ** 2 + (mouseY - cy) ** 2;
                    if (dist < foundDist) {
                      found = i;
                      foundDist = dist;
                    }
                  }
                  const newHovered = found === -1 ? null : found;
                  if (newHovered !== hoveredDetIndex) setHoveredDetIndex(newHovered);
                }}
                onClick={(event) => {
                  const detections = previewImage.detections;
                  if (!detections || !imgRef.current || previewIndex === null) return;
                  const canvas = event.currentTarget;
                  const rect = canvas.getBoundingClientRect();
                  const mouseX = (event.clientX - rect.left) * (canvas.width / rect.width);
                  const mouseY = (event.clientY - rect.top) * (canvas.height / rect.height);
                  const scaleX = canvas.width / imgRef.current.naturalWidth;
                  const scaleY = canvas.height / imgRef.current.naturalHeight;

                  // Check checkbox clicks first
                  for (let i = 0; i < detections.length; i++) {
                    const det = detections[i];
                    const x = det.x1 * scaleX;
                    const y = det.y1 * scaleY;
                    const w = (det.x2 - det.x1) * scaleX;
                    const cbX = x + w - CHECKBOX_SIZE;
                    if (mouseX >= cbX && mouseX <= cbX + CHECKBOX_SIZE && mouseY >= y && mouseY <= y + CHECKBOX_SIZE) {
                      onToggleDetectionExclusion(previewIndex, i);
                      return;
                    }
                  }

                  // Otherwise select main by closest center
                  let found = -1;
                  let foundDist = Infinity;
                  for (let i = 0; i < detections.length; i++) {
                    const det = detections[i];
                    const cx = ((det.x1 + det.x2) / 2) * scaleX;
                    const cy = ((det.y1 + det.y2) / 2) * scaleY;
                    const dist = (mouseX - cx) ** 2 + (mouseY - cy) ** 2;
                    if (dist < foundDist) { found = i; foundDist = dist; }
                  }
                  if (found !== -1) onSelectDetection(previewIndex, found);
                }}
                onMouseLeave={() => setHoveredDetIndex(null)}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  cursor: hoveredDetIndex !== null ? "pointer" : "default",
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
        <div className="d-flex justify-content-between align-items-center">
          <div className="d-flex gap-2">
            <button
              type="button"
              className={`btn btn-sm ${previewImage.skipProcessing ? "btn-outline-secondary" : "btn-outline-success"}`}
              onClick={() => onToggleSkipProcessing(previewImage.filename)}
            >
              {previewImage.skipProcessing ? "Skip" : "Process"}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              title="Flip horizontal"
              onClick={() => { if (previewIndex !== null) onFlipImage(previewIndex, "horizontal"); }}
            >
              ↔ Flip H
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              title="Flip vertical"
              onClick={() => { if (previewIndex !== null) onFlipImage(previewIndex, "vertical"); }}
            >
              ↕ Flip V
            </button>
          </div>
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
          {previewImage.detections === undefined ? (
            <button
              type="button"
              className="btn btn-sm btn-outline-primary d-flex align-items-center gap-2"
              disabled={isDetecting}
              onClick={() => {
                if (previewIndex !== null) onDetectSingle(previewIndex);
              }}
            >
              {isDetecting && (
                <span
                  className="spinner-border spinner-border-sm"
                  role="status"
                  aria-hidden="true"
                />
              )}
              Detect
            </button>
          ) : previewImage.detections.length > 0 ? (
            <div className="d-flex align-items-center gap-2">
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
                {showBoxes ? "Bounding boxes on" : "Bounding boxes off"}
              </button>
              {showBoxes && (
                <button
                  type="button"
                  className={`btn btn-sm ${showConfidence ? "btn-success" : "btn-outline-secondary"}`}
                  onClick={() => setShowConfidence((prev) => !prev)}
                >
                  {showConfidence ? "Confidence on" : "Confidence off"}
                </button>
              )}
              {showBoxes && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary"
                  onClick={() => { if (previewIndex !== null) onExtractDetections(previewIndex); }}
                >
                  Extract wings
                </button>
              )}
            </div>
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
