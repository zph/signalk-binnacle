import { isRecord } from '$shared/lib';

export interface AnchorVertex {
  bearing: number;
  distance: number;
}

export type AnchorZone =
  | { type: 'circle'; radius: number }
  | { type: 'sector'; radius: number; startAngle: number; endAngle: number }
  | { type: 'polygon'; vertices: AnchorVertex[] };

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
