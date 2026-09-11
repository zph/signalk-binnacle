import { knotsToMetersPerSecond } from '$shared/lib';
import type { Theme } from '$shared/ui';
import { type Rgba, themedRamp } from './color-ramp';

const DAY: Array<[number, Rgba]> = [
  [0, [0.82, 0.08, 0.06, 0.18]],
  [knotsToMetersPerSecond(0.5), [0.82, 0.08, 0.06, 0.38]],
  [knotsToMetersPerSecond(1), [0.82, 0.08, 0.06, 0.58]],
  [knotsToMetersPerSecond(1.5), [0.82, 0.08, 0.06, 0.78]],
  [knotsToMetersPerSecond(2), [0.82, 0.08, 0.06, 0.96]],
];
const NIGHT: Array<[number, Rgba]> = [
  [0, [0.65, 0.04, 0, 0.08]],
  [knotsToMetersPerSecond(0.5), [0.65, 0.04, 0, 0.18]],
  [knotsToMetersPerSecond(1), [0.65, 0.04, 0, 0.3]],
  [knotsToMetersPerSecond(1.5), [0.65, 0.04, 0, 0.42]],
  [knotsToMetersPerSecond(2), [0.65, 0.04, 0, 0.56]],
];

const ARROW: Record<Theme, string> = {
  day: 'rgb(209, 20, 15)',
  dusk: 'rgb(230, 48, 32)',
  'night-red': 'rgb(166, 10, 0)',
};

export const currentColor = themedRamp(DAY, NIGHT);

export function currentArrowColor(theme: Theme): string {
  return ARROW[theme];
}

export function currentArrowOpacityExpression(theme: Theme, layerOpacity: number): unknown[] {
  const opacity = Math.max(0, Math.min(1, layerOpacity));
  const stops = DAY.flatMap(([speed]) => [speed, currentColor(speed, theme)[3] * opacity]);
  return ['interpolate', ['linear'], ['coalesce', ['get', 'speed'], 0], ...stops];
}
