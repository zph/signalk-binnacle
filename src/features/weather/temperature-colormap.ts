import { type Rgba, themedRamp } from './color-ramp';

// Air temperature in kelvin. Day and dusk run cool blue through green and amber to red. Night-red
// remains a pure dim red intensity scale so forecast colors do not compromise dark adaptation.
const DAY: Array<[number, Rgba]> = [
  [250, [0.2, 0.42, 0.84, 0]],
  [263.15, [0.2, 0.42, 0.84, 0.58]],
  [273.15, [0.18, 0.68, 0.78, 0.58]],
  [283.15, [0.22, 0.72, 0.42, 0.58]],
  [293.15, [0.9, 0.82, 0.24, 0.62]],
  [303.15, [0.94, 0.5, 0.2, 0.68]],
  [313.15, [0.84, 0.2, 0.18, 0.72]],
];
const NIGHT: Array<[number, Rgba]> = [
  [250, [0.3, 0.03, 0.02, 0]],
  [263.15, [0.3, 0.03, 0.02, 0.34]],
  [283.15, [0.45, 0.05, 0.03, 0.45]],
  [303.15, [0.64, 0.08, 0.04, 0.58]],
  [313.15, [0.8, 0.11, 0.05, 0.68]],
];

export const temperatureColor = themedRamp(DAY, NIGHT);
