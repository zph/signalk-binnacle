import { asNumber, type LatLon } from '$shared/geo';
import { knotsToMetersPerSecond } from '$shared/lib';
import { columnIndex, type HistoryValues, positionFromHistoryRow, SK_PATHS } from '$shared/signalk';

const MAX_SAMPLE_GAP_MS = 2 * 60_000;
const TRACK_GAP_MS = 15 * 60_000;

export interface TripStop {
  position: LatLon;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
}

export interface TripPoint {
  position: LatLon;
  timestamp: number;
}

export interface TripPortion {
  id: string;
  points: readonly TripPoint[];
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  averageSpeedMps: number;
  averageWindAngleRad?: number;
  labelPosition: LatLon;
}

export interface TripDay {
  date: string;
  portions: readonly TripPortion[];
  stops: readonly TripStop[];
  hasTravel: boolean;
}

interface Sample extends TripPoint {
  speedMps: number;
  windAngleRad?: number;
}

function circularAverage(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sin = values.reduce((sum, value) => sum + Math.sin(value), 0);
  const cos = values.reduce((sum, value) => sum + Math.cos(value), 0);
  if (sin === 0 && cos === 0) return undefined;
  return Math.atan2(sin, cos);
}

export function buildTripDay(
  date: string,
  values: HistoryValues,
  speedKnots: number,
  stopMinutes: number,
): TripDay {
  const positionIndex = columnIndex(values, SK_PATHS.position);
  const speedIndex = columnIndex(values, SK_PATHS.speedOverGround);
  const windIndex = columnIndex(values, SK_PATHS.windAngleApparent);
  const thresholdMps = knotsToMetersPerSecond(speedKnots);
  const samples: Sample[] = [];
  if (positionIndex < 0 || speedIndex < 0)
    return { date, portions: [], stops: [], hasTravel: false };

  for (const row of values.rows) {
    const position = positionFromHistoryRow(row, positionIndex);
    const speedMps = asNumber(row[speedIndex + 1]);
    const timestamp = Date.parse(row[0]);
    const windAngleRad = windIndex < 0 ? undefined : asNumber(row[windIndex + 1]);
    if (!position || speedMps === undefined || speedMps < 0 || !Number.isFinite(timestamp))
      continue;
    samples.push({ position, speedMps, timestamp, windAngleRad });
  }
  samples.sort((a, b) => a.timestamp - b.timestamp);

  const stopRanges: Array<{ first: number; last: number; stop: TripStop }> = [];
  let first = -1;
  const finishStop = (last: number): void => {
    if (first < 0) return;
    const durationSeconds = (samples[last].timestamp - samples[first].timestamp) / 1000;
    if (durationSeconds > stopMinutes * 60) {
      stopRanges.push({
        first,
        last,
        stop: {
          position: samples[first].position,
          startedAt: samples[first].timestamp,
          endedAt: samples[last].timestamp,
          durationSeconds,
        },
      });
    }
    first = -1;
  };
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const gap = index > 0 ? sample.timestamp - samples[index - 1].timestamp : 0;
    if (gap > MAX_SAMPLE_GAP_MS) finishStop(index - 1);
    if (sample.speedMps < thresholdMps) first = first < 0 ? index : first;
    else finishStop(index - 1);
  }
  finishStop(samples.length - 1);

  const excluded = new Set<number>();
  for (const range of stopRanges) {
    for (let index = range.first; index <= range.last; index += 1) excluded.add(index);
  }
  const portions: TripPortion[] = [];
  let group: Sample[] = [];
  const finishPortion = (): void => {
    const underway = group.filter((sample) => sample.speedMps > thresholdMps);
    if (group.length < 2 || underway.length === 0) {
      group = [];
      return;
    }
    const startedAt = group[0].timestamp;
    const endedAt = group[group.length - 1].timestamp;
    portions.push({
      id: `${date}-${startedAt}`,
      points: group.map(({ position, timestamp }) => ({ position, timestamp })),
      startedAt,
      endedAt,
      durationSeconds: (endedAt - startedAt) / 1000,
      averageSpeedMps: underway.reduce((sum, sample) => sum + sample.speedMps, 0) / underway.length,
      averageWindAngleRad: circularAverage(
        underway.flatMap((sample) =>
          sample.windAngleRad === undefined ? [] : [sample.windAngleRad],
        ),
      ),
      labelPosition: group[Math.floor(group.length / 2)].position,
    });
    group = [];
  };
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (
      excluded.has(index) ||
      (group.length > 0 && sample.timestamp - group[group.length - 1].timestamp > TRACK_GAP_MS)
    ) {
      finishPortion();
      if (excluded.has(index)) continue;
    }
    group.push(sample);
  }
  finishPortion();

  return {
    date,
    portions,
    stops: stopRanges.map((range) => range.stop),
    hasTravel: portions.length > 0,
  };
}
