import { describe, expect, it } from 'vitest';
import { buildWayfinderLegRows } from './wayfinder-route-table';

describe('buildWayfinderLegRows', () => {
  it('builds timed leg rows and classifies bow and stern crossings', () => {
    const rows = buildWayfinderLegRows([
      {
        latitude: 38,
        longitude: -122,
        time: '2026-09-08T12:00:00Z',
        windDir: 0,
        tws: 12,
      },
      {
        latitude: 38.1,
        longitude: -122.1,
        time: '2026-09-08T13:30:00Z',
        heading: 315,
        windDir: 0,
        twa: 45,
        tws: 14,
        propulsion: 'sail',
      },
      {
        latitude: 38.2,
        longitude: -122.2,
        time: '2026-09-08T14:15:00Z',
        heading: 45,
        windDir: 0,
        twa: 45,
        tws: 15,
        propulsion: 'sail',
      },
      {
        latitude: 38.3,
        longitude: -122.3,
        time: '2026-09-08T15:00:00Z',
        heading: 135,
        windDir: 0,
        twa: 135,
        tws: 16,
        propulsion: 'sail',
      },
      {
        latitude: 38.4,
        longitude: -122.4,
        time: '2026-09-08T16:00:00Z',
        heading: 225,
        windDir: 0,
        twa: 135,
        tws: 17,
        propulsion: 'sail',
      },
    ]);

    expect(rows[0]).toMatchObject({
      leg: 1,
      durationSeconds: 5_400,
      windSpeedKn: 12,
      windDirectionDeg: 0,
      trueWindAngleDeg: 45,
      windSide: 'starboard',
    });
    expect(rows[1].maneuver).toBe('Tack');
    expect(rows[3].maneuver).toBe('Jibe');
  });

  it('does not invent timing or sailing maneuvers from incomplete metadata', () => {
    expect(
      buildWayfinderLegRows([
        { latitude: 1, longitude: 2, time: 'invalid', windDir: 180, tws: 10 },
        {
          latitude: 2,
          longitude: 3,
          heading: 90,
          windDir: 180,
          twa: 90,
          propulsion: 'motor',
        },
      ]),
    ).toEqual([
      {
        leg: 1,
        windSpeedKn: 10,
        windDirectionDeg: 180,
        trueWindAngleDeg: 90,
        windSide: 'starboard',
      },
    ]);
  });

  it('keeps exact head-to-wind and downwind angles without inventing a side', () => {
    const rows = buildWayfinderLegRows([
      { latitude: 1, longitude: 2, windDir: 180, tws: 10 },
      { latitude: 2, longitude: 3, heading: 180, windDir: 180, propulsion: 'sail' },
      { latitude: 3, longitude: 4, heading: 0, propulsion: 'sail' },
    ]);

    expect(rows[0]).toMatchObject({ trueWindAngleDeg: 0 });
    expect(rows[0]).not.toHaveProperty('windSide');
    expect(rows[1]).toMatchObject({ trueWindAngleDeg: 180 });
    expect(rows[1]).not.toHaveProperty('windSide');
  });
});
