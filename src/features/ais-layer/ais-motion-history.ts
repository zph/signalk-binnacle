import {
  columnIndex,
  fetchHistoryValuesAcrossProviders,
  type HistoryProviders,
  positionFromHistoryRow,
  SK_PATHS,
} from '$shared/signalk';
import type { AisPositionSample } from './ais-motion-estimator';

const HISTORY_DURATION_SECONDS = 75;
const HISTORY_RESOLUTION_SECONDS = 5;
const MAX_HISTORY_AGE_MS = 60_000;

export async function fetchAisMotionHistory(
  origin: string,
  token: string | undefined,
  providers: HistoryProviders,
  context: string,
  now: number,
  signal?: AbortSignal,
): Promise<readonly AisPositionSample[]> {
  if (!context.startsWith('vessels.') || providers.ids.length === 0) return [];
  const result = await fetchHistoryValuesAcrossProviders(origin, token, providers, {
    paths: [SK_PATHS.position],
    durationSeconds: HISTORY_DURATION_SECONDS,
    resolutionSeconds: HISTORY_RESOLUTION_SECONDS,
    context,
    signal,
  });
  if (!result) return [];
  const positionColumn = columnIndex(result.values, SK_PATHS.position);
  const byTimestamp = new Map<number, AisPositionSample>();
  for (const row of result.values.rows) {
    const at = Date.parse(row[0]);
    const position = positionFromHistoryRow(row, positionColumn);
    if (!Number.isFinite(at) || at > now || now - at > MAX_HISTORY_AGE_MS || !position) {
      continue;
    }
    byTimestamp.set(at, { at, ...position });
  }
  return [...byTimestamp.values()].sort((a, b) => a.at - b.at);
}
