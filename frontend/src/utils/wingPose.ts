import type { WingOrientation } from "./wingOptions";

// The direction from landmark 19 to landmark 18 in the mean shape of the backend (models/mean_shape.pth), in
// picture coordinates (x to the right, y down). In that pose, which is the upright right wing, the thick vein
// along the leading edge is at the top, landmarks 1 and 2 are on the left and 16 to 18 on the right.
const MEAN_DIRECTION = { x: 0.832859993, y: 0.137350254 };

/**
 * Whether a wing lies upside down, that is turned by more than 90 degrees from the pose of the mean shape.
 *
 * `vector` holds the landmarks (x1, y1, ..., x19, y19) as the backend answered and `side` is the answer
 * "left" or "right". The backend numbers the landmarks by matching them to the mean shape, so landmark 19 is
 * always the one at the far end of the wing where an upright wing has it and landmark 18 the one at the other end.
 * The direction from 19 to 18 says how the wing is turned. A left wing is the mirror image of the mean shape, so
 * for it the direction of the mean shape is mirrored. Two directions are more than 90 degrees apart when their dot
 * product is negative.
 *
 * Without a known side or with landmarks that are missing or not numbers there is no decision (false).
 */
export function isUpsideDown(vector: number[], side: unknown): boolean {
  if (side !== "left" && side !== "right") return false;
  const x18 = vector[34];
  const y18 = vector[35];
  const x19 = vector[36];
  const y19 = vector[37];
  if (![x18, y18, x19, y19].every(Number.isFinite)) return false;

  const referenceX = side === "left" ? -MEAN_DIRECTION.x : MEAN_DIRECTION.x;
  return (x18 - x19) * referenceX + (y18 - y19) * MEAN_DIRECTION.y < 0;
}

/**
 * Whether a wing has to be turned by 180 degrees. Only when a side is wanted: orienting the wings to the left or
 * to the right also turns them upright. Keeping the original orientation leaves the wings as they are, upside down
 * or not. `detected` is the side that the backend answered, as for needsMirroring.
 */
export function needsRotation(
  wanted: WingOrientation,
  vector: number[],
  detected: unknown,
): boolean {
  return (
    (wanted === "left" || wanted === "right") && isUpsideDown(vector, detected)
  );
}
