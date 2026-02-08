import { useEffect, useMemo, useRef, useState } from "react";
import { addPngTextChunk, createZipBlob } from "../utils";
import type { ImageFile } from "../App";

type ReviewImagesProps = {
  images: ImageFile[];
  index: number;
  isProcessing: boolean;
  onIndexChange: (index: number) => void;
  onClearCheck: (index: number) => void;
  onUpdatePoint: (
    imageIndex: number,
    pointIndex: number,
    x: number,
    y: number,
  ) => void;
  onRename: (imageIndex: number, newName: string) => void;
  onRemove: (filename: string) => void;
  onAddFiles: (files: File[]) => void;
  onReset: () => void;
  onDownloadNotice: () => void;
};

export default function ReviewImages({
  images,
  index,
  isProcessing,
  onIndexChange,
  onClearCheck,
  onUpdatePoint,
  onRename,
  onRemove,
  onAddFiles,
  onReset,
  onDownloadNotice,
}: ReviewImagesProps) {
  const image = images[index];
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeItemRef = useRef<HTMLButtonElement | null>(null);
  const zoomInputRef = useRef<HTMLInputElement | null>(null);
  const [svgScale, setSvgScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [exportMetadata, setExportMetadata] = useState(true);
  const [exportCsv, setExportCsv] = useState(false);
  const disableActions = isProcessing;
  const handleToggleMetadata = (checked: boolean) => {
    if (checked) {
      setExportMetadata(true);
      return;
    }
    if (!exportCsv) {
      setExportCsv(true);
    }
    setExportMetadata(false);
  };

  const handleToggleCsv = (checked: boolean) => {
    if (checked) {
      setExportCsv(true);
      return;
    }
    if (!exportMetadata) {
      setExportMetadata(true);
    }
    setExportCsv(false);
  };

  const points = useMemo(() => {
    if (!image?.vector) return [];
    const result: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < image.vector.length - 1; i += 2) {
      result.push({ x: image.vector[i], y: image.vector[i + 1] });
    }
    return result;
  }, [image]);

  const checkIndices = useMemo(() => {
    return images.reduce<number[]>((acc, item, idx) => {
      if (item.check) acc.push(idx);
      return acc;
    }, []);
  }, [images]);

  const handleNextCheck = () => {
    if (images.length === 0 || checkIndices.length === 0) return;
    if (checkIndices.length === 1) {
      onIndexChange(checkIndices[0]);
      return;
    }
    const currentPos = checkIndices.indexOf(index);
    if (currentPos === -1) {
      onIndexChange(checkIndices[0]);
      return;
    }
    const nextPos = (currentPos + 1) % checkIndices.length;
    onIndexChange(checkIndices[nextPos]);
  };

  if (!image) {
    return <div className="text-muted">No images to review.</div>;
  }

  const viewWidth = image.width ?? 0;
  const viewHeight = image.height ?? 0;
  const hasVector = image.vector && image.vector.length === 38;
  const canRender = viewWidth > 0 && viewHeight > 0;
  const zoomedWidth = viewWidth / zoom;
  const zoomedHeight = viewHeight / zoom;
  const zoomedX = (viewWidth - zoomedWidth) / 2;
  const zoomedY = (viewHeight - zoomedHeight) / 2;
  const maxPanX = Math.max(0, viewWidth - zoomedWidth);
  const maxPanY = Math.max(0, viewHeight - zoomedHeight);
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));
  const viewBoxX = clamp(zoomedX + panOffset.x, 0, maxPanX);
  const viewBoxY = clamp(zoomedY + panOffset.y, 0, maxPanY);
  const safeScale = svgScale > 0 ? svgScale : 1;
  const pointRadius = 7 / safeScale;
  const circleStroke = 1 / safeScale;
  const crossStroke = 1.5 / safeScale;
  const crossSize = pointRadius;
  const labelFont = 12 / safeScale;
  const labelOffset = 10 / safeScale;

  const toSvgPoint = (event: React.PointerEvent<SVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  };

  useEffect(() => {
    setRenameValue(image?.filename ?? "");
  }, [image?.filename]);

  useEffect(() => {
    if (!image?.check) return;
    onClearCheck(index);
  }, [image?.check, index, onClearCheck]);

  useEffect(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    setIsPanning(false);
    zoomInputRef.current?.blur();
  }, [index]);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [index]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !canRender) return;
    const updateScale = () => {
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      setSvgScale(
        Math.min(rect.width / zoomedWidth, rect.height / zoomedHeight),
      );
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [canRender, viewWidth, viewHeight, zoomedWidth, zoomedHeight]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !canRender) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const delta = -event.deltaY * 0.002;
      setZoom((prev) => Math.min(3, Math.max(1, prev + delta)));
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [canRender]);

  useEffect(() => {
    setPanOffset((prev) => {
      const nextX = clamp(zoomedX + prev.x, 0, maxPanX) - zoomedX;
      const nextY = clamp(zoomedY + prev.y, 0, maxPanY) - zoomedY;
      return { x: nextX, y: nextY };
    });
  }, [zoomedX, zoomedY, maxPanX, maxPanY]);

  const commitRename = () => {
    if (!image) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameValue(image.filename);
      return;
    }
    if (trimmed !== image.filename) {
      onRename(index, trimmed);
    }
  };

  useEffect(() => {
    if (!image) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement;
      const isEditingName =
        active instanceof HTMLInputElement && active.type === "text";
      const isZoomRange =
        active instanceof HTMLInputElement && active.type === "range";

      if (
        isZoomRange &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
      ) {
        event.preventDefault();
        active.blur();
      }

      if (!isEditingName && (event.key === "n" || event.key === "N")) {
        event.preventDefault();
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
        return;
      }

      if (
        (isEditingName || isZoomRange) &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
      ) {
        if (!isZoomRange) return;
      }

      if (event.key === "ArrowLeft") {
        if (index <= 0) return;
        onIndexChange(index - 1);
      } else if (event.key === "ArrowRight") {
        if (index >= images.length - 1) return;
        onIndexChange(index + 1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [image, index, images.length, onIndexChange]);

  const handleDelete = () => {
    if (!image) return;
    onClearCheck(index);
    if (images.length <= 1) {
      onReset();
      return;
    }
    const nextIndex = index < images.length - 1 ? index : index - 1;
    onIndexChange(nextIndex);
    onRemove(image.filename);
  };

  const downloadBlob = (filename: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const downloadText = (
    filename: string,
    content: string,
    type = "text/plain;charset=utf-8",
  ) => {
    downloadBlob(filename, new Blob([content], { type }));
  };

  const buildLandmarksMetadata = (img: ImageFile) => {
    const vector = img.vector ?? [];
    const values: number[] = [];
    for (let i = 0; i < vector.length; i += 2) {
      const rawX = vector[i];
      const rawY = vector[i + 1];
      const x = Number.isFinite(rawX) ? Math.trunc(rawX) : 0;
      const y = Number.isFinite(rawY) ? Math.trunc(rawY) : 0;
      values.push(x, y);
    }
    return `landmarks:${values.join(" ")};`;
  };

  const buildCsv = () => {
    const csvEscape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const interleavedHeaders = ["file"];
    for (let i = 0; i < 19; i += 1) {
      interleavedHeaders.push(`x${i + 1}`, `y${i + 1}`);
    }
    const rows: string[] = [interleavedHeaders.map(csvEscape).join(",")];
    images.forEach((img) => {
      const vector = img.vector ?? [];
      const ySize =
        typeof img.height === "number" && Number.isFinite(img.height)
          ? img.height
          : null;
      const values: string[] = [img.filename];
      for (let i = 0; i < 19; i += 1) {
        const x = vector[i * 2];
        const y = vector[i * 2 + 1];
        values.push(Number.isFinite(x) ? x.toString() : "");
        if (!Number.isFinite(y)) {
          values.push("");
          continue;
        }
        const flippedY = ySize !== null && ySize > 0 ? ySize - y - 2 : y;
        values.push(flippedY.toString());
      }
      rows.push(values.map((value) => csvEscape(value)).join(","));
    });
    return rows.join("\n");
  };

  const handleDownload = async () => {
    if (!exportMetadata && !exportCsv) return;
    setIsGenerateOpen(false);
    onDownloadNotice();
    const csvContent = exportCsv ? buildCsv() : null;

    if (exportMetadata) {
      const zipEntries = await Promise.all(
        images
          .filter((img) => /\.dw\.png$/i.test(img.filename))
          .map(async (img) => ({
            name: img.filename,
            data: addPngTextChunk(
              new Uint8Array(await img.file.arrayBuffer()),
              "IdentiFly",
              buildLandmarksMetadata(img),
            ),
            lastModified: img.file.lastModified,
          })),
      );

      if (exportCsv && csvContent !== null) {
        zipEntries.push({
          name: "points.csv",
          data: new TextEncoder().encode(csvContent),
          lastModified: Date.now(),
        });
      }

      const zipBlob = createZipBlob(zipEntries);
      downloadBlob("image-metadata.zip", zipBlob);
      return;
    }

    if (exportCsv && csvContent !== null) {
      downloadText("points.csv", csvContent, "text/csv;charset=utf-8");
    }
  };

  return (
    <div className="d-flex flex-column align-items-center gap-3">
      {checkIndices.length > 0 && (
        <div className="w-100">
          <div
            className="d-flex align-items-center justify-content-between flex-wrap gap-2 border rounded px-3 py-2"
            style={{
              background: "var(--bs-danger-bg-subtle)",
              borderColor: "var(--bs-danger-border-subtle)",
            }}
          >
            <div className="fw-semibold small">
              Please check images:{" "}
              {checkIndices.map((idx) => idx + 1).join(", ")}
            </div>
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              onClick={handleNextCheck}
            >
              Next
            </button>
          </div>
        </div>
      )}
      <div className="d-flex align-items-center w-100 gap-3">
        <div className="d-flex align-items-center justify-content-between flex-grow-1">
          <h3 className="mb-0">
            Image {index + 1} of {images.length}
          </h3>
          <div className="d-flex align-items-center gap-2">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setIsGenerateOpen(true)}
              disabled={disableActions}
            >
              Generate data
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={disableActions}
            >
              Add files
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onReset}
            >
              Reset
            </button>
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              onClick={handleDelete}
            >
              Delete
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              multiple
              onChange={(event) => {
                if (disableActions) return;
                const selected = Array.from(event.currentTarget.files ?? []);
                if (selected.length > 0) onAddFiles(selected);
                event.currentTarget.value = "";
              }}
              disabled={disableActions}
              style={{ display: "none" }}
            />
          </div>
        </div>
        <h3 className="mb-0" style={{ width: "240px" }}>
          Files
        </h3>
      </div>

      <div className="d-flex w-100 gap-3 align-items-start">
        <div
          className="flex-grow-1 d-flex flex-column align-items-center gap-3"
          style={{ minWidth: 0 }}
        >
          <div
            style={{
              position: "relative",
              display: "inline-block",
              width: "min(90vw, 100%)",
              height: "55vh",
              borderRadius: "8px",
              overflow: "hidden",
              background: "var(--bs-tertiary-bg)",
              border: "1px solid var(--bs-border-color)",
            }}
          >
            {canRender ? (
              <svg
                width="100%"
                height="100%"
                viewBox={`${viewBoxX} ${viewBoxY} ${zoomedWidth} ${zoomedHeight}`}
                preserveAspectRatio="xMidYMid meet"
                ref={svgRef}
                onPointerDown={(event) => {
                  if (zoom <= 1) return;
                  if (event.button !== 0) return;
                  if (dragIndex !== null) return;
                  event.preventDefault();
                  (event.currentTarget as Element).setPointerCapture(
                    event.pointerId,
                  );
                  setIsPanning(true);
                }}
                onPointerMove={(event) => {
                  if (dragIndex !== null) {
                    const pos = toSvgPoint(event);
                    if (!pos) return;
                    onUpdatePoint(index, dragIndex, pos.x, pos.y);
                    return;
                  }
                  if (!isPanning) return;
                  const deltaX = event.movementX / safeScale;
                  const deltaY = event.movementY / safeScale;
                  setPanOffset((prev) => {
                    const nextX = clamp(zoomedX + prev.x - deltaX, 0, maxPanX);
                    const nextY = clamp(zoomedY + prev.y - deltaY, 0, maxPanY);
                    return { x: nextX - zoomedX, y: nextY - zoomedY };
                  });
                }}
                onPointerUp={(event) => {
                  setDragIndex(null);
                  setIsPanning(false);
                  try {
                    (event.currentTarget as Element).releasePointerCapture(
                      event.pointerId,
                    );
                  } catch {
                    // ignore
                  }
                }}
                onPointerCancel={() => {
                  setDragIndex(null);
                  setIsPanning(false);
                }}
                style={{
                  display: "block",
                  touchAction: "none",
                  cursor:
                    dragIndex !== null
                      ? "grabbing"
                      : zoom > 1
                        ? isPanning
                          ? "grabbing"
                          : "grab"
                        : "default",
                }}
              >
                <image
                  href={image.previewUrl}
                  x={0}
                  y={0}
                  width={viewWidth}
                  height={viewHeight}
                  preserveAspectRatio="xMidYMid meet"
                />
                {hasVector &&
                  points.map((point, idx) => (
                    <g key={`pt-${idx}`}>
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={pointRadius}
                        fill="rgba(255, 77, 79, 0.2)"
                        stroke="#ff4d4f"
                        strokeWidth={circleStroke}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          event.preventDefault();
                          (event.currentTarget as Element).setPointerCapture(
                            event.pointerId,
                          );
                          setIsPanning(false);
                          setDragIndex(idx);
                          const pos = toSvgPoint(event);
                          if (!pos) return;
                          onUpdatePoint(index, idx, pos.x, pos.y);
                        }}
                        style={{ cursor: "grab" }}
                      />
                      <line
                        x1={point.x - crossSize}
                        y1={point.y}
                        x2={point.x + crossSize}
                        y2={point.y}
                        stroke="#ff4d4f"
                        strokeWidth={crossStroke}
                        strokeLinecap="round"
                        pointerEvents="none"
                      />
                      <line
                        x1={point.x}
                        y1={point.y - crossSize}
                        x2={point.x}
                        y2={point.y + crossSize}
                        stroke="#ff4d4f"
                        strokeWidth={crossStroke}
                        strokeLinecap="round"
                        pointerEvents="none"
                      />
                      <text
                        x={point.x}
                        y={point.y - labelOffset}
                        textAnchor="middle"
                        fontSize={labelFont}
                        fontWeight={600}
                        fill="var(--bs-body-color)"
                        stroke="var(--bs-body-bg)"
                        strokeWidth={crossStroke}
                        paintOrder="stroke"
                        pointerEvents="none"
                      >
                        {idx + 1}
                      </text>
                    </g>
                  ))}
              </svg>
            ) : (
              <div className="text-muted p-3">Loading image...</div>
            )}
          </div>
          <div className="d-flex align-items-center gap-3 w-100">
            <input
              type="range"
              className="form-range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              onPointerUp={(event) => event.currentTarget.blur()}
              ref={zoomInputRef}
            />
            <div className="text-muted small" style={{ minWidth: "3.5rem" }}>
              {Math.round(zoom * 100)}%
            </div>
          </div>

          <div className="d-flex align-items-center justify-content-between w-100 gap-3">
            <button
              type="button"
              className="btn btn-outline-secondary"
              disabled={index <= 0}
              onClick={() => onIndexChange(Math.max(0, index - 1))}
            >
              Previous
            </button>
            <input
              type="text"
              className="form-control text-center fw-semibold"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              ref={renameInputRef}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                commitRename();
                event.currentTarget.blur();
              }}
              onBlur={commitRename}
              style={{ maxWidth: "420px" }}
            />
            <button
              type="button"
              className="btn btn-outline-secondary"
              disabled={index >= images.length - 1}
              onClick={() =>
                onIndexChange(Math.min(images.length - 1, index + 1))
              }
            >
              Next
            </button>
          </div>
          <div className="text-muted small">
            {viewWidth > 0 && viewHeight > 0
              ? `${viewWidth}×${viewHeight}px`
              : "Dimensions: ..."}
          </div>

          {!hasVector && !image.error && (
            <div className="text-muted">Processing points...</div>
          )}
          {image.error && (
            <div className="text-danger small">Error: {image.error}</div>
          )}

          {hasVector && (
            <div className="w-100">
              <div className="fw-semibold mb-2">Points</div>
              <div className="table-responsive">
                <table className="table table-sm table-striped align-middle mb-0">
                  <thead>
                    <tr>
                      <th scope="col" style={{ whiteSpace: "nowrap" }}>
                        #
                      </th>
                      {points.map((_point, idx) => (
                        <th
                          key={`head-${idx}`}
                          scope="col"
                          style={{ whiteSpace: "nowrap", textAlign: "center" }}
                        >
                          {idx + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row" style={{ whiteSpace: "nowrap" }}>
                        X
                      </th>
                      {points.map((point, idx) => (
                        <td key={`x-${idx}`} style={{ textAlign: "center" }}>
                          {Math.round(point.x)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row" style={{ whiteSpace: "nowrap" }}>
                        Y
                      </th>
                      {points.map((point, idx) => (
                        <td key={`y-${idx}`} style={{ textAlign: "center" }}>
                          {Math.round(point.y)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div style={{ width: "240px" }} className="flex-shrink-0">
          <div
            className="list-group"
            style={{ height: "55vh", overflowY: "auto" }}
          >
            {images.map((item, idx) => (
              <button
                key={item.filename}
                type="button"
                className={`list-group-item list-group-item-action ${
                  idx === index ? "active" : ""
                }`}
                ref={idx === index ? activeItemRef : null}
                onClick={() => onIndexChange(idx)}
                style={{
                  backgroundImage: item.check
                    ? "linear-gradient(0deg, rgba(255, 77, 79, 0.12), rgba(255, 77, 79, 0.12))"
                    : undefined,
                }}
              >
                <div className="d-flex align-items-center gap-2">
                  <span
                    className="text-muted"
                    style={{ minWidth: "1rem", textAlign: "right" }}
                  >
                    {idx + 1}
                  </span>
                  <span className="text-truncate">{item.filename}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {isGenerateOpen && (
        <div
          role="presentation"
          onClick={() => setIsGenerateOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: "1rem",
          }}
        >
          <div
            role="dialog"
            aria-label="Generate data"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(90vw, 420px)",
              background: "var(--bs-body-bg)",
              borderRadius: "10px",
              padding: "1rem",
              boxShadow: "var(--bs-box-shadow-lg)",
              border: "1px solid var(--bs-border-color)",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
            }}
          >
            <div className="d-flex align-items-center justify-content-between">
              <h4 className="mb-0">Generate data</h4>
              <button
                type="button"
                className="btn btn-close"
                aria-label="Close"
                onClick={() => setIsGenerateOpen(false)}
              />
            </div>
            <div className="d-flex flex-column gap-2">
              <label className="form-check d-flex align-items-center gap-2">
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={exportMetadata}
                  onChange={(event) =>
                    handleToggleMetadata(event.currentTarget.checked)
                  }
                />
                <span className="form-check-label">Image metadata</span>
              </label>
              <label className="form-check d-flex align-items-center gap-2">
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={exportCsv}
                  onChange={(event) =>
                    handleToggleCsv(event.currentTarget.checked)
                  }
                />
                <span className="form-check-label">CSV</span>
              </label>
              {!exportMetadata && !exportCsv && (
                <div className="text-danger small">
                  Select at least one option.
                </div>
              )}
            </div>
            <div className="d-flex justify-content-end gap-2">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => setIsGenerateOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleDownload()}
                disabled={disableActions || (!exportMetadata && !exportCsv)}
              >
                Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
