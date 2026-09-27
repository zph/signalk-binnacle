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
  speedMps: number;
  windSpeedMps?: number;
  windDirectionRad?: number;
  windAngleApparentRad?: number;
  windReference?: 'true' | 'apparent';
}

export interface TripPortion {
  id: string;
  points: readonly TripPoint[];
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  averageSpeedMps: number;
  averageWindSpeedMps?: number;
  averageWindDirectionRad?: number;
  averageWindAngleRad?: number;
  windReference?: 'true' | 'apparent';
  labelPosition: LatLon;
}

export interface TripDay {
  date: string;
  portions: readonly TripPortion[];
  stops: readonly TripStop[];
  hasTravel: boolean;
}

type Sample = TripPoint;

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
  const windSpeedOverGroundIndex = columnIndex(values, SK_PATHS.windSpeedOverGround);
  const windSpeedTrueIndex = columnIndex(values, SK_PATHS.windSpeedTrue);
  const windSpeedApparentIndex = columnIndex(values, SK_PATHS.windSpeedApparent);
  const windDirectionIndex = columnIndex(values, SK_PATHS.windDirectionTrue);
  const windAngleIndex = columnIndex(values, SK_PATHS.windAngleApparent);
  const headingIndex = columnIndex(values, SK_PATHS.headingTrue);
  const thresholdMps = knotsToMetersPerSecond(speedKnots);
  const samples: Sample[] = [];
  if (positionIndex < 0 || speedIndex < 0)
    return { date, portions: [], stops: [], hasTravel: false };

  for (const row of values.rows) {
    const position = positionFromHistoryRow(row, positionIndex);
    const speedMps = asNumber(row[speedIndex + 1]);
    const timestamp = Date.parse(row[0]);
    const windSpeed = [
      { index: windSpeedOverGroundIndex, reference: 'true' as const },
      { index: windSpeedTrueIndex, reference: 'true' as const },
      { index: windSpeedApparentIndex, reference: 'apparent' as const },
    ].find(({ index }) => {
      const value = index < 0 ? undefined : asNumber(row[index + 1]);
      return value !== undefined && value >= 0;
    });
    const windSpeedMps =
      windSpeed && windSpeed.index >= 0 ? asNumber(row[windSpeed.index + 1]) : undefined;
    const windAngleApparentRad = windAngleIndex < 0 ? undefined : asNumber(row[windAngleIndex + 1]);
    const headingRad = headingIndex < 0 ? undefined : asNumber(row[headingIndex + 1]);
    const directWindDirection =
      windDirectionIndex < 0 ? undefined : asNumber(row[windDirectionIndex + 1]);
    const windDirectionRad =
      directWindDirection ??
      (headingRad === undefined || windAngleApparentRad === undefined
        ? undefined
        : (headingRad + windAngleApparentRad + Math.PI * 2) % (Math.PI * 2));
    if (!position || speedMps === undefined || speedMps < 0 || !Number.isFinite(timestamp))
      continue;
    samples.push({
      position,
      speedMps,
      timestamp,
      windSpeedMps,
      windDirectionRad,
      windAngleApparentRad,
      windReference: windSpeed?.reference,
    });
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
      points: group.map((sample) => ({ ...sample })),
      startedAt,
      endedAt,
      durationSeconds: (endedAt - startedAt) / 1000,
      averageSpeedMps: underway.reduce((sum, sample) => sum + sample.speedMps, 0) / underway.length,
      averageWindSpeedMps: (() => {
        const speeds = underway.flatMap((sample) =>
          sample.windSpeedMps === undefined ? [] : [sample.windSpeedMps],
        );
        return speeds.length > 0
          ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length
          : undefined;
      })(),
      averageWindDirectionRad: circularAverage(
        underway.flatMap((sample) =>
          sample.windDirectionRad === undefined ? [] : [sample.windDirectionRad],
        ),
      ),
      averageWindAngleRad: circularAverage(
        underway.flatMap((sample) =>
          sample.windAngleApparentRad === undefined ? [] : [sample.windAngleApparentRad],
        ),
      ),
      windReference: underway.some((sample) => sample.windReference === 'true')
        ? 'true'
        : underway.some((sample) => sample.windReference === 'apparent')
          ? 'apparent'
          : undefined,
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
