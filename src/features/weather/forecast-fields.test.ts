import { describe, expect, it } from 'vitest';
import type { WeatherGrid } from '$entities/weather';
import { temperatureFieldRgba } from './temperature-field';
import { uvFieldRgba } from './uv-field';

const grid: WeatherGrid = {
  lats: [0, 1],
  lons: [0, 1],
  times: [0],
  windU: [[0, 0, 0, 0]],
  windV: [[0, 0, 0, 0]],
  airTemperature: [[273.15, 283.15, 293.15, 303.15]],
  uvIndex: [[0, 3, 6, 11]],
};

describe('chart forecast scalar fields', () => {
  it('renders temperature and UV grids at the provider resolution', () => {
    const temperature = temperatureFieldRgba(grid, { lo: 0, hi: 0, frac: 0 }, 'day');
    const uv = uvFieldRgba(grid, { lo: 0, hi: 0, frac: 0 }, 'day');
    expect(temperature).toMatchObject({ width: 2, height: 2 });
    expect(uv).toMatchObject({ width: 2, height: 2 });
    expect(temperature?.data).not.toEqual(uv?.data);
  });

  it('keeps both forecasts in the red band for night watch', () => {
    for (const field of [
      temperatureFieldRgba(grid, { lo: 0, hi: 0, frac: 0 }, 'night-red'),
      uvFieldRgba(grid, { lo: 0, hi: 0, frac: 0 }, 'night-red'),
    ]) {
      if (!field) throw new Error('forecast field was not rendered');
      for (let index = 0; index < field.data.length; index += 4) {
        expect(field.data[index]).toBeGreaterThanOrEqual(field.data[index + 1]);
        expect(field.data[index + 1]).toBeGreaterThanOrEqual(field.data[index + 2]);
      }
    }
  });
});
