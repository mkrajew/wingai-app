/**
 * The zoom and the pan of the review screen: which part of the picture is shown. These are plain functions, so that the
 * numbers can be tested; ReviewImages keeps the state and calls them from its event handlers.
 */

export type Pan = { x: number; y: number };

/** The zoom (1 to 3) and how far the shown part is moved from the centre of the picture, in the units of the picture. */
export type View = { zoom: number; pan: Pan };

export const INITIAL_VIEW: View = { zoom: 1, pan: { x: 0, y: 0 } };

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export type ViewGeometry = {
  /** The size of the shown part. */
  zoomedWidth: number;
  zoomedHeight: number;
  /** Where the shown part starts when it is in the centre. */
  zoomedX: number;
  zoomedY: number;
  /** The furthest the shown part can start from the corner. */
  maxPanX: number;
  maxPanY: number;
};

export function viewGeometry(
  viewWidth: number,
  viewHeight: number,
  zoom: number,
): ViewGeometry {
  const zoomedWidth = viewWidth / zoom;
  const zoomedHeight = viewHeight / zoom;
  const zoomedX = (viewWidth - zoomedWidth) / 2;
  const zoomedY = (viewHeight - zoomedHeight) / 2;
  const maxPanX = Math.max(0, viewWidth - zoomedWidth);
  const maxPanY = Math.max(0, viewHeight - zoomedHeight);
  return { zoomedWidth, zoomedHeight, zoomedX, zoomedY, maxPanX, maxPanY };
}

/** Where the shown part starts: the centre moved by the pan, and not beyond the picture. */
export function viewOrigin(geometry: ViewGeometry, pan: Pan): Pan {
  return {
    x: clamp(geometry.zoomedX + pan.x, 0, geometry.maxPanX),
    y: clamp(geometry.zoomedY + pan.y, 0, geometry.maxPanY),
  };
}

/**
 * Sets the zoom. The pan is kept inside the limits of the new zoom, so zooming out brings it back towards the
 * centre and zooming in again does not bring the old position back. The same zoom changes nothing.
 */
export function zoomView(
  view: View,
  zoom: number,
  viewWidth: number,
  viewHeight: number,
): View {
  if (zoom === view.zoom) return view;
  const g = viewGeometry(viewWidth, viewHeight, zoom);
  return {
    zoom,
    pan: {
      x: clamp(g.zoomedX + view.pan.x, 0, g.maxPanX) - g.zoomedX,
      y: clamp(g.zoomedY + view.pan.y, 0, g.maxPanY) - g.zoomedY,
    },
  };
}

/** Ctrl and the wheel: a turn of the wheel upwards (a negative deltaY) zooms in. */
export function wheelView(
  view: View,
  deltaY: number,
  viewWidth: number,
  viewHeight: number,
): View {
  const delta = -deltaY * 0.002;
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom + delta));
  return zoomView(view, zoom, viewWidth, viewHeight);
}

/**
 * Dragging the picture: the shown part moves by (deltaX, deltaY), in the units of the picture, and stays inside it.
 * `geometry` is that of the zoom of the view.
 */
export function dragView(
  view: View,
  deltaX: number,
  deltaY: number,
  geometry: ViewGeometry,
): View {
  const nextX = clamp(geometry.zoomedX + view.pan.x - deltaX, 0, geometry.maxPanX);
  const nextY = clamp(geometry.zoomedY + view.pan.y - deltaY, 0, geometry.maxPanY);
  return {
    zoom: view.zoom,
    pan: { x: nextX - geometry.zoomedX, y: nextY - geometry.zoomedY },
  };
}
