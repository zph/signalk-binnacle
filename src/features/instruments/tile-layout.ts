import { createPersistedCodec, type PersistedCodec } from '$shared/settings';

export const INSTRUMENT_TILE_SIZES = ['normal', 'wide', 'tall', 'large'] as const;
export type InstrumentTileSize = (typeof INSTRUMENT_TILE_SIZES)[number];
export type InstrumentTileLayouts = Record<string, InstrumentTileSize>;

export const MAX_INSTRUMENT_TILE_LAYOUTS = 100;

export function isInstrumentTileSize(value: unknown): value is InstrumentTileSize {
  return typeof value === 'string' && (INSTRUMENT_TILE_SIZES as readonly string[]).includes(value);
}

export function isInstrumentTileLayouts(value: unknown): value is InstrumentTileLayouts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_INSTRUMENT_TILE_LAYOUTS &&
    entries.every(
      ([id, size]) =>
        id.length > 0 &&
        id.length <= 512 &&
        !id.includes('\u0000') &&
        id !== '__proto__' &&
        id !== 'prototype' &&
        id !== 'constructor' &&
        isInstrumentTileSize(size),
    )
  );
}

export const instrumentTileLayoutsCodec: PersistedCodec<InstrumentTileLayouts> =
  createPersistedCodec(isInstrumentTileLayouts);

export function instrumentTileSizeFor(
  layouts: InstrumentTileLayouts,
  id: string,
): InstrumentTileSize {
  return layouts[id] ?? 'normal';
}

export function resizeInstrumentTile(
  size: InstrumentTileSize,
  horizontal: number,
  vertical: number,
): InstrumentTileSize {
  const columns = size === 'wide' || size === 'large' ? 2 : 1;
  const rows = size === 'tall' || size === 'large' ? 2 : 1;
  const nextColumns = horizontal > 0 ? 2 : horizontal < 0 ? 1 : columns;
  const nextRows = vertical > 0 ? 2 : vertical < 0 ? 1 : rows;
  if (nextColumns === 2 && nextRows === 2) return 'large';
  if (nextColumns === 2) return 'wide';
  if (nextRows === 2) return 'tall';
  return 'normal';
}
