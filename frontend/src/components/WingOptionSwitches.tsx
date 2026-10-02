import type { ReactNode } from "react";
import { useT } from "../i18n";
import type { WingModel, WingOrientation } from "../utils/wingOptions";
import SegmentedSwitch from "./SegmentedSwitch";
import type { SegmentedOption } from "./SegmentedSwitch";
import "./WingOptionSwitches.css";

// Geometry is the same as public/wingai-*.svg. It is inlined (instead of
// <img src>) and split into named parts so each part can be animated.
function Icon({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <svg
      className={`wing-icon ${className}`}
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

function OrientationLeftIcon() {
  return (
    <Icon className="wing-icon--dir wing-icon--left">
      <g className="wing">
        <path d="M21.31 5.73L16.97 15.39A2.52 2.52 0 0 1 13.62 16.64L3.25 11.91A0.5 0.5 0 0 1 2.96 11.5L2.66 7.92A0.5 0.5 0 0 1 2.97 7.41L17.44 1.68A3.02 3.02 0 0 1 21.31 5.73Z" />
        <path d="M15.16 6.36L11.96 8.41M11.96 8.41L12.79 10.89M11.96 8.41L4.39 8.41M11.15 12.62L4.52 10.76" />
        <g fill="currentColor" stroke="none">
          <circle cx="17.31" cy="4.99" r="1.25" />
          <circle cx="13.61" cy="13.3" r="1.25" />
        </g>
      </g>
      <path className="line" pathLength={1} d="M21 20.4H3" />
      <path className="head" d="M4.9 18.5L3 20.4L4.9 22.3" />
    </Icon>
  );
}

function OrientationOriginalIcon() {
  return (
    <Icon className="wing-icon--original">
      <g className="wing">
        <path d="M5.01 13.32L11.41 18.3A2.03 2.03 0 0 0 14.35 17.81L18.8 11.02A0.41 0.41 0 0 0 18.83 10.62L17.56 7.99A0.41 0.41 0 0 0 17.15 7.77L6.23 8.98A2.44 2.44 0 0 0 5.01 13.32Z" />
        <path d="M9.4 11.5L11.91 11.73M11.91 11.73L12.33 13.56M11.91 11.73L16.45 9.11M14.37 14.1L17.37 10.85" />
        <g fill="currentColor" stroke="none">
          <circle cx="7.16" cy="11.29" r="1.05" />
          <circle cx="12.84" cy="15.75" r="1.05" />
        </g>
      </g>
      <g className="corners">
        <path d="M1.5 5.3V3.7A2.2 2.2 0 0 1 3.7 1.5H5.3" />
        <path d="M18.7 1.5H20.3A2.2 2.2 0 0 1 22.5 3.7V5.3" />
        <path d="M22.5 18.7V20.3A2.2 2.2 0 0 1 20.3 22.5H18.7" />
        <path d="M5.3 22.5H3.7A2.2 2.2 0 0 1 1.5 20.3V18.7" />
      </g>
    </Icon>
  );
}

function OrientationRightIcon() {
  return (
    <Icon className="wing-icon--dir wing-icon--right">
      <g className="wing">
        <path d="M2.69 5.73L7.03 15.39A2.52 2.52 0 0 0 10.38 16.64L20.75 11.91A0.5 0.5 0 0 0 21.04 11.5L21.34 7.92A0.5 0.5 0 0 0 21.03 7.41L6.56 1.68A3.02 3.02 0 0 0 2.69 5.73Z" />
        <path d="M8.84 6.36L12.04 8.41M12.04 8.41L11.21 10.89M12.04 8.41L19.61 8.41M12.85 12.62L19.48 10.76" />
        <g fill="currentColor" stroke="none">
          <circle cx="6.69" cy="4.99" r="1.25" />
          <circle cx="10.39" cy="13.3" r="1.25" />
        </g>
      </g>
      <path className="line" pathLength={1} d="M3 20.4H21" />
      <path className="head" d="M19.1 18.5L21 20.4L19.1 22.3" />
    </Icon>
  );
}

function ModelAlignedIcon() {
  return (
    <Icon className="wing-icon--aligned">
      <g className="wing">
        <path d="M2.69 5.93L7.03 15.59A2.52 2.52 0 0 0 10.38 16.84L20.75 12.11A0.5 0.5 0 0 0 21.04 11.7L21.34 8.12A0.5 0.5 0 0 0 21.03 7.61L6.56 1.88A3.02 3.02 0 0 0 2.69 5.93Z" />
        <path d="M8.84 6.56L12.04 8.61M12.04 8.61L11.21 11.09M12.04 8.61L19.61 8.61M12.85 12.82L19.48 10.96" />
        <g fill="currentColor" stroke="none">
          <circle cx="6.69" cy="5.19" r="1.25" />
          <circle cx="10.39" cy="13.5" r="1.25" />
        </g>
      </g>
      <path className="base" d="M3 21H21" />
    </Icon>
  );
}

function ModelRotatedIcon() {
  return (
    <Icon className="wing-icon--rotated">
      <g className="wing">
        <path d="M5.87 12.71L11.41 17.37A1.93 1.93 0 0 0 14.3 16.87L17.7 11.12A0.39 0.39 0 0 0 17.71 10.75L16.48 8.25A0.39 0.39 0 0 0 16.11 8.03L7.2 8.64A2.31 2.31 0 0 0 5.87 12.71Z" />
        <path d="M9.78 11.18L11.72 11.46M11.72 11.46L12.14 13.03M11.72 11.46L15.39 9.35M14.18 13.51L16.32 11.03" />
        <g fill="currentColor" stroke="none">
          <circle cx="7.56" cy="10.85" r="1.05" />
          <circle cx="12.71" cy="15.21" r="1.05" />
        </g>
      </g>
      <g className="arrows">
        <path d="M3.3 7.94A9.6 9.6 0 0 1 20.31 7.2" />
        <path d="M21.05 4.47L20.31 7.2L17.58 6.47" />
        <path d="M20.7 16.06A9.6 9.6 0 0 1 3.69 16.8" />
        <path d="M2.95 19.53L3.69 16.8L6.42 17.53" />
      </g>
    </Icon>
  );
}

type Props = {
  model: WingModel;
  orientation: WingOrientation;
  onModelChange: (model: WingModel) => void;
  onOrientationChange: (orientation: WingOrientation) => void;
};

export default function WingOptionSwitches({
  model,
  orientation,
  onModelChange,
  onOrientationChange,
}: Props) {
  const t = useT();

  const orientationOptions: SegmentedOption<WingOrientation>[] = [
    { value: "left", label: t.orientationLeft, icon: <OrientationLeftIcon /> },
    {
      value: "original",
      label: t.orientationOriginal,
      icon: <OrientationOriginalIcon />,
    },
    {
      value: "right",
      label: t.orientationRight,
      icon: <OrientationRightIcon />,
    },
  ];

  const modelOptions: SegmentedOption<WingModel>[] = [
    { value: "precise", label: t.wingModelAligned, icon: <ModelAlignedIcon /> },
    { value: "rotation", label: t.wingModelRotated, icon: <ModelRotatedIcon /> },
  ];

  return (
    <>
      <SegmentedSwitch
        label={t.orientation}
        options={orientationOptions}
        value={orientation}
        onChange={onOrientationChange}
      />
      <SegmentedSwitch
        label={t.wingModel}
        options={modelOptions}
        value={model}
        onChange={onModelChange}
      />
    </>
  );
}
