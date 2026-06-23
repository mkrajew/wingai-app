import { useEffect, useRef, useState } from "react";
import { Globe, Check, ChevronDown } from "lucide-react";
import { useLang } from "../i18n";
import type { Lang } from "../i18n";

type Language = { code: Lang; label: string };

const LANGUAGES: Language[] = [
  { code: "EN", label: "English" },
  { code: "PL", label: "Polski" },
];

export default function LanguageSwitcher() {
  const [open, setOpen] = useState(false);
  const [current, setLang] = useLang();
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
        aria-label="Select language"
        aria-expanded={open}
      >
        <Globe size={15} />
        <span>{current}</span>
        <ChevronDown size={13} style={{ opacity: 0.6, marginLeft: 1 }} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: "130px",
            zIndex: 30,
          }}
          className="border rounded shadow bg-body py-1"
        >
          {LANGUAGES.map(({ code, label }) => (
            <button
              key={code}
              type="button"
              className="btn btn-sm w-100 text-start d-flex align-items-center gap-2 px-3 py-1 rounded-0"
              style={{
                fontSize: "0.85rem",
                background: "none",
                border: "none",
                fontWeight: code === current ? 600 : 400,
              }}
              onClick={() => {
                setLang(code);
                setOpen(false);
              }}
            >
              <Check
                size={13}
                style={{ opacity: code === current ? 1 : 0, flexShrink: 0 }}
              />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
