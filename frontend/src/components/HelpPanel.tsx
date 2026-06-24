import { useState, useEffect, useRef } from "react";
import { HelpCircle } from "lucide-react";
import { useT } from "../i18n";

export default function HelpPanel() {
  const t = useT();
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
        aria-label={t.help}
      >
        <HelpCircle size={15} />
        <span>{t.help}</span>
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
            <span className="fw-semibold">{t.howToUse}</span>
            <button
              type="button"
              className="btn btn-close btn-sm"
              onClick={() => setOpen(false)}
              aria-label={t.close}
            />
          </div>

          {/* Workflow */}
          <p className="small fw-semibold text-muted text-uppercase mb-2" style={{ letterSpacing: "0.05em" }}>
            {t.workflowLabel}
          </p>
          <ol className="ps-3 mb-3" style={{ fontSize: "0.85rem" }}>
            {t.steps.map(({ step, detail }) => (
              <li key={step} className="mb-2">
                <span className="fw-semibold">{step}</span>
                <div className="text-muted">{detail}</div>
              </li>
            ))}
          </ol>

          <hr className="my-2" />

          {/* Shortcuts */}
          <p className="small fw-semibold text-muted text-uppercase mb-2" style={{ letterSpacing: "0.05em" }}>
            {t.keyboardShortcutsLabel}
          </p>
          {t.shortcuts.map(({ context, rows }) => (
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
