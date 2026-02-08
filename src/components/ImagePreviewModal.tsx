import { useEffect, useRef, useState } from "react";
import { formatBytes } from "../utils";
import type { ImageFile } from "../App";

export type ImagePreviewModalProps = {
  images: ImageFile[];
  previewIndex: number | null;
  onPreviewIndexChange: (index: number | null) => void;
  onClose: () => void;
  onRemove: (filename: string) => void;
  onRename: (index: number, newName: string) => void;
};

export default function ImagePreviewModal({
  images,
  previewIndex,
  onPreviewIndexChange,
  onClose,
  onRemove,
  onRename,
}: ImagePreviewModalProps) {
  const previewImage =
    previewIndex === null ? null : images[previewIndex] ?? null;
  const [previewDimensions, setPreviewDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

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
          background: "#fff",
          borderRadius: "8px",
          padding: "0.75rem",
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.2)",
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
          <img
            src={previewImage.previewUrl}
            alt={previewImage.filename}
            style={{
              display: "block",
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
            }}
          />
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
        <div className="d-flex justify-content-between gap-2">
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
