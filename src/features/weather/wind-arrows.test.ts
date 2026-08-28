import { describe, expect, it } from 'vitest';
import type { WeatherGrid } from '$entities/weather';
import { windArrowFeatures, windVectorFeatures } from './wind-arrows';

const grid: WeatherGrid = {
  lats: [0, 1],
  lons: [0, 1],
  times: [1000, 4000],
  windU: [
    [-10, -10, -10, -10],
    [-10, -10, -10, -10],
  ],
  windV: [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
};

describe('windArrowFeatures', () => {
  it('draws complete arrowheads toward the wind direction, tagged with speed', () => {
    const fc = windArrowFeatures(grid, { lo: 0, hi: 0, frac: 0 });
    expect(fc.features).toHaveLength(4);
    const coords = (fc.features[0].geometry as GeoJSON.MultiLineString).coordinates;
    expect(coords).toHaveLength(3);
    expect(coords[0][1][0]).toBeLessThan(coords[0][0][0]);
    expect(coords[1][0]).toEqual(coords[0][1]);
    expect(coords[2][0]).toEqual(coords[0][1]);
    expect((fc.features[0].properties as { speed: number }).speed).toBeCloseTo(10, 4);
  });

  it('creates preferred-unit speed labels beside the arrows', () => {
    const vectors = windVectorFeatures(grid, { lo: 0, hi: 0, frac: 0 }, 'kn');
    expect(vectors.markers.features).toHaveLength(4);
    expect(vectors.markers.features[0].properties?.label).toBe('19 kn');
  });

  it('limits a dense provider grid to an even eight-by-six sample', () => {
    const lats = Array.from({ length: 12 }, (_, index) => index);
    const lons = Array.from({ length: 18 }, (_, index) => index);
    const cells = lats.length * lons.length;
    const dense: WeatherGrid = {
      lats,
      lons,
      times: [1000],
      windU: [new Array(cells).fill(5)],
      windV: [new Array(cells).fill(0)],
    };
    const vectors = windVectorFeatures(dense, { lo: 0, hi: 0, frac: 0 }, 'm/s');
    expect(vectors.arrows.features).toHaveLength(48);
    expect(vectors.markers.features).toHaveLength(48);
    const coordinates = vectors.markers.features.map(
      (feature) => (feature.geometry as GeoJSON.Point).coordinates,
    );
    expect(new Set(coordinates.map((position) => position[0])).size).toBe(8);
    expect(new Set(coordinates.map((position) => position[1])).size).toBe(6);
  });

  it('skips near-calm cells', () => {
    const calm: WeatherGrid = {
      ...grid,
      windU: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      windV: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    };
    expect(windArrowFeatures(calm, { lo: 0, hi: 0, frac: 0 }).features).toHaveLength(0);
  });
});
