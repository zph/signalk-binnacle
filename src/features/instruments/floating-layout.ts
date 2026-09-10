import { isFiniteNumber, isRecord } from '$shared/lib';
import { arrayPersistedCodec, createPersistedCodec } from '$shared/settings';

/**
 * One instrument tile placed freely over the chart. Positions and sizes are fractions of the
 * chart area (0..1), so a layout saved on the helm restores proportionally on any display size.
 */
export interface FloatingInstrumentBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MAX_FLOATING_INSTRUMENTS = 12;
export const DEFAULT_FLOATING_WIDTH = 0.26;
export const DEFAULT_FLOATING_HEIGHT = 0.2;
export const VERTICAL_HISTORY_FLOATING_WIDTH = 0.16;
export const VERTICAL_HISTORY_FLOATING_HEIGHT = 0.48;
export const MIN_FLOATING_WIDTH = 0.08;
export const MIN_FLOATING_HEIGHT = 0.08;

/** The tile frame's CSS minimum, kept here so a narrow chart can still fit its saved layout. */
export const MIN_FLOATING_WIDTH_PX = 96;
export const MIN_FLOATING_HEIGHT_PX = 64;

const EDGE_PIN_TOLERANCE = 0.02;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

// The JSON shape of a box, before range checks. A structurally valid but drifted box (a position
// outside the chart area, a size under the readable floor) passes this and migrates through
// sanitize rather than being thrown away.
function isFloatingBoxShape(value: unknown): value is FloatingInstrumentBox {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length <= 256 &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height)
  );
}

/** A box exactly as persisted: correct shape, and every coordinate already inside 0..1 and the readable size floor. Anything looser decodes as migrated after sanitize clamps it. */
export function isFloatingInstrumentBox(value: unknown): value is FloatingInstrumentBox {
  if (!isFloatingBoxShape(value)) return false;
  return (
    value.width >= MIN_FLOATING_WIDTH &&
    value.width <= 1 &&
    value.height >= MIN_FLOATING_HEIGHT &&
    value.height <= 1 &&
    value.x >= 0 &&
    value.x <= 1 - value.width &&
    value.y >= 0 &&
    value.y <= 1 - value.height
  );
}

/** Clamps to the chart area and enforces a minimum readable tile size; a non-box shape is rejected. */
export function sanitizeFloatingInstrumentBox(value: unknown): FloatingInstrumentBox | null {
  if (!isFloatingBoxShape(value)) return null;
  const width = Math.max(MIN_FLOATING_WIDTH, Math.min(1, value.width));
  const height = Math.max(MIN_FLOATING_HEIGHT, Math.min(1, value.height));
  return {
    id: value.id,
    width,
    height,
    x: clamp01(Math.min(value.x, 1 - width)),
    y: clamp01(Math.min(value.y, 1 - height)),
  };
}

export const floatingInstrumentBoxesCodec = arrayPersistedCodec(
  createPersistedCodec(
    isFloatingInstrumentBox,
    (value) => sanitizeFloatingInstrumentBox(value) ?? undefined,
  ),
  { maxItems: MAX_FLOATING_INSTRUMENTS },
);

export function clampFloatingBox(box: FloatingInstrumentBox): FloatingInstrumentBox {
  return sanitizeFloatingInstrumentBox(box) ?? box;
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
