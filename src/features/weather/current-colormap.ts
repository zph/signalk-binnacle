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

export type CurrentPhase = 'ebb' | 'flood' | 'slack' | 'modeled';

const ARROW: Record<Theme, Record<CurrentPhase, string>> = {
  day: {
    ebb: 'rgb(20, 115, 205)',
    flood: 'rgb(209, 20, 15)',
    slack: 'rgb(96, 103, 110)',
    modeled: 'rgb(209, 20, 15)',
  },
  dusk: {
    ebb: 'rgb(54, 169, 232)',
    flood: 'rgb(230, 48, 32)',
    slack: 'rgb(170, 170, 170)',
    modeled: 'rgb(230, 48, 32)',
  },
  'night-red': {
    ebb: 'rgb(112, 10, 0)',
    flood: 'rgb(190, 24, 0)',
    slack: 'rgb(145, 12, 0)',
    modeled: 'rgb(166, 10, 0)',
  },
};

export const currentColor = themedRamp(DAY, NIGHT);

export function currentArrowColor(theme: Theme, phase: CurrentPhase): string {
  return ARROW[theme][phase];
}

export function currentArrowColorExpression(theme: Theme): unknown[] {
  return [
    'match',
    ['get', 'phase'],
    'ebb',
    currentArrowColor(theme, 'ebb'),
    'flood',
    currentArrowColor(theme, 'flood'),
    'slack',
    currentArrowColor(theme, 'slack'),
    currentArrowColor(theme, 'modeled'),
  ];
}

export function currentArrowOpacityExpression(theme: Theme, layerOpacity: number): unknown[] {
  const opacity = Math.max(0, Math.min(1, layerOpacity));
  const stops = DAY.flatMap(([speed]) => [speed, currentColor(speed, theme)[3] * opacity]);
  return [
    'case',
    ['has', 'station'],
    opacity,
    ['interpolate', ['linear'], ['coalesce', ['get', 'speed'], 0], ...stops],
  ];
}
