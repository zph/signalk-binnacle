import type { TripPoint, TripPortion } from '$features/tracks';
import { formatKnotsOr, metersPerSecondToKnots, radiansToBearing } from '$shared/lib';

const MIN_ANNOTATIONS = 6;
const MAX_ANNOTATIONS = 28;
const TARGET_LABEL_WIDTH_PX = 116;
const BARB_LENGTH_PX = 24;
const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;

export interface HistoryTrackAnnotation extends TripPoint {
  timeLabel: string;
  conditionsLabel: string;
  detailLabel: string;
}

function uniqueByTimestamp(points: readonly TripPoint[]): TripPoint[] {
  return [...new Map(points.map((point) => [point.timestamp, point])).values()].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
}

function evenlySpaced<T>(values: readonly T[], count: number): T[] {
  if (values.length <= count) return [...values];
  if (count <= 1) return [values[0]];
  return Array.from({ length: count }, (_, index) => {
    const source = Math.round((index * (values.length - 1)) / (count - 1));
    return values[source];
  });
}

export function annotationCapacity(width: number): number {
  if (!(width > 0)) return 12;
  return Math.max(
    MIN_ANNOTATIONS,
    Math.min(MAX_ANNOTATIONS, Math.round(width / TARGET_LABEL_WIDTH_PX)),
  );
}

export function selectAnnotationPoints(
  portions: readonly TripPortion[],
  capacity: number,
): TripPoint[] {
  if (capacity <= 0) return [];
  const candidates: TripPoint[] = [];
  const totalDuration = portions.reduce((sum, portion) => sum + portion.durationSeconds, 0);
  for (const portion of portions) {
    if (portion.points.length === 0) continue;
    const share =
      totalDuration > 0
        ? Math.round((capacity * portion.durationSeconds) / totalDuration)
        : Math.round(capacity / Math.max(1, portions.length));
    candidates.push(...evenlySpaced(portion.points, Math.max(2, share)));
  }
  return evenlySpaced(uniqueByTimestamp(candidates), capacity);
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function detailTimeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function directionLabel(directionRad: number | undefined): string | undefined {
  const degrees = radiansToBearing(directionRad);
  return degrees === undefined ? undefined : `${Math.round(degrees).toString().padStart(3, '0')}°T`;
}

export function annotationFor(point: TripPoint): HistoryTrackAnnotation {
  const time = timeLabel(point.timestamp);
  const windName = point.windReference === 'apparent' ? 'AWS' : 'TWS';
  const wind =
    point.windSpeedMps === undefined
      ? undefined
      : `${windName} ${formatKnotsOr(point.windSpeedMps)} kn`;
  const conditionsLabel = [wind, `SOG ${formatKnotsOr(point.speedMps)} kn`]
    .filter((value): value is string => value !== undefined)
    .join(' · ');
  const direction = directionLabel(point.windDirectionRad);
  return {
    ...point,
    timeLabel: time,
    conditionsLabel,
    detailLabel: [
      detailTimeLabel(point.timestamp),
      wind,
      direction ? `Wind ${direction}` : undefined,
      `SOG ${formatKnotsOr(point.speedMps)} kn`,
    ]
      .filter((value): value is string => value !== undefined)
      .join(' · '),
  };
}

function offsetCoordinate(
  point: TripPoint['position'],
  eastMeters: number,
  northMeters: number,
): GeoJSON.Position {
  const latitudeRadians = (point.latitude * Math.PI) / 180;
  const latitude = point.latitude + (northMeters / EARTH_CIRCUMFERENCE_METERS) * 360;
  const longitude =
    point.longitude +
    (eastMeters / (EARTH_CIRCUMFERENCE_METERS * Math.max(0.01, Math.cos(latitudeRadians)))) * 360;
  return [longitude, latitude];
}

export function windBarbGeometry(
  point: TripPoint,
  zoom: number,
): GeoJSON.MultiLineString | undefined {
  if (point.windDirectionRad === undefined || point.windSpeedMps === undefined) return undefined;
  const latitudeRadians = (point.position.latitude * Math.PI) / 180;
  const metersPerPixel =
    (Math.cos(latitudeRadians) * EARTH_CIRCUMFERENCE_METERS) / (512 * 2 ** zoom);
  const length = Math.max(1, metersPerPixel * BARB_LENGTH_PX);
  const east = Math.sin(point.windDirectionRad);
  const north = Math.cos(point.windDirectionRad);
  const start = offsetCoordinate(point.position, 0, 0);
  const end = offsetCoordinate(point.position, east * length, north * length);
  const featherLength = length * 0.32;
  const featherCount = Math.max(
    0,
    Math.min(10, Math.round((metersPerSecondToKnots(point.windSpeedMps) ?? 0) / 5)),
  );
  const coordinates: GeoJSON.Position[][] = [[start, end]];
  for (let feather = 0; feather < featherCount; feather += 1) {
    const along = Math.min(0.88, 0.18 + feather * 0.14);
    const shaftEast = east * length * (1 - along);
    const shaftNorth = north * length * (1 - along);
    const shaft = offsetCoordinate(point.position, shaftEast, shaftNorth);
    coordinates.push([
      shaft,
      offsetCoordinate(
        point.position,
        shaftEast - north * featherLength,
        shaftNorth + east * featherLength,
      ),
    ]);
  }
  return { type: 'MultiLineString', coordinates };
}
