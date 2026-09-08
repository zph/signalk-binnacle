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

function signedWindAngle(point: WayfinderRoutePoint): number | undefined {
  if (
    typeof point.heading !== 'number' ||
    !Number.isFinite(point.heading) ||
    typeof point.windDir !== 'number' ||
    !Number.isFinite(point.windDir)
  )
    return undefined;
  const signed = ((((point.windDir - point.heading) % 360) + 540) % 360) - 180;
  return Math.abs(signed) < 0.5 || Math.abs(signed) > 179.5 ? undefined : signed;
}

// Classify a side change by the shorter wind-relative path. Crossing the bow is a tack; crossing
// the stern is a jibe. This remains correct when the two legs have unequal wind angles.
function maneuverBetween(
  previous: WayfinderRoutePoint,
  current: WayfinderRoutePoint,
): WayfinderManeuver | undefined {
  if (previous.propulsion !== 'sail' || current.propulsion !== 'sail') return undefined;
  const previousAngle = signedWindAngle(previous);
  const currentAngle = signedWindAngle(current);
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
    const signedAngle = signedWindAngle(end);
    const maneuver = index > 1 ? maneuverBetween(start, end) : undefined;
    rows.push({
      leg: index,
      ...(startTimeMs !== undefined ? { startTimeMs } : {}),
      ...(endTimeMs !== undefined ? { endTimeMs } : {}),
      ...(startTimeMs !== undefined && endTimeMs !== undefined && endTimeMs >= startTimeMs
        ? { durationSeconds: (endTimeMs - startTimeMs) / 1_000 }
        : {}),
      ...(typeof end.tws === 'number' && Number.isFinite(end.tws) ? { windSpeedKn: end.tws } : {}),
      ...(typeof end.windDir === 'number' && Number.isFinite(end.windDir)
        ? { windDirectionDeg: end.windDir }
        : {}),
      ...(typeof end.twa === 'number' && Number.isFinite(end.twa)
        ? { trueWindAngleDeg: end.twa }
        : {}),
      ...(signedAngle !== undefined ? { windSide: signedAngle > 0 ? 'starboard' : 'port' } : {}),
      ...(maneuver ? { maneuver } : {}),
    });
  }
  return rows;
}
