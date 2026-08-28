import { describe, expect, it } from 'vitest';
import type { WeatherGrid } from '$entities/weather';
import { windSpeedFieldRgba } from './wind-speed-field';

const grid: WeatherGrid = {
  lats: [10, 11],
  lons: [20, 21],
  times: [1, 2],
  windU: [
    [0, 3, 4, Number.NaN],
    [0, 3, 8, Number.NaN],
  ],
  windV: [
    [0, 4, 3, Number.NaN],
    [0, 4, 6, Number.NaN],
  ],
};

describe('windSpeedFieldRgba', () => {
  it('colors the full valid grid and leaves missing cells transparent', () => {
    const field = windSpeedFieldRgba(grid, { lo: 0, hi: 0, frac: 0 }, 'day');
    expect(field?.width).toBe(2);
    expect(field?.height).toBe(2);
    expect(field?.data[3]).toBeGreaterThan(0);
    expect(field?.data[7]).toBe(0);
    expect(field?.data[11]).toBeGreaterThan(0);
    expect(field?.data[15]).toBeGreaterThan(0);
  });

  it('blends vector components between forecast times before deriving speed', () => {
    const early = windSpeedFieldRgba(grid, { lo: 0, hi: 1, frac: 0 }, 'day');
    const late = windSpeedFieldRgba(grid, { lo: 0, hi: 1, frac: 1 }, 'day');
    expect(late?.data.slice(0, 4)).not.toEqual(early?.data.slice(0, 4));
  });
});
