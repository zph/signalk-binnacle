import { describe, expect, it } from 'vitest';
import { TidesStore } from '$entities/tides';
import type { WeatherGrid } from '$entities/weather';
import { HOUR_MS } from '$shared/lib';
import { conditionFeatures } from './conditions-features';

const selectedTime = 10 * HOUR_MS;
const view = { west: 0, south: 0, east: 1, north: 1, width: 300, height: 300 };

function grid(): WeatherGrid {
  return {
    lats: [0, 1],
    lons: [0, 1],
    times: [selectedTime],
    windU: [[0, 0, 0, 0]],
    windV: [[-6, -6, -6, -6]],
    windGust: [[13, 13, 13, 13]],
    waveHeight: [[1, 1, 1, 1]],
    wavePeriod: [[8, 8, 8, 8]],
    waveDirection: [[0, 0, 0, 0]],
    oceanCurrentSpeed: [[0.6, 0.6, 0.6, 0.6]],
    oceanCurrentDirection: [[0, 0, 0, 0]],
  };
}

describe('conditionFeatures', () => {
  it('builds sparse, unit-labeled forecast icons for the selected bracket', () => {
    const features = conditionFeatures(
      grid(),
      { lo: 0, hi: 0, frac: 0 },
      view,
      new TidesStore(),
      selectedTime,
      'kn',
      'metric',
    );
    expect(features.features).toHaveLength(4);
    expect(features.features[0]?.properties?.title).toBe('Waves opposing current');
    expect(features.features[0]?.properties?.wind).toMatch(/kn/);
    expect(features.features[0]?.properties?.gust).toMatch(/kn/);
    expect(features.features[0]?.properties?.waves).toMatch(/m at 8 s/);
    expect(features.features[0]?.properties?.current).toMatch(/kn/);
  });

  it('keeps tide and tidal-current conclusions on their loaded stations', () => {
    const tides = new TidesStore();
    tides.setReadings(
      {
        station: { id: 't1', name: 'Harbor tide', latitude: 2, longitude: 3 },
        distanceMeters: 10,
        events: [{ timeMs: selectedTime, heightMeters: 2.1, kind: 'high' }],
      },
      {
        station: { id: 'c1', name: 'Harbor current', latitude: 4, longitude: 5 },
        distanceMeters: 20,
        events: [{ timeMs: selectedTime, velocityMps: 0, directionRad: undefined, kind: 'slack' }],
      },
      'noaa-coops',
    );
    const features = conditionFeatures(
      undefined,
      { lo: 0, hi: 0, frac: 0 },
      view,
      tides,
      selectedTime,
      'kn',
      'metric',
    );
    expect(features.features.map((feature) => feature.id)).toEqual(['current:c1', 'tide:t1']);
    expect(features.features[0]?.geometry.coordinates).toEqual([5, 4]);
    expect(features.features[1]?.geometry.coordinates).toEqual([3, 2]);
  });

  it('does not smear a station event across time', () => {
    const tides = new TidesStore();
    tides.setReadings(undefined, {
      station: { id: 'c1', name: 'Harbor current', latitude: 4, longitude: 5 },
      distanceMeters: 20,
      events: [{ timeMs: selectedTime, velocityMps: 0, directionRad: undefined, kind: 'slack' }],
    });
    const features = conditionFeatures(
      undefined,
      { lo: 0, hi: 0, frac: 0 },
      view,
      tides,
      selectedTime + 2 * HOUR_MS,
      'kn',
      'metric',
    );
    expect(features.features).toHaveLength(0);
  });
});
