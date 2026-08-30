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
export const MIN_FLOATING_WIDTH = 0.08;
export const MIN_FLOATING_HEIGHT = 0.08;

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

export function defaultFloatingBox(
  at?: { x?: number; y?: number },
  id?: string,
): FloatingInstrumentBox {
  return clampFloatingBox({
    id: id ?? '',
    x: at?.x ?? 0.62,
    y: at?.y ?? 0.12,
    width: DEFAULT_FLOATING_WIDTH,
    height: DEFAULT_FLOATING_HEIGHT,
  });
}
