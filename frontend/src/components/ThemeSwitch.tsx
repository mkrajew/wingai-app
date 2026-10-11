import type { ReactNode } from "react";
import { useT } from "../i18n";
import SegmentedSwitch from "./SegmentedSwitch";
import type { SegmentedOption } from "./SegmentedSwitch";
import "./ThemeSwitch.css";

export type ThemeMode = "light" | "dark";

function Icon({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <svg
      className={`theme-icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

// The sun is split into named parts so each of them can be animated.
function SunIcon() {
  return (
    <Icon className="theme-icon--sun">
      <g className="halo">
        <path d="M19.5 12L22.2 12M12 19.5L12 22.2M4.5 12L1.8 12M12 4.5L12 1.8" />
        <g fill="currentColor" stroke="none">
          <circle cx="18.15" cy="18.15" r="1.25" />
          <circle cx="5.85" cy="18.15" r="1.25" />
          <circle cx="5.85" cy="5.85" r="1.25" />
          <circle cx="18.15" cy="5.85" r="1.25" />
        </g>
      </g>
      <path
        className="core"
        d="M16.6 12A4.6 4.6 0 1 1 7.4 12A4.6 4.6 0 1 1 16.6 12Z"
      />
    </Icon>
  );
}

function MoonIcon() {
  return (
    <Icon className="theme-icon--moon">
      <path
        className="crescent"
        d="M10.52 3.98A8.1 8.1 0 1 0 20.02 13.48A7.25 7.25 0 0 1 10.52 3.98Z"
      />
    </Icon>
  );
}

type Props = {
  theme: ThemeMode;
  onChange: (theme: ThemeMode) => void;
};

/** The light / dark switch of the header: a sun and a moon on the same pill as the other switches. */
export default function ThemeSwitch({ theme, onChange }: Props) {
  const t = useT();

  const options: SegmentedOption<ThemeMode>[] = [
    { value: "light", label: t.lightMode, icon: <SunIcon /> },
    {
      value: "dark",
      label: t.darkMode,
      icon: <MoonIcon />,
      // The edge of this button is the horizon the moon rises over.
      className: "theme-seg-moon",
    },
  ];

  return (
    <SegmentedSwitch
      label={t.theme}
      options={options}
      value={theme}
      onChange={onChange}
    />
  );
}
