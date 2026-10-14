/**
 * Helpers for the list of photos while they are processed one by one.
 *
 * A photo changes its name and its picture on the way (crop, *.dw.png, mirror image), so it is found by an id
 * that stays the same.
 */

let lastId = 0;

/** A new id for a photo. */
export function newImageId(): string {
  lastId += 1;
  return `img-${lastId}`;
}

/**
 * Whether the page is still getting the photos of the upload list ready: a photo that has neither its thumbnail nor
 * the reason why it has none (the picture cannot be read), or neither its size nor the reason why it has none.
 * Process waits for this, so that the list it keeps for "Edit" is complete.
 */
export function photosLoading(
  images: ReadonlyArray<{
    thumbUrl?: string;
    thumbFailed?: boolean;
    width?: number;
    height?: number;
    dimensionsFailed?: boolean;
  }>,
): boolean {
  return images.some(
    (image) =>
      (image.thumbUrl === undefined && !image.thumbFailed) ||
      ((image.width === undefined || image.height === undefined) &&
        !image.dimensionsFailed),
  );
}

/**
 * The list with the detections of Detect put into the photos. Detect takes a while, and meanwhile the photos get
 * their thumbnails and their sizes, and a person may rename a photo, so the result goes into the photos as they are
 * now, not into the copies that Detect started with, and a photo is found by its id, not by its name. A photo
 * whose picture was replaced meanwhile (flipped, rotated) gets nothing, the boxes belong to the old picture.
 */
export function applyDetections<
  T extends { id: string; previewUrl: string; detections?: D },
  D,
>(
  images: T[],
  found: Map<string, { previewUrl: string; detections: D }>,
): T[] {
  return images.map((image) => {
    const result = found.get(image.id);
    return result && result.previewUrl === image.previewUrl
      ? { ...image, detections: result.detections }
      : image;
  });
}

/**
 * The list with the photo that has this id updated by `patch`. The other photos are the same objects. When
 * there is no such photo (it was deleted meanwhile), the very same list comes back, so nothing is rendered.
 */
export function patchImageById<T extends { id: string }>(
  images: T[],
  id: string,
  patch: Partial<T>,
): T[] {
  const index = images.findIndex((image) => image.id === id);
  if (index < 0) return images;
  const next = images.slice();
  next[index] = { ...images[index], ...patch };
  return next;
}
