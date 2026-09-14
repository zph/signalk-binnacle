import { isRecord, isUnsafeProviderKey } from '$shared/lib';
import { type FloatingInstrumentBox, isFloatingInstrumentBoxes } from './floating-instruments';
import { createPersistedCodec } from './persisted.svelte';
import { isWindRoseArcMarginRad, isWindRoseNoGoAngleRad } from './wind-rose';

export interface InstrumentLayoutSnapshot {
  tiles: string[];
  boxes: FloatingInstrumentBox[];
  sizes: Record<string, 'normal' | 'wide' | 'tall' | 'large'>;
  history: Record<string, number>;
  opacity: number;
  radarRange: number;
  noGo: number;
  arcMargin: number;
}

export interface InstrumentLayoutSet {
  active: string;
  layouts: Array<{ id: string; name: string; snapshot: InstrumentLayoutSnapshot }>;
}

const boundedId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 256 &&
  Array.from(value).every((char) => char.charCodeAt(0) >= 32) &&
  !isUnsafeProviderKey(value);

function validMap(value: unknown, accepts: (value: unknown) => boolean): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length <= 100 &&
    Object.entries(value).every(([key, entry]) => boundedId(key) && accepts(entry))
  );
}

function isInstrumentLayoutSnapshot(value: unknown): value is InstrumentLayoutSnapshot {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.tiles) &&
    value.tiles.length <= 100 &&
    value.tiles.every(boundedId) &&
    new Set(value.tiles).size === value.tiles.length &&
    isFloatingInstrumentBoxes(value.boxes) &&
    validMap(value.sizes, (v) => ['normal', 'wide', 'tall', 'large'].includes(v as string)) &&
    validMap(value.history, (v) => [10, 30, 60, 180, 360, 720, 1440].includes(v as number)) &&
    typeof value.opacity === 'number' &&
    value.opacity >= 0.2 &&
    value.opacity <= 1 &&
    [0.5, 1, 2, 3, 6, 12, 24].includes(value.radarRange as number) &&
    isWindRoseNoGoAngleRad(value.noGo) &&
    isWindRoseArcMarginRad(value.arcMargin)
  );
}

export function isInstrumentLayoutSet(value: unknown): value is InstrumentLayoutSet {
  if (!isRecord(value) || !Array.isArray(value.layouts) || value.layouts.length > 20) return false;
  if (value.layouts.length === 0) return value.active === '';
  return (
    boundedId(value.active) &&
    value.layouts.every(
      (layout) =>
        isRecord(layout) &&
        boundedId(layout.id) &&
        typeof layout.name === 'string' &&
        layout.name.trim().length > 0 &&
        layout.name.length <= 60 &&
        Array.from(layout.name).every((char) => char.charCodeAt(0) >= 32) &&
        isInstrumentLayoutSnapshot(layout.snapshot),
    ) &&
    new Set(value.layouts.map((layout) => layout.id)).size === value.layouts.length &&
    value.layouts.some((layout) => layout.id === value.active)
  );
}

export const instrumentLayoutSetCodec = createPersistedCodec(isInstrumentLayoutSet);
