import { DEG_TO_RAD } from '$shared/lib';

// The persisted value is the full port-to-starboard sector in radians. Degrees are only used at
// the display edge so profiles remain unit-stable.
export const MIN_WIND_ROSE_NO_GO_ANGLE_RAD = 20 * DEG_TO_RAD;
export const MAX_WIND_ROSE_NO_GO_ANGLE_RAD = 120 * DEG_TO_RAD;
export const DEFAULT_WIND_ROSE_NO_GO_ANGLE_RAD = 40 * DEG_TO_RAD;

export function isWindRoseNoGoAngleRad(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_WIND_ROSE_NO_GO_ANGLE_RAD &&
    value <= MAX_WIND_ROSE_NO_GO_ANGLE_RAD
  );
}
