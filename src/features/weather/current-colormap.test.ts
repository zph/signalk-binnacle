import { describe, expect, it } from 'vitest';
import { knotsToMetersPerSecond } from '$shared/lib';
import { currentColor } from './current-colormap';

describe('currentColor', () => {
  it('uses progressively stronger red opacity through two knots and clamps above it', () => {
    const speeds = [0, 0.5, 1, 1.5, 2].map(knotsToMetersPerSecond);
    const colors = speeds.map((speed) => currentColor(speed, 'day'));

    expect(colors.map((color) => color[3])).toEqual([0, 0.16, 0.32, 0.48, 0.64]);
    expect(colors.every(([red, green, blue]) => red > green && red > blue)).toBe(true);
    expect(currentColor(knotsToMetersPerSecond(4), 'day')).toEqual(colors.at(-1));
  });

  it('keeps the night ramp in the red band with no blue light', () => {
    const color = currentColor(knotsToMetersPerSecond(2), 'night-red');
    expect(color[0]).toBeGreaterThan(color[1]);
    expect(color[2]).toBe(0);
    expect(color[3]).toBe(0.48);
  });
});
