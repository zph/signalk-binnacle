import { describe, expect, it } from 'vitest';
import { knotsToMetersPerSecond } from '$shared/lib';
import {
  currentArrowColor,
  currentArrowColorExpression,
  currentArrowOpacityExpression,
  currentColor,
} from './current-colormap';

describe('currentColor', () => {
  it('uses progressively stronger red opacity through two knots and clamps above it', () => {
    const speeds = [0, 0.5, 1, 1.5, 2].map(knotsToMetersPerSecond);
    const colors = speeds.map((speed) => currentColor(speed, 'day'));

    expect(colors.map((color) => color[3])).toEqual([0.18, 0.38, 0.58, 0.78, 0.96]);
    expect(colors.every(([red, green, blue]) => red > green && red > blue)).toBe(true);
    expect(currentColor(knotsToMetersPerSecond(4), 'day')).toEqual(colors.at(-1));
    expect(currentArrowColor('day', 'modeled')).toBe('rgb(209, 20, 15)');
  });

  it('uses blue for ebb and red for flood while keeping night mode red-only', () => {
    expect(currentArrowColor('day', 'ebb')).toBe('rgb(20, 115, 205)');
    expect(currentArrowColor('day', 'flood')).toBe('rgb(209, 20, 15)');
    expect(currentArrowColor('night-red', 'ebb')).toMatch(/^rgb\(\d+, \d+, 0\)$/);
    expect(currentArrowColor('night-red', 'flood')).toMatch(/^rgb\(\d+, \d+, 0\)$/);

    const expression = currentArrowColorExpression('day');
    expect(expression).toContain('ebb');
    expect(expression).toContain('flood');
  });

  it('keeps the night ramp in the red band with no blue light', () => {
    const color = currentColor(knotsToMetersPerSecond(2), 'night-red');
    expect(color[0]).toBeGreaterThan(color[1]);
    expect(color[2]).toBe(0);
    expect(color[3]).toBe(0.56);
  });

  it('builds a clamped data-driven opacity expression scaled by the layer opacity', () => {
    const expression = currentArrowOpacityExpression('day', 0.5);
    expect(expression.slice(0, 4)).toEqual(['case', ['has', 'station'], 0.5, expect.any(Array)]);
    expect((expression[3] as unknown[]).at(-1)).toBe(0.48);
  });
});
