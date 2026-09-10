import {
  columnIndex,
  fetchHistoryValuesAcrossProviders,
  type HistoryProviders,
} from '$shared/signalk';
import type { TileDef } from './tile-catalog';
import {
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

async function fetchVerticalHistory(
  def: TileDef,
  source: VerticalHistorySource,
  signal: AbortSignal,
): Promise<TileHistoryPoint[] | undefined> {
  const paths = candidatePaths(def);
  const result = await fetchHistoryValuesAcrossProviders(
    source.origin,
    source.token,
    source.providers,
    {
      paths,
      durationSeconds: TILE_HISTORY_WINDOW_MS / 1000,
      resolutionSeconds: TILE_HISTORY_MIN_SPACING_MS / 1000,
      signal,
    },
  );
  if (!result) return undefined;

  // Fallback-path instruments use one coherent source, matching their live preference order.
  // Combining water- and ground-referenced angles into one trace would create false turns.
  const column = paths
    .map((path) => columnIndex(result.values, path))
    .find((index) =>
      index === undefined || index < 0
        ? false
        : result.values.rows.some((row) => Number.isFinite(row[index + 1])),
    );
  if (column === undefined || column < 0) return [];

  return result.values.rows.flatMap<TileHistoryPoint>((row) => {
    const atMs = Date.parse(row[0]);
    const value = row[column + 1];
    return Number.isFinite(atMs) && typeof value === 'number' && Number.isFinite(value)
      ? [{ atMs, value }]
      : [];
  });
}

export async function backfillVerticalTileHistory(
  history: TileHistory,
  defs: readonly TileDef[],
  source: VerticalHistorySource | undefined,
  signal: AbortSignal,
): Promise<void> {
  if (!source || source.providers.ids.length === 0) return;
  await Promise.all(
    defs.map(async (def) => {
      const points = await fetchVerticalHistory(def, source, signal);
      if (!signal.aborted && points) history.merge(def.id, points);
    }),
  );
}
