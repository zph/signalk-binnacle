import { knotsToMetersPerSecond } from '$shared/lib';
import type { Theme } from '$shared/ui';
import { type Rgba, themedRamp } from './color-ramp';

const DAY: Array<[number, Rgba]> = [
  [0, [0.2, 0.55, 0.72, 0]],
  [knotsToMetersPerSecond(0.5), [0.2, 0.55, 0.72, 0.4]],
  [knotsToMetersPerSecond(1), [0.18, 0.72, 0.62, 0.48]],
  [knotsToMetersPerSecond(2), [0.78, 0.78, 0.2, 0.55]],
  [knotsToMetersPerSecond(3), [0.94, 0.48, 0.16, 0.6]],
  [knotsToMetersPerSecond(4), [0.82, 0.18, 0.2, 0.64]],
];
const NIGHT: Array<[number, Rgba]> = [
  [0, [0.28, 0.03, 0.02, 0]],
  [knotsToMetersPerSecond(1), [0.42, 0.04, 0.02, 0.42]],
  [knotsToMetersPerSecond(2), [0.58, 0.06, 0.03, 0.52]],
  [knotsToMetersPerSecond(4), [0.8, 0.1, 0.04, 0.62]],
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
