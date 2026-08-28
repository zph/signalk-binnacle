import { DEG_TO_RAD } from '$shared/lib';

const CENTER = 500;
const RADIUS = 444;
const OUTER_SECTOR_ANGLE_RAD = 70 * DEG_TO_RAD;

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
  return `${moveTo(point(fromRad))} A${RADIUS} ${RADIUS} 0 0 1 ${coordinate(point(toRad).x)} ${coordinate(point(toRad).y)}`;
}

export interface WindRoseSectorGeometry {
  fillPath: string;
  portArcPath: string;
  starboardArcPath: string;
  portBoundaryPath: string;
  starboardBoundaryPath: string;
}

export function windRoseSectorGeometry(totalNoGoAngleRad: number): WindRoseSectorGeometry {
  const halfAngleRad = totalNoGoAngleRad / 2;
  const portBoundary = point(-halfAngleRad);
  const starboardBoundary = point(halfAngleRad);
  return {
    fillPath: `${arc(-halfAngleRad, halfAngleRad)} L${CENTER} ${CENTER} Z`,
    portArcPath: arc(-OUTER_SECTOR_ANGLE_RAD, -halfAngleRad),
    starboardArcPath: arc(halfAngleRad, OUTER_SECTOR_ANGLE_RAD),
    portBoundaryPath: `${moveTo(portBoundary)} L${CENTER} ${CENTER}`,
    starboardBoundaryPath: `${moveTo(starboardBoundary)} L${CENTER} ${CENTER}`,
  };
}
