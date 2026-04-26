import { useState, useEffect } from "react";
import {
  Download,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  AlertCircle,
} from "lucide-react";

type ModelStatus =
  | { phase: "checking" }
  | { phase: "not_loaded" }
  | { phase: "loading"; progress: number | null }
  | { phase: "ready" }
  | { phase: "error"; message: string };

const MODEL_URL = "/models/detector.onnx";
const CACHE_NAME = "wingai-models-v1";

async function isModelCached(): Promise<boolean> {
  if (!("caches" in window)) return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const match = await cache.match(MODEL_URL);
    return match !== undefined;
  } catch {
    return false;
  }
}

export default function DetectionModelPanel() {
  const [open, setOpen] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus>({
    phase: "checking",
  });

  useEffect(() => {
    isModelCached().then((cached) => {
      setModelStatus(cached ? { phase: "ready" } : { phase: "not_loaded" });
    });
  }, []);

  const loadModel = async () => {
    if (modelStatus.phase === "loading") return;
    setModelStatus({ phase: "loading", progress: 0 });

    try {
      const response = await fetch(MODEL_URL);
      if (!response.ok) {
        throw new Error(
          `Server responded with ${response.status} ${response.statusText}`,
        );
      }

      const contentLengthHeader = response.headers.get("Content-Length");
      const total = contentLengthHeader
        ? parseInt(contentLengthHeader, 10)
        : null;

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Response body is not readable");

      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        setModelStatus({
          phase: "loading",
          progress: total
            ? Math.min(99, Math.round((received / total) * 100))
            : null,
        });
      }

      if ("caches" in window) {
        const blob = new Blob(chunks as BlobPart[], { type: "application/octet-stream" });
        const cache = await caches.open(CACHE_NAME);
        await cache.put(MODEL_URL, new Response(blob));
      }

      setModelStatus({ phase: "ready" });
    } catch (err) {
      setModelStatus({
        phase: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const statusBadge =
    modelStatus.phase === "ready" ? (
      <span
        className="badge bg-success ms-1"
        style={{ fontSize: "0.6rem", verticalAlign: "middle" }}
      >
        Ready
      </span>
    ) : modelStatus.phase === "loading" ? (
      <span
        className="badge bg-warning text-dark ms-1"
        style={{ fontSize: "0.6rem", verticalAlign: "middle" }}
      >
        Loading
      </span>
    ) : null;

  return (
    <div className="position-relative">
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>Detection model</span>
        {statusBadge}
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {open && (
        <div
          className="position-absolute end-0 mt-1 border rounded shadow-sm bg-body p-3"
          style={{ minWidth: 260, zIndex: 20 }}
        >
          <p className="small fw-semibold mb-2 text-body">Detection model</p>

          {modelStatus.phase === "checking" && (
            <div className="text-muted small d-flex align-items-center gap-2">
              <span
                className="spinner-border spinner-border-sm"
                role="status"
                aria-hidden="true"
              />
              Checking...
            </div>
          )}

          {modelStatus.phase === "not_loaded" && (
            <button
              type="button"
              className="btn btn-sm btn-primary w-100 d-flex align-items-center justify-content-center gap-2"
              onClick={loadModel}
            >
              <Download size={14} />
              Load model
            </button>
          )}

          {modelStatus.phase === "loading" && (
            <div>
              <div className="d-flex justify-content-between small text-muted mb-1">
                <span>Loading model...</span>
                {modelStatus.progress !== null && (
                  <span>{modelStatus.progress}%</span>
                )}
              </div>
              <div className="progress" style={{ height: 6 }}>
                {modelStatus.progress !== null ? (
                  <div
                    className="progress-bar"
                    style={{
                      width: `${modelStatus.progress}%`,
                      transition: "width 0.2s ease",
                    }}
                  />
                ) : (
                  <div
                    className="progress-bar progress-bar-striped progress-bar-animated"
                    style={{ width: "100%" }}
                  />
                )}
              </div>
            </div>
          )}

          {modelStatus.phase === "ready" && (
            <div className="d-flex flex-column gap-2">
              <div className="alert alert-success py-2 px-3 mb-0 small d-flex align-items-center gap-2">
                <CheckCircle size={14} />
                <span>Model loaded and ready</span>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={loadModel}
              >
                Reload model
              </button>
            </div>
          )}

          {modelStatus.phase === "error" && (
            <div className="d-flex flex-column gap-2">
              <div className="alert alert-danger py-2 px-3 mb-0 small d-flex align-items-center gap-2">
                <AlertCircle size={14} />
                <span>{modelStatus.message}</span>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => setModelStatus({ phase: "not_loaded" })}
              >
                Try again
              </button>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
