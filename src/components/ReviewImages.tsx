import { useEffect, useMemo, useRef, useState } from "react";
import type { ImageFile } from "../App";

type ReviewImagesProps = {
  images: ImageFile[];
  index: number;
  onIndexChange: (index: number) => void;
  onUpdatePoint: (
    imageIndex: number,
    pointIndex: number,
    x: number,
    y: number,
  ) => void;
  onRename: (imageIndex: number, newName: string) => void;
};

export default function ReviewImages({
  images,
  index,
  onIndexChange,
  onUpdatePoint,
  onRename,
}: ReviewImagesProps) {
  const image = images[index];
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const points = useMemo(() => {
    if (!image?.vector) return [];
    const result: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < image.vector.length - 1; i += 2) {
      result.push({ x: image.vector[i], y: image.vector[i + 1] });
    }
    return result;
  }, [image]);

  if (!image) {
    return <div className="text-muted">No images to review.</div>;
  }

  const viewWidth = image.width ?? 0;
  const viewHeight = image.height ?? 0;
  const hasVector = image.vector && image.vector.length === 38;
  const canRender = viewWidth > 0 && viewHeight > 0;

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

      if (!isEditingName && (event.key === "n" || event.key === "N")) {
        event.preventDefault();
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
        return;
      }

      if (
        isEditingName &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
      ) {
        return;
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

  return (
    <div className="d-flex flex-column align-items-center gap-3">
      <div className="d-flex justify-content-between align-items-center w-100">
        <h3 className="mb-0">
          Image {index + 1} of {images.length}
        </h3>
      </div>

      <div
        style={{
          position: "relative",
          display: "inline-block",
          width: "min(90vw, 100%)",
          height: "55vh",
          borderRadius: "8px",
          overflow: "hidden",
          background: "#f8f9fa",
          border: "1px solid #dee2e6",
        }}
      >
        {canRender ? (
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${viewWidth} ${viewHeight}`}
            preserveAspectRatio="xMidYMid meet"
            ref={svgRef}
            onPointerMove={(event) => {
              if (dragIndex === null) return;
              const pos = toSvgPoint(event);
              if (!pos) return;
              onUpdatePoint(index, dragIndex, pos.x, pos.y);
            }}
            onPointerUp={() => setDragIndex(null)}
            onPointerCancel={() => setDragIndex(null)}
            style={{
              display: "block",
              touchAction: "none",
              cursor: dragIndex === null ? "default" : "grabbing",
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
                    r={6}
                    fill="#ff4d4f"
                    stroke="#ffffff"
                    strokeWidth={2}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      (event.currentTarget as Element).setPointerCapture(
                        event.pointerId,
                      );
                      setDragIndex(idx);
                      const pos = toSvgPoint(event);
                      if (!pos) return;
                      onUpdatePoint(index, idx, pos.x, pos.y);
                    }}
                    style={{ cursor: "grab" }}
                  />
                  <text
                    x={point.x}
                    y={point.y - 10}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={600}
                    fill="#212529"
                    stroke="#ffffff"
                    strokeWidth={2}
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

      {!hasVector && <div className="text-muted">Processing points...</div>}

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
  );
}
