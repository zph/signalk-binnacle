import type { WayfinderRoutePoint } from './wayfinder-client';

export type WayfinderManeuver = 'Tack' | 'Jibe';

export interface WayfinderLegRow {
  leg: number;
  durationSeconds?: number;
  startTimeMs?: number;
  endTimeMs?: number;
  windSpeedKn?: number;
  windDirectionDeg?: number;
  trueWindAngleDeg?: number;
  windSide?: 'port' | 'starboard';
  maneuver?: WayfinderManeuver;
}

function timeMs(value: string | undefined): number | undefined {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function signedLegWindAngle(
  start: WayfinderRoutePoint,
  end: WayfinderRoutePoint,
): number | undefined {
  if (
    typeof end.heading !== 'number' ||
    !Number.isFinite(end.heading) ||
    typeof start.windDir !== 'number' ||
    !Number.isFinite(start.windDir)
  )
    return undefined;
  return ((((start.windDir - end.heading) % 360) + 540) % 360) - 180;
}

function sailingSideAngle(
  start: WayfinderRoutePoint,
  end: WayfinderRoutePoint,
): number | undefined {
  const signed = signedLegWindAngle(start, end);
  return signed === undefined || Math.abs(signed) < 0.5 || Math.abs(signed) > 179.5
    ? undefined
    : signed;
}

// Classify a side change by the shorter wind-relative path. Crossing the bow is a tack; crossing
// the stern is a jibe. This remains correct when the two legs have unequal wind angles.
function maneuverBetween(
  previousStart: WayfinderRoutePoint,
  currentStart: WayfinderRoutePoint,
  currentEnd: WayfinderRoutePoint,
): WayfinderManeuver | undefined {
  if (currentStart.propulsion !== 'sail' || currentEnd.propulsion !== 'sail') return undefined;
  const previousAngle = sailingSideAngle(previousStart, currentStart);
  const currentAngle = sailingSideAngle(currentStart, currentEnd);
  if (
    previousAngle === undefined ||
    currentAngle === undefined ||
    previousAngle * currentAngle >= 0
  )
    return undefined;
  const bowDistance = Math.abs(previousAngle) + Math.abs(currentAngle);
  const sternDistance = 360 - bowDistance;
  return bowDistance <= sternDistance ? 'Tack' : 'Jibe';
}

export function buildWayfinderLegRows(points: readonly WayfinderRoutePoint[]): WayfinderLegRow[] {
  const rows: WayfinderLegRow[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const startTimeMs = timeMs(start.time);
    const endTimeMs = timeMs(end.time);
    const signedAngle = signedLegWindAngle(start, end);
    const trueWindAngle = signedAngle === undefined ? undefined : Math.abs(signedAngle);
    const sideAngle = sailingSideAngle(start, end);
    const maneuver = index > 1 ? maneuverBetween(points[index - 2], start, end) : undefined;
    rows.push({
      leg: index,
      ...(startTimeMs !== undefined ? { startTimeMs } : {}),
      ...(endTimeMs !== undefined ? { endTimeMs } : {}),
      ...(startTimeMs !== undefined && endTimeMs !== undefined && endTimeMs >= startTimeMs
        ? { durationSeconds: (endTimeMs - startTimeMs) / 1_000 }
        : {}),
      ...(typeof start.tws === 'number' && Number.isFinite(start.tws)
        ? { windSpeedKn: start.tws }
        : {}),
      ...(typeof start.windDir === 'number' && Number.isFinite(start.windDir)
        ? { windDirectionDeg: start.windDir }
        : {}),
      ...(trueWindAngle !== undefined ? { trueWindAngleDeg: trueWindAngle } : {}),
      ...(sideAngle !== undefined ? { windSide: sideAngle > 0 ? 'starboard' : 'port' } : {}),
      ...(maneuver ? { maneuver } : {}),
    });
  }
  return rows;
}
