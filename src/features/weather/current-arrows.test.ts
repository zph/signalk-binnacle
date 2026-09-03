import { describe, expect, it } from 'vitest';
import type { WeatherGrid } from '$entities/weather';
import { currentVectorFeatures, noaaCurrentVectorFeatures } from './current-arrows';

function gridWithCurrents(): WeatherGrid {
  return {
    lats: [0, 1],
    lons: [0, 1],
    times: [1_000, 2_000],
    windU: [[0, 0, 0, 0]],
    windV: [[0, 0, 0, 0]],
    oceanCurrentSpeed: [
      [0.5, 0.5, 0.5, 0.5],
      [1.5, 1.5, 1.5, 1.5],
    ],
    oceanCurrentDirection: [
      [0, 0, 0, 0],
      [Math.PI, Math.PI, Math.PI, Math.PI],
    ],
  };
}

describe('currentVectorFeatures', () => {
  it('renders the local NOAA prediction at the selected forecast time', () => {
    const result = noaaCurrentVectorFeatures(
      {
        station: { id: 'C1', name: 'Carquinez Strait', latitude: 38.06, longitude: -122.22 },
        distanceMeters: 500,
        events: [
          { timeMs: 1_000, velocityMps: 1, directionRad: Math.PI / 2, kind: 'flood' },
          { timeMs: 2_000, velocityMps: 0, directionRad: undefined, kind: 'slack' },
        ],
      },
      1_500,
      'kn',
    );
    expect(result.arrows.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [-122.22, 38.06],
    });
    expect(result.arrows.features[0].properties?.bearing).toBeCloseTo(90);
    expect(result.markers.features[0].properties?.label).toBe('1.0 kn\nCarquinez Strait');
  });

  it('draws sparse arrows toward the current set and labels speed', () => {
    const result = currentVectorFeatures(gridWithCurrents(), { lo: 0, hi: 0, frac: 0 }, 'kn');
    expect(result.arrows.features).toHaveLength(1);
    expect(result.markers.features).toHaveLength(1);
    const lines = result.arrows.features[0].geometry as GeoJSON.MultiLineString;
    expect(lines.coordinates[0][1][1]).toBeGreaterThan(lines.coordinates[0][0][1]);
    expect(result.markers.features[0].properties?.label).toBe('1.0 kn');
  });

  it('interpolates current speed and direction across a forecast bracket', () => {
    const result = currentVectorFeatures(gridWithCurrents(), { lo: 0, hi: 1, frac: 0.5 }, 'm/s');
    expect(result.arrows.features[0].properties?.speed).toBe(1);
    expect(result.markers.features[0].properties?.label).toBe('1.0 m/s');
  });

  it('returns empty collections when the marine grid has no currents', () => {
    const grid = gridWithCurrents();
    grid.oceanCurrentSpeed = undefined;
    expect(currentVectorFeatures(grid, { lo: 0, hi: 0, frac: 0 }, 'kn')).toEqual({
      arrows: { type: 'FeatureCollection', features: [] },
      markers: { type: 'FeatureCollection', features: [] },
    });
  });
});
