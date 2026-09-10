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
  sampleBucket(id: string, value: number | undefined, nowMs: number, trackMaximum?: boolean): void;
  merge(id: string, points: readonly TileHistoryPoint[], incomingWins?: boolean): void;
  series(id: string): number[];
  timedSeries(id: string): TileHistoryPoint[];
  prune(liveIds: Set<string>): void;
}

export const TILE_HISTORY_WINDOW_MS = 10 * 60 * 1000;
export const TILE_HISTORY_MIN_SPACING_MS = 5000;
export const TILE_HISTORY_CAPACITY = TILE_HISTORY_WINDOW_MS / TILE_HISTORY_MIN_SPACING_MS + 1;
export const maximumHistoryId = (id: string): string => `${id}:maximum`;

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
  const buckets = new Map<
    string,
    { startMs: number; sum: number; count: number; maximum: number }
  >();

  function upsert(id: string, point: TileHistoryPoint): void {
    if (!buffers[id]) buffers[id] = [];
    const buf = buffers[id];
    const latest = buf.at(-1);
    if (latest?.atMs === point.atMs) latest.value = point.value;
    else buf.push(point);
    if (buf.length > capacity) buf.shift();
  }

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

  // Vertical histories update their open five-second bucket once per shared 1 Hz clock tick. This
  // keeps the live edge responsive while the history provider catches up with finalized averages.
  function sampleBucket(
    id: string,
    value: number | undefined,
    nowMs: number,
    trackMaximum = false,
  ): void {
    if (value === undefined) return;
    const startMs = Math.floor(nowMs / minSpacingMs) * minSpacingMs;
    let bucket = buckets.get(id);
    if (!bucket || bucket.startMs !== startMs) {
      bucket = { startMs, sum: 0, count: 0, maximum: value };
      buckets.set(id, bucket);
    }
    bucket.sum += value;
    bucket.count += 1;
    bucket.maximum = Math.max(bucket.maximum, value);
    upsert(id, { atMs: startMs, value: bucket.sum / bucket.count });
    if (trackMaximum) {
      upsert(maximumHistoryId(id), { atMs: startMs, value: bucket.maximum });
    }
  }

  function merge(id: string, points: readonly TileHistoryPoint[], incomingWins = false): void {
    const combined = new Map<number, TileHistoryPoint>();
    const addPoints = (candidates: readonly TileHistoryPoint[]): void => {
      for (const point of candidates) {
        if (Number.isFinite(point.atMs) && Number.isFinite(point.value)) {
          combined.set(point.atMs, point);
        }
      }
    };
    if (incomingWins) addPoints(buffers[id] ?? []);
    addPoints(points);
    if (!incomingWins) addPoints(buffers[id] ?? []);
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
        delete buffers[maximumHistoryId(id)];
        lastMs.delete(id);
        buckets.delete(id);
      }
    }
  }

  return { sample, sampleBucket, merge, series, timedSeries, prune };
}
