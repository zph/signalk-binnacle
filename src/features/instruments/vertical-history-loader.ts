import {
  columnIndex,
  fetchHistoryValuesAcrossProviders,
  type HistoryProviders,
} from '$shared/signalk';
import type { TileDef } from './tile-catalog';
import {
  maximumHistoryId,
  TILE_HISTORY_MIN_SPACING_MS,
  TILE_HISTORY_WINDOW_MS,
  type TileHistory,
  type TileHistoryPoint,
} from './tile-history.svelte';

interface VerticalHistorySource {
  origin: string;
  token?: string;
  providers: HistoryProviders;
}

function candidatePaths(def: TileDef): readonly string[] {
  return def.viz === 'vertical-speed' ? [def.zonesPath] : def.paths;
}

interface VerticalHistoryResult {
  average: TileHistoryPoint[];
  maximum?: TileHistoryPoint[];
}

async function fetchVerticalHistory(
  def: TileDef,
  source: VerticalHistorySource,
  signal: AbortSignal,
  range?: { fromMs: number; toMs: number },
): Promise<VerticalHistoryResult | undefined> {
  const paths = candidatePaths(def);
  const requestedPaths =
    def.viz === 'vertical-speed'
      ? [`${paths[0]}:average`, `${paths[0]}:max`]
      : paths.map((path) => `${path}:average`);
  const result = await fetchHistoryValuesAcrossProviders(
    source.origin,
    source.token,
    source.providers,
    {
      paths: requestedPaths,
      ...(range
        ? {
            from: new Date(range.fromMs).toISOString(),
            to: new Date(range.toMs).toISOString(),
          }
        : { durationSeconds: TILE_HISTORY_WINDOW_MS / 1000 }),
      resolutionSeconds: TILE_HISTORY_MIN_SPACING_MS / 1000,
      signal,
    },
  );
  if (!result) return undefined;

  // Fallback-path instruments use one coherent source, matching their live preference order.
  // Combining water- and ground-referenced angles into one trace would create false turns.
  const column = paths
    .map((path) => columnIndex(result.values, path, 'average'))
    .find((index) =>
      index === undefined || index < 0
        ? false
        : result.values.rows.some((row) => Number.isFinite(row[index + 1])),
    );
  if (column === undefined || column < 0) return { average: [] };

  const pointsAt = (index: number): TileHistoryPoint[] =>
    result.values.rows.flatMap<TileHistoryPoint>((row) => {
      const atMs = Date.parse(row[0]);
      const value = row[index + 1];
      return Number.isFinite(atMs) && typeof value === 'number' && Number.isFinite(value)
        ? [{ atMs, value }]
        : [];
    });
  const maximumColumn =
    def.viz === 'vertical-speed' ? columnIndex(result.values, paths[0], 'max') : -1;
  return {
    average: pointsAt(column),
    maximum: maximumColumn >= 0 && maximumColumn !== column ? pointsAt(maximumColumn) : undefined,
  };
}

export async function backfillVerticalTileHistory(
  history: TileHistory,
  defs: readonly TileDef[],
  source: VerticalHistorySource | undefined,
  signal: AbortSignal,
  completedBeforeMs = Number.POSITIVE_INFINITY,
  fromMs?: number,
): Promise<void> {
  if (!source || source.providers.ids.length === 0) return;
  await Promise.all(
    defs.map(async (def) => {
      const result = await fetchVerticalHistory(
        def,
        source,
        signal,
        fromMs === undefined ? undefined : { fromMs, toMs: completedBeforeMs },
      );
      if (signal.aborted || !result) return;
      const completed = (points: readonly TileHistoryPoint[]): TileHistoryPoint[] =>
        points.filter((point) => point.atMs < completedBeforeMs);
      history.merge(def.id, completed(result.average), true);
      if (result.maximum) {
        history.merge(maximumHistoryId(def.id), completed(result.maximum), true);
      }
    }),
  );
}

export function pollVerticalTileHistory(
  history: TileHistory,
  defs: readonly TileDef[],
  source: VerticalHistorySource | undefined,
): () => void {
  if (!source || source.providers.ids.length === 0 || defs.length === 0) return () => undefined;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previousCompletedBeforeMs: number | undefined;
  const poll = async (): Promise<void> => {
    const completedBeforeMs =
      Math.floor(Date.now() / TILE_HISTORY_MIN_SPACING_MS) * TILE_HISTORY_MIN_SPACING_MS;
    try {
      await backfillVerticalTileHistory(
        history,
        defs,
        source,
        controller.signal,
        completedBeforeMs,
        previousCompletedBeforeMs === undefined
          ? completedBeforeMs - TILE_HISTORY_WINDOW_MS
          : previousCompletedBeforeMs - TILE_HISTORY_MIN_SPACING_MS,
      );
      previousCompletedBeforeMs = completedBeforeMs;
    } catch {
      // Keep the live buckets moving and try the provider again on the next interval.
    } finally {
      if (!controller.signal.aborted) timer = setTimeout(poll, TILE_HISTORY_MIN_SPACING_MS);
    }
  };
  void poll();
  return () => {
    controller.abort();
    if (timer !== undefined) clearTimeout(timer);
  };
}
