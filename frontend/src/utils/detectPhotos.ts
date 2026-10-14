/**
 * Detect over a list of photos, one after the other. The result of a photo is handed over as soon as it is there, so
 * the boxes can be shown while the next photos are still being looked at, and not only when the last one is done.
 *
 * A photo that cannot be read is skipped, unless it is the very first one with no result before it: then the run
 * stops and the message comes back (the model is probably not loaded, and every other photo would fail the same way).
 * `onProgress` is called for every photo that was looked at, read or not.
 */
export async function detectPhotos<P extends { previewUrl: string }, D>(
  photos: P[],
  detect: (previewUrl: string) => Promise<D>,
  hooks: {
    onResult: (photo: P, detections: D) => void;
    onProgress: () => void;
  },
): Promise<{ error: string | null }> {
  let found = 0;
  for (const photo of photos) {
    try {
      const detections = await detect(photo.previewUrl);
      found += 1;
      hooks.onResult(photo, detections);
    } catch (error) {
      if (found === 0) {
        return { error: error instanceof Error ? error.message : "Unknown error" };
      }
    } finally {
      hooks.onProgress();
    }
  }
  return { error: null };
}
