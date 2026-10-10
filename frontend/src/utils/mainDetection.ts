/**
 * The main detection of a photo: the one the preview draws in green and the one Process crops.
 *
 * It is the selected detection. When nothing valid is selected, or the selected detection is excluded, it is the
 * most confident detection that is not excluded (the first one when two are equally confident). There is none when
 * the photo has no detections or every detection is excluded.
 */
export function mainDetectionIndex(
  detections: ReadonlyArray<{ confidence: number }>,
  selectedIndex: number | null | undefined,
  excluded: ReadonlySet<number>,
): number | null {
  let best: number | null = null;
  for (let i = 0; i < detections.length; i += 1) {
    if (excluded.has(i)) continue;
    if (best === null || detections[i].confidence > detections[best].confidence) {
      best = i;
    }
  }
  if (best === null) return null;

  const selected = selectedIndex ?? null;
  const isValid =
    selected !== null &&
    Number.isInteger(selected) &&
    selected >= 0 &&
    selected < detections.length &&
    !excluded.has(selected);
  return isValid ? selected : best;
}
