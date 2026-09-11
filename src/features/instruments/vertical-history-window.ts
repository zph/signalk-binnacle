import type { PersistedCodec } from '$shared/settings';

export const VERTICAL_HISTORY_WINDOW_MINUTES = [10, 30, 60, 180, 360, 720, 1_440] as const;
export const DEFAULT_VERTICAL_HISTORY_WINDOW_MINUTES = VERTICAL_HISTORY_WINDOW_MINUTES[0];
export const VERTICAL_HISTORY_POINT_BUDGET = 720;
export const VERTICAL_HISTORY_BUFFER_CAPACITY = VERTICAL_HISTORY_POINT_BUDGET + 121;

export type VerticalHistoryWindowMinutes = (typeof VERTICAL_HISTORY_WINDOW_MINUTES)[number];
export type InstrumentHistoryWindows = Partial<
  Record<'twa-history' | 'tws-history', VerticalHistoryWindowMinutes>
>;

const HISTORY_IDS = ['twa-history', 'tws-history'] as const;

export function isVerticalHistoryWindowMinutes(
  value: unknown,
): value is VerticalHistoryWindowMinutes {
  return VERTICAL_HISTORY_WINDOW_MINUTES.some((candidate) => candidate === value);
}

export function verticalHistoryWindowMinutesFor(
  windows: InstrumentHistoryWindows,
  id: string,
): VerticalHistoryWindowMinutes {
  const value = windows[id as keyof InstrumentHistoryWindows];
  return isVerticalHistoryWindowMinutes(value) ? value : DEFAULT_VERTICAL_HISTORY_WINDOW_MINUTES;
}

export function verticalHistoryWindowLabel(minutes: number): string {
  return minutes < 60 ? `${minutes}m` : `${minutes / 60}h`;
}

export function verticalHistoryResolutionSeconds(minutes: number): number {
  const secondsPerPoint = (minutes * 60) / VERTICAL_HISTORY_POINT_BUDGET;
  return Math.max(5, Math.ceil(secondsPerPoint / 5) * 5);
}

export const instrumentHistoryWindowsCodec: PersistedCodec<InstrumentHistoryWindows> = {
  decode(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { state: 'invalid' };
    const record = value as Record<string, unknown>;
    const windows: InstrumentHistoryWindows = {};
    for (const id of HISTORY_IDS) {
      const candidate = record[id];
      if (candidate === undefined) continue;
      if (!isVerticalHistoryWindowMinutes(candidate)) return { state: 'invalid' };
      windows[id] = candidate;
    }
    const exact = Object.keys(record).every((key) => HISTORY_IDS.includes(key as never));
    return { state: exact ? 'valid' : 'migrated', value: windows };
  },
};
