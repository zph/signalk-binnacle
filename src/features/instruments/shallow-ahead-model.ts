export const SHALLOW_AHEAD_ZOOM = 15;
export const SHALLOW_AHEAD_TILE_SIZE = 512;
export const SHALLOW_AHEAD_SAMPLE_STEP_M = 5;
export const SHALLOW_AHEAD_MAX_DISTANCE_M = 10 * 1852;
export const SHALLOW_AHEAD_LOOKAHEAD_SECONDS = 60 * 60;
export const SHALLOW_AHEAD_MIN_SPEED_MPS = 0.25;

export interface SeascapeTileSource {
  template: string;
  token?: string;
  proxied: boolean;
}

export function draftFromSignalKValues(values: readonly unknown[]): number | undefined {
  for (const raw of values) {
    const value =
      typeof raw === 'object' && raw !== null && 'value' in raw
        ? (raw as { value?: unknown }).value
        : raw;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}
