export interface TileHistoryOptions {
  capacity?: number;
  minSpacingMs?: number;
}

export interface TileHistoryPoint {
  atMs: number;
  value: number;
}

export interface TileHistory {
  sample(id: string, value: number | undefined, nowMs: number): void;
  merge(id: string, points: readonly TileHistoryPoint[]): void;
  series(id: string): number[];
  timedSeries(id: string): TileHistoryPoint[];
  prune(liveIds: Set<string>): void;
}

export const TILE_HISTORY_WINDOW_MS = 10 * 60 * 1000;
export const TILE_HISTORY_MIN_SPACING_MS = 5000;
export const TILE_HISTORY_CAPACITY = TILE_HISTORY_WINDOW_MS / TILE_HISTORY_MIN_SPACING_MS + 1;

export type SessionHistoryViz = 'spark' | 'vertical-speed' | 'vertical-angle';

export function isSessionHistoryViz(viz: string | undefined): viz is SessionHistoryViz {
  return viz === 'spark' || viz === 'vertical-speed' || viz === 'vertical-angle';
}

export function isVerticalHistoryViz(viz: string | undefined): boolean {
  return viz === 'vertical-speed' || viz === 'vertical-angle';
}

// Per-tile ring buffers for sparkline and vertical history. The caller drives sample() from its
// own clock and can merge a stored prefix before live sampling continues.
export function createTileHistory(opts: TileHistoryOptions = {}): TileHistory {
  const capacity = opts.capacity ?? TILE_HISTORY_CAPACITY;
  const minSpacingMs = opts.minSpacingMs ?? TILE_HISTORY_MIN_SPACING_MS;

  // Reactive buffers keyed by tile id, so a component reading either series view re-renders on
  // each append.
  // Deeply reactive on purpose: at one write per tile every minSpacingMs into a buffer of capacity
  // entries, the proxy overhead is nothing next to the ergonomics. If the sampling cadence ever
  // rises materially, this wants $state.raw plus a version counter instead.
  const buffers = $state<Record<string, TileHistoryPoint[]>>({});
  // Last accepted sample time per id; drives the min-spacing throttle and needs no reactivity.
  const lastMs = new Map<string, number>();

  function sample(id: string, value: number | undefined, nowMs: number): void {
    if (value === undefined) return;
    const last = lastMs.get(id);
    if (last !== undefined && nowMs - last < minSpacingMs) return;
    lastMs.set(id, nowMs);
    // Read back through the record so buf is the $state proxy (deep reactivity tracks the
    // mutations); the raw array captured before assignment would mutate invisibly.
    if (!buffers[id]) buffers[id] = [];
    const buf = buffers[id];
    buf.push({ atMs: nowMs, value });
    if (buf.length > capacity) buf.shift();
  }

  function merge(id: string, points: readonly TileHistoryPoint[]): void {
    const combined = new Map<number, TileHistoryPoint>();
    for (const point of points) {
      if (Number.isFinite(point.atMs) && Number.isFinite(point.value)) {
        combined.set(point.atMs, point);
      }
    }
    // A live sample already accepted while the request was in flight wins over a stored sample
    // with the same timestamp.
    for (const point of buffers[id] ?? []) combined.set(point.atMs, point);
    const merged = [...combined.values()]
      .sort((left, right) => left.atMs - right.atMs)
      .slice(-capacity);
    buffers[id] = merged;
    const latest = merged.at(-1);
    if (latest) lastMs.set(id, latest.atMs);
  }

  function series(id: string): number[] {
    return (buffers[id] ?? []).map((point) => point.value);
  }

  function timedSeries(id: string): TileHistoryPoint[] {
    return buffers[id] ?? [];
  }

  function prune(liveIds: Set<string>): void {
    for (const id of Object.keys(buffers)) {
      if (!liveIds.has(id)) {
        delete buffers[id];
        lastMs.delete(id);
      }
    }
  }

  return { sample, merge, series, timedSeries, prune };
}
