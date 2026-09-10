import { DEFAULT_WIND_ROSE_ARC_MARGIN_RAD } from '$shared/settings';

const CENTER = 500;
const RADIUS = 444;

function point(angleRad: number): { x: number; y: number } {
  return {
    x: CENTER + RADIUS * Math.sin(angleRad),
    y: CENTER - RADIUS * Math.cos(angleRad),
  };
}

function coordinate(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function moveTo(value: { x: number; y: number }): string {
  return `M${coordinate(value.x)} ${coordinate(value.y)}`;
}

function arc(fromRad: number, toRad: number): string {
  const largeArc = toRad - fromRad > Math.PI ? 1 : 0;
  return `${moveTo(point(fromRad))} A${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${coordinate(point(toRad).x)} ${coordinate(point(toRad).y)}`;
}

function radialLine(to: { x: number; y: number }): string {
  return `M${CENTER} ${CENTER} L${coordinate(to.x)} ${coordinate(to.y)}`;
}

export interface WindRoseSectorGeometry {
  fillPath: string;
  portArcPath: string;
  starboardArcPath: string;
  portBoundaryPath: string;
  starboardBoundaryPath: string;
}

export interface WindRoseArcRange {
  portRad: number;
  starboardRad: number;
}

export function windRoseSectorGeometry(
  totalNoGoAngleRad: number,
  arcRange: number | WindRoseArcRange = DEFAULT_WIND_ROSE_ARC_MARGIN_RAD,
): WindRoseSectorGeometry {
  const halfAngleRad = totalNoGoAngleRad / 2;
  const portRad = typeof arcRange === 'number' ? arcRange : arcRange.portRad;
  const starboardRad = typeof arcRange === 'number' ? arcRange : arcRange.starboardRad;
  const portBoundary = point(-halfAngleRad);
  const starboardBoundary = point(halfAngleRad);
  return {
    fillPath: `${arc(-halfAngleRad, halfAngleRad)} L${CENTER} ${CENTER} Z`,
    portArcPath: arc(-halfAngleRad - portRad, -halfAngleRad + starboardRad),
    starboardArcPath: arc(halfAngleRad - portRad, halfAngleRad + starboardRad),
    portBoundaryPath: radialLine(portBoundary),
    starboardBoundaryPath: radialLine(starboardBoundary),
  };
}
