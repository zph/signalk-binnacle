import { type Rgba, themedRamp } from './color-ramp';

// Standard UV risk breakpoints: low below 3, moderate below 6, high below 8, very high below 11,
// and extreme at 11 or above. Night-red keeps only intensity, because blue and violet are unsafe.
const DAY: Array<[number, Rgba]> = [
  [0, [0.2, 0.7, 0.35, 0]],
  [0.1, [0.2, 0.7, 0.35, 0.3]],
  [3, [0.92, 0.82, 0.2, 0.52]],
  [6, [0.96, 0.5, 0.18, 0.62]],
  [8, [0.88, 0.2, 0.18, 0.7]],
  [11, [0.58, 0.2, 0.7, 0.76]],
];
const NIGHT: Array<[number, Rgba]> = [
  [0, [0.3, 0.03, 0.02, 0]],
  [0.1, [0.3, 0.03, 0.02, 0.24]],
  [3, [0.42, 0.05, 0.03, 0.38]],
  [6, [0.56, 0.07, 0.04, 0.5]],
  [8, [0.68, 0.09, 0.05, 0.6]],
  [11, [0.82, 0.12, 0.06, 0.7]],
];

export const uvColor = themedRamp(DAY, NIGHT);
