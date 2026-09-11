import { isFiniteNumber, isRecord } from '$shared/lib';
import { arrayPersistedCodec, createPersistedCodec } from './persisted.svelte';

export interface FloatingInstrumentBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MAX_FLOATING_INSTRUMENTS = 12;
export const MIN_FLOATING_WIDTH = 0.08;
export const MIN_FLOATING_HEIGHT = 0.08;

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

export function isFloatingInstrumentBoxes(value: unknown): value is FloatingInstrumentBox[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_FLOATING_INSTRUMENTS &&
    value.every(isFloatingInstrumentBox) &&
    new Set(value.map((box) => box.id)).size === value.length
  );
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

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
