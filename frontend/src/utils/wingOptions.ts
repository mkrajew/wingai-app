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

// The precise model reads wings that lie upright on one side, the right one. It can be used with
// the original orientation, and with the right one, for which the wings are turned to that side
// before it sees them. It cannot be used to orient the wings to the left. So the two choices
// constrain each other and the most recent one wins.

export function chooseModel(options: WingOptions, model: WingModel): WingOptions {
  return {
    model,
    orientation:
      model === "precise" && options.orientation === "left"
        ? "original"
        : options.orientation,
  };
}

export function chooseOrientation(
  options: WingOptions,
  orientation: WingOrientation,
): WingOptions {
  return {
    orientation,
    model:
      orientation === "left" && options.model === "precise"
        ? "rotation"
        : options.model,
  };
}

// What "Process" does with the wings, for the two switches.
export type RequestPlan = {
  // The model the backend is asked to run, for every wing.
  model: WingModel;
  // The side the wings are turned to, from their pixels, before they are sent to the backend
  // ("original": they are not turned).
  orientBefore: WingOrientation;
  // The side the wings are turned to after the backend has answered, from what it says
  // ("original": they are not turned).
  correctAfter: WingOrientation;
};

export function planRequest(options: WingOptions): RequestPlan {
  const { model, orientation } = options;
  if (model === "precise") {
    // The precise model reads upright wings of one side, so they are turned to that side before it
    // sees them, and its answer is not used to turn them again. A wing whose pose cannot be read
    // from its pixels goes to the precise model as it is.
    return {
      model,
      orientBefore: orientation === "right" ? "right" : "original",
      correctAfter: "original",
    };
  }
  return { model, orientBefore: orientation, correctAfter: orientation };
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
