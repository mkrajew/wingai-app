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
