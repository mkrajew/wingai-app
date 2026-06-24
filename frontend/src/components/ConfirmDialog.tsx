type ConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  closeLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  closeLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div
      role="presentation"
      onClick={onCancel}
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
        aria-label={title}
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
          <h4 className="mb-0">{title}</h4>
          <button
            type="button"
            className="btn btn-close"
            aria-label={closeLabel}
            onClick={onCancel}
          />
        </div>
        <p className="mb-0 text-muted small">{message}</p>
        <div className="d-flex justify-content-end gap-2">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
