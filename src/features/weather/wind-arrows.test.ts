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
  it('draws a conventional wind barb toward the wind source, tagged with speed', () => {
    const fc = windArrowFeatures(grid, { lo: 0, hi: 0, frac: 0 });
    expect(fc.features).toHaveLength(4);
    const coords = (fc.features[0].geometry as GeoJSON.MultiLineString).coordinates;
    expect(coords.length).toBeGreaterThan(1);
    expect(coords[0][1][0]).toBeGreaterThan(coords[0][0][0]);
    expect(coords[1]).toHaveLength(2);
    expect((fc.features[0].properties as { speed: number }).speed).toBeCloseTo(10, 4);
  });

  it('creates preferred-unit speed labels beside the arrows', () => {
    const vectors = windVectorFeatures(grid, { lo: 0, hi: 0, frac: 0 }, 'kn');
    expect(vectors.markers.features).toHaveLength(4);
    expect(vectors.markers.features[0].properties?.label).toBe('19 kn');
  });

  it('uses a dense, even sample without oversized barbs', () => {
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
    expect(vectors.arrows.features).toHaveLength(192);
    expect(vectors.markers.features).toHaveLength(192);
    const coordinates = vectors.markers.features.map(
      (feature) => (feature.geometry as GeoJSON.Point).coordinates,
    );
    expect(new Set(coordinates.map((position) => position[0])).size).toBe(16);
    expect(new Set(coordinates.map((position) => position[1])).size).toBe(12);
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
