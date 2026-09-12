import {
  type FloatingInstrumentBox,
  MIN_FLOATING_HEIGHT,
  MIN_FLOATING_WIDTH,
  sanitizeFloatingInstrumentBox,
} from '$shared/settings';

export {
  type FloatingInstrumentBox,
  floatingInstrumentBoxesCodec,
  isFloatingInstrumentBox,
  MAX_FLOATING_INSTRUMENTS,
  MIN_FLOATING_HEIGHT,
  MIN_FLOATING_WIDTH,
  sanitizeFloatingInstrumentBox,
} from '$shared/settings';

/**
 * One instrument tile placed freely over the chart. Positions and sizes are fractions of the
 * chart area (0..1), so a layout saved on the helm restores proportionally on any display size.
 */
export const DEFAULT_FLOATING_WIDTH = 0.26;
export const DEFAULT_FLOATING_HEIGHT = 0.2;
export const VERTICAL_HISTORY_FLOATING_WIDTH = 0.16;
export const VERTICAL_HISTORY_FLOATING_HEIGHT = 0.48;
export const FLOATING_GRID_STEP = 0.02;
export const FLOATING_GRID_TOLERANCE = 0.004;

/** The tile frame's CSS minimum, kept here so a narrow chart can still fit its saved layout. */
export const MIN_FLOATING_WIDTH_PX = 96;
export const MIN_FLOATING_HEIGHT_PX = 64;

const EDGE_PIN_TOLERANCE = 0.02;

export function clampFloatingBox(box: FloatingInstrumentBox): FloatingInstrumentBox {
  return sanitizeFloatingInstrumentBox(box) ?? box;
}

function snapGridValue(value: number): number {
  const gridValue = Math.round(value / FLOATING_GRID_STEP) * FLOATING_GRID_STEP;
  return Math.abs(gridValue - value) <= FLOATING_GRID_TOLERANCE ? gridValue : value;
}

/**
 * Applies a small magnetic capture zone to the edit grid. Moving preserves the instrument's size,
 * while resizing snaps its trailing edges so a previously off-grid saved box does not jump.
 */
export function snapFloatingBoxToGrid(
  box: FloatingInstrumentBox,
  mode: 'move' | 'resize',
): FloatingInstrumentBox {
  if (mode === 'move') {
    return clampFloatingBox({ ...box, x: snapGridValue(box.x), y: snapGridValue(box.y) });
  }
  const endX = snapGridValue(box.x + box.width);
  const endY = snapGridValue(box.y + box.height);
  return clampFloatingBox({ ...box, width: endX - box.x, height: endY - box.y });
}

/**
 * Resolves a saved box for the chart's current pixel size without changing the saved layout.
 *
 * A tile's CSS readability floor can be wider than its fractional width after a rotation. Make
 * room for that floor and retain any edge that was already pinned, so right- and bottom-mounted
 * instruments stay on the chart instead of extending past it. Keeping this display-only means a
 * return rotation restores the user's original proportional layout.
 */
export function fitFloatingBoxToViewport(
  box: FloatingInstrumentBox,
  viewport: { width: number; height: number },
  pixelAspectRatio?: number,
): FloatingInstrumentBox {
  if (viewport.width <= 0 || viewport.height <= 0) return clampFloatingBox(box);
  const aspectRatio =
    pixelAspectRatio ?? (box.width * viewport.width) / (box.height * viewport.height);
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return clampFloatingBox(box);
  }

  // A normalized box's area is its fraction of the screen. Solve for a new normalized width and
  // height which retain that area while producing the same physical (pixel) aspect ratio in the
  // new viewport. This keeps an instrument the same shape and visual weight on device rotation.
  const area = box.width * box.height;
  const normalizedAspectRatio = aspectRatio * (viewport.height / viewport.width);
  let width = pixelAspectRatio === undefined ? box.width : Math.sqrt(area * normalizedAspectRatio);
  let height =
    pixelAspectRatio === undefined ? box.height : Math.sqrt(area / normalizedAspectRatio);

  // Apply readability floors uniformly so they cannot stretch the tile. Exact coverage only gives
  // way when a small phone viewport cannot fit the requested readable size at the saved aspect.
  const minimumScale = Math.max(
    1,
    MIN_FLOATING_WIDTH / width,
    MIN_FLOATING_HEIGHT / height,
    MIN_FLOATING_WIDTH_PX / (width * viewport.width),
    MIN_FLOATING_HEIGHT_PX / (height * viewport.height),
  );
  width *= minimumScale;
  height *= minimumScale;
  const maximumScale = Math.min(1, 1 / width, 1 / height);
  width *= maximumScale;
  height *= maximumScale;

  if (width === box.width && height === box.height) return clampFloatingBox(box);

  const pinnedLeft = box.x <= EDGE_PIN_TOLERANCE;
  const pinnedRight = 1 - (box.x + box.width) <= EDGE_PIN_TOLERANCE;
  const pinnedTop = box.y <= EDGE_PIN_TOLERANCE;
  const pinnedBottom = 1 - (box.y + box.height) <= EDGE_PIN_TOLERANCE;
  const centeredX = box.x + box.width / 2 - width / 2;
  const centeredY = box.y + box.height / 2 - height / 2;
  return clampFloatingBox({
    ...box,
    width,
    height,
    x: pinnedLeft ? 0 : pinnedRight ? 1 - width : centeredX,
    y: pinnedTop ? 0 : pinnedBottom ? 1 - height : centeredY,
  });
}

export function defaultFloatingBox(
  at?: { x?: number; y?: number },
  id?: string,
  size?: { width: number; height: number },
): FloatingInstrumentBox {
  return clampFloatingBox({
    id: id ?? '',
    x: at?.x ?? 0.62,
    y: at?.y ?? 0.12,
    width: size?.width ?? DEFAULT_FLOATING_WIDTH,
    height: size?.height ?? DEFAULT_FLOATING_HEIGHT,
  });
}
