import { useState, useEffect, useRef } from "react";
import { HelpCircle } from "lucide-react";

const SHORTCUTS = [
  {
    context: "Image preview",
    rows: [
      { keys: ["←", "→"], description: "Previous / next image" },
      { keys: ["B"], description: "Toggle bounding box on / off" },
      { keys: ["H"], description: "Flip image horizontally (clears detections)" },
      { keys: ["V"], description: "Flip image vertically (clears detections)" },
      { keys: ["N"], description: "Focus filename to rename" },
      { keys: ["Enter"], description: "Confirm rename" },
      { keys: ["Delete"], description: "Delete current image" },
      { keys: ["Esc"], description: "Close preview" },
    ],
  },
  {
    context: "Review view",
    rows: [
      { keys: ["←", "→"], description: "Previous / next result" },
      { keys: ["N"], description: "Focus filename to rename" },
      { keys: ["Enter"], description: "Confirm rename" },
    ],
  },
];

const STEPS = [
  {
    step: "1. Upload images",
    detail: "Drag & drop or click to select images. Supported formats: JPEG, PNG, WebP.",
  },
  {
    step: "2. Load the detection model",
    detail: 'Open "Detection model" in the header and click "Load model". The model is cached in the browser — you only need to do this once.',
  },
  {
    step: "3. Detect objects",
    detail: 'Click "Detect" to run detection on all images. Images already detected or marked as Skip are skipped automatically. You can also detect a single image from its preview.',
  },
  {
    step: "4. Review bounding boxes",
    detail: 'Open a preview to see all detected bounding boxes. The green box is the one used for cropping. Use the checkbox on each box to include/exclude it from extracting. You can also flip the image or extract each detected wing as a separate image.',
  },
  {
    step: "5. Process",
    detail: 'Use the Process/Skip toggle per image to control which images are sent to processing. Skipped images are excluded entirely.',
  },
  {
    step: "6. Review results",
    detail: 'After processing, inspect the results. You can edit landmark positions directly on the image and zoom in and out for precise adjustments.',
  },
  {
    step: "7. Download data",
    detail: 'Export your results in CSV format for spreadsheet analysis, or in Identifly format for direct use in the Identifly workflow.',
  },
];

export default function HelpPanel() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"
        onClick={() => setOpen((v) => !v)}
        aria-label="Help"
      >
        <HelpCircle size={15} />
        <span>Help</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: "min(420px, 90vw)",
            zIndex: 30,
            maxHeight: "80vh",
            overflowY: "auto",
          }}
          className="border rounded shadow bg-body p-3"
        >
          <div className="d-flex justify-content-between align-items-center mb-3">
            <span className="fw-semibold">How to use WingAI</span>
            <button
              type="button"
              className="btn btn-close btn-sm"
              onClick={() => setOpen(false)}
              aria-label="Close help"
            />
          </div>

          {/* Workflow */}
          <p className="small fw-semibold text-muted text-uppercase mb-2" style={{ letterSpacing: "0.05em" }}>
            Workflow
          </p>
          <ol className="ps-3 mb-3" style={{ fontSize: "0.85rem" }}>
            {STEPS.map(({ step, detail }) => (
              <li key={step} className="mb-2">
                <span className="fw-semibold">{step.replace(/^\d+\.\s/, "")}</span>
                <div className="text-muted">{detail}</div>
              </li>
            ))}
          </ol>

          <hr className="my-2" />

          {/* Shortcuts */}
          <p className="small fw-semibold text-muted text-uppercase mb-2" style={{ letterSpacing: "0.05em" }}>
            Keyboard shortcuts
          </p>
          {SHORTCUTS.map(({ context, rows }) => (
            <div key={context} className="mb-3">
              <p className="small fw-semibold mb-1">{context}</p>
              <table className="table table-sm table-borderless mb-0" style={{ fontSize: "0.82rem" }}>
                <tbody>
                  {rows.map(({ keys, description }) => (
                    <tr key={description}>
                      <td className="ps-0" style={{ width: 1, whiteSpace: "nowrap" }}>
                        {keys.map((k) => (
                          <kbd key={k} className="me-1">{k}</kbd>
                        ))}
                      </td>
                      <td className="text-muted">{description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
