import {
  columnIndex,
  fetchHistoryValuesAcrossProviders,
  type HistoryProviders,
} from '$shared/signalk';
import type { TileDef } from './tile-catalog';
import {
  maximumHistoryId,
  TILE_HISTORY_MIN_SPACING_MS,
  type TileHistory,
  type TileHistoryPoint,
} from './tile-history.svelte';
import {
  type InstrumentHistoryWindows,
  verticalHistoryResolutionSeconds,
  verticalHistoryWindowMinutesFor,
} from './vertical-history-window';

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
  windowMinutes: number,
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
        : { durationSeconds: windowMinutes * 60 }),
      resolutionSeconds: verticalHistoryResolutionSeconds(windowMinutes),
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
  windows: InstrumentHistoryWindows = {},
): Promise<void> {
  if (!source || source.providers.ids.length === 0) return;
  await Promise.all(
    defs.map(async (def) => {
      const windowMinutes = verticalHistoryWindowMinutesFor(windows, def.id);
      const result = await fetchVerticalHistory(
        def,
        source,
        signal,
        windowMinutes,
        fromMs === undefined
          ? undefined
          : {
              fromMs: Math.max(fromMs, completedBeforeMs - windowMinutes * 60_000),
              toMs: completedBeforeMs,
            },
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
  windows: InstrumentHistoryWindows = {},
): () => void {
  if (!source || source.providers.ids.length === 0 || defs.length === 0) return () => undefined;
  const controller = new AbortController();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  for (const def of defs) {
    const windowMinutes = verticalHistoryWindowMinutesFor(windows, def.id);
    const resolutionMs = verticalHistoryResolutionSeconds(windowMinutes) * 1000;
    let previousCompletedBeforeMs: number | undefined;
    const poll = async (): Promise<void> => {
      const completedBeforeMs =
        Math.floor(Date.now() / TILE_HISTORY_MIN_SPACING_MS) * TILE_HISTORY_MIN_SPACING_MS;
      try {
        await backfillVerticalTileHistory(
          history,
          [def],
          source,
          controller.signal,
          completedBeforeMs,
          previousCompletedBeforeMs === undefined
            ? completedBeforeMs - windowMinutes * 60_000
            : previousCompletedBeforeMs - resolutionMs,
          windows,
        );
        previousCompletedBeforeMs = completedBeforeMs;
      } catch {
        // Keep the live buckets moving and try this provider series again on its next interval.
      } finally {
        if (!controller.signal.aborted) {
          const timer = setTimeout(() => {
            timers.delete(timer);
            void poll();
          }, resolutionMs);
          timers.add(timer);
        }
      }
    };
    void poll();
  }
  return () => {
    controller.abort();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
}
