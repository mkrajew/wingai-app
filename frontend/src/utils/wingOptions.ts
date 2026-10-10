// What the two header switches have chosen, and how they constrain each other.

// Which landmark model the backend runs. The values are what /analyze takes as
// its `model` field.
export type WingModel = "precise" | "rotation";

// What to do with the wings' orientation: orient all of them to the left or to
// the right, or keep the original one (the middle position of the switch).
export type WingOrientation = "left" | "original" | "right";

export type WingOptions = {
  model: WingModel;
  orientation: WingOrientation;
};

export const DEFAULT_WING_OPTIONS: WingOptions = {
  model: "rotation",
  orientation: "original",
};

// The precise model can only be used on wings in their original orientation, so
// the two choices constrain each other and the most recent one wins.

export function chooseModel(options: WingOptions, model: WingModel): WingOptions {
  return {
    model,
    orientation: model === "precise" ? "original" : options.orientation,
  };
}

export function chooseOrientation(
  options: WingOptions,
  orientation: WingOrientation,
): WingOptions {
  return {
    orientation,
    model:
      orientation !== "original" && options.model === "precise"
        ? "rotation"
        : options.model,
  };
}

// The side to orient the wings to when processing. Only the rotation model gets one,
// the precise model keeps the wings as they are.
export function orientationToApply(options: WingOptions): WingOrientation {
  return options.model === "rotation" ? options.orientation : "original";
}

// The backend says whether a wing is "left" or "right". It has to be mirrored when it is
// on the other side than the wanted one. With no wanted side, or an answer that is not
// one of the two, the wing is left alone.
export function needsMirroring(
  wanted: WingOrientation,
  detected: unknown,
): boolean {
  return (
    (wanted === "left" || wanted === "right") &&
    (detected === "left" || detected === "right") &&
    detected !== wanted
  );
}
