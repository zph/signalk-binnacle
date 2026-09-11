import { knotsToMetersPerSecond } from '$shared/lib';
import type { Theme } from '$shared/ui';
import { type Rgba, themedRamp } from './color-ramp';

const DAY: Array<[number, Rgba]> = [
  [0, [0.82, 0.08, 0.06, 0]],
  [knotsToMetersPerSecond(0.5), [0.82, 0.08, 0.06, 0.16]],
  [knotsToMetersPerSecond(1), [0.82, 0.08, 0.06, 0.32]],
  [knotsToMetersPerSecond(1.5), [0.82, 0.08, 0.06, 0.48]],
  [knotsToMetersPerSecond(2), [0.82, 0.08, 0.06, 0.64]],
];
const NIGHT: Array<[number, Rgba]> = [
  [0, [0.65, 0.04, 0, 0]],
  [knotsToMetersPerSecond(0.5), [0.65, 0.04, 0, 0.12]],
  [knotsToMetersPerSecond(1), [0.65, 0.04, 0, 0.24]],
  [knotsToMetersPerSecond(1.5), [0.65, 0.04, 0, 0.36]],
  [knotsToMetersPerSecond(2), [0.65, 0.04, 0, 0.48]],
];

const ARROW: Record<Theme, string> = {
  day: 'rgba(20, 35, 50, 0.88)',
  dusk: 'rgba(210, 220, 235, 0.88)',
  'night-red': 'rgba(200, 50, 35, 0.9)',
};

export const currentColor = themedRamp(DAY, NIGHT);

export function currentArrowColor(theme: Theme): string {
  return ARROW[theme];
}
