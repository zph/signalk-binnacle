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
    expect(result.arrows.features[0].properties?.phase).toBe('flood');
    expect(result.markers.features[0].properties?.label).toBe('Flood · 1.0 kn\nCarquinez Strait');
  });

  it('carries the NOAA ebb phase into both the arrow color key and visible label', () => {
    const result = noaaCurrentVectorFeatures(
      {
        station: { id: 'C2', name: 'Golden Gate', latitude: 37.82, longitude: -122.48 },
        distanceMeters: 400,
        events: [{ timeMs: 1_000, velocityMps: 1.2, directionRad: Math.PI, kind: 'ebb' }],
      },
      1_000,
      'kn',
    );

    expect(result.arrows.features[0].properties?.phase).toBe('ebb');
    expect(result.markers.features[0].properties?.label).toBe('Ebb · 2.3 kn\nGolden Gate');
  });

  it('draws fixed-size arrow points toward the current set and labels speed', () => {
    const result = currentVectorFeatures(gridWithCurrents(), { lo: 0, hi: 0, frac: 0 }, 'kn');
    expect(result.arrows.features).toHaveLength(4);
    expect(result.markers.features).toHaveLength(4);
    expect(result.arrows.features[0].geometry).toEqual({ type: 'Point', coordinates: [0, 0] });
    expect(result.arrows.features[0].properties?.bearing).toBe(0);
    expect(result.arrows.features[0].properties?.phase).toBe('modeled');
    expect(result.markers.features[0].properties?.label).toBe('1.0 kn');
  });

  it('interpolates current speed and direction across a forecast bracket', () => {
    const result = currentVectorFeatures(gridWithCurrents(), { lo: 0, hi: 1, frac: 0.5 }, 'm/s');
    expect(result.arrows.features[0].properties?.speed).toBe(1);
    expect(result.arrows.features[0].properties?.bearing).toBeCloseTo(90);
    expect(result.markers.features[0].properties?.label).toBe('1.0 m/s');
  });

  it('can skip unused speed labels for the persistent chart overlay', () => {
    const result = currentVectorFeatures(
      gridWithCurrents(),
      { lo: 0, hi: 0, frac: 0 },
      'kn',
      false,
    );
    expect(result.arrows.features).toHaveLength(4);
    expect(result.markers.features).toHaveLength(0);
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
