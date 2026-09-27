import { isRecord } from '$shared/lib';

export interface AnchorVertex {
  bearing: number;
  distance: number;
}

export type AnchorZone =
  | { type: 'circle'; radius: number }
  | { type: 'sector'; radius: number; startAngle: number; endAngle: number }
  | { type: 'polygon'; vertices: AnchorVertex[] };

interface Point {
  x: number;
  y: number;
}

function polarPoint(bearing: number, distance: number): Point {
  return { x: Math.sin(bearing) * distance, y: Math.cos(bearing) * distance };
}

// The boat and Hoekens vertices share a local anchor-centered plane. Measure to edges,
// because the closest point on a border often lies between its vertices.
export function distanceToZoneBoundaryMeters(
  zone: AnchorZone,
  boatDistance: number,
  boatBearingRad: number,
): number {
  if (zone.type === 'circle') return Math.abs(zone.radius - boatDistance);
  const points =
    zone.type === 'polygon'
      ? zone.vertices.map(({ bearing, distance }) =>
          polarPoint((bearing * Math.PI) / 180, distance),
        )
      : sectorPoints(zone);
  const boat = polarPoint(boatBearingRad, boatDistance);
  let nearest = Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const fraction =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((boat.x - start.x) * dx + (boat.y - start.y) * dy) / lengthSquared),
          );
    nearest = Math.min(
      nearest,
      Math.hypot(start.x + fraction * dx - boat.x, start.y + fraction * dy - boat.y),
    );
  }
  return nearest;
}

function sectorPoints(zone: Extract<AnchorZone, { type: 'sector' }>): Point[] {
  const sweep = (zone.endAngle - zone.startAngle + 360) % 360;
  const count = Math.max(8, Math.ceil(sweep / 5));
  const points: Point[] = [{ x: 0, y: 0 }];
  for (let step = 0; step <= count; step += 1) {
    points.push(
      polarPoint(((zone.startAngle + (sweep * step) / count) * Math.PI) / 180, zone.radius),
    );
  }
  return points;
}

const MAX_RADIUS_M = 1_000_000;

function validDistance(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_RADIUS_M;
}

function validVertexDistance(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_RADIUS_M;
}

function validBearing(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 360;
}

// Keep untrusted Signal K geometry bounded before it reaches map rendering or an anchor command.
export function parseAnchorZone(value: unknown): AnchorZone | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === 'circle' && validDistance(value.radius)) {
    return { type: 'circle', radius: value.radius };
  }
  if (
    value.type === 'sector' &&
    validDistance(value.radius) &&
    validBearing(value.startAngle) &&
    validBearing(value.endAngle)
  ) {
    return {
      type: 'sector',
      radius: value.radius,
      startAngle: value.startAngle,
      endAngle: value.endAngle,
    };
  }
  if (value.type === 'polygon' && Array.isArray(value.vertices)) {
    if (value.vertices.length < 3 || value.vertices.length > 24) return undefined;
    const vertices: AnchorVertex[] = [];
    for (const vertex of value.vertices) {
      if (
        !isRecord(vertex) ||
        !validBearing(vertex.bearing) ||
        !validVertexDistance(vertex.distance)
      ) {
        return undefined;
      }
      vertices.push({ bearing: vertex.bearing, distance: vertex.distance });
    }
    return { type: 'polygon', vertices };
  }
  return undefined;
}
