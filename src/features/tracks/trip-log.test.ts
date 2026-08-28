import { describe, expect, it } from 'vitest';
import { type HistoryValues, SK_PATHS } from '$shared/signalk';
import { buildTripDay } from './trip-log';

function values(speeds: readonly number[], winds: readonly number[] = []): HistoryValues {
  return {
    from: '2026-08-27T12:00:00Z',
    to: '2026-08-27T12:10:00Z',
    columns: [
      { path: SK_PATHS.position, method: '' },
      { path: SK_PATHS.speedOverGround, method: '' },
      { path: SK_PATHS.windAngleApparent, method: '' },
    ],
    rows: speeds.map(
      (speed, index) =>
        [
          new Date(Date.UTC(2026, 7, 27, 12, index)).toISOString(),
          { latitude: 20 + index * 0.001, longitude: -87 },
          speed,
          winds[index] ?? null,
        ] as const,
    ),
  };
}

describe('buildTripDay', () => {
  it('summarizes moving portions and circularly averages wind angle', () => {
    const day = buildTripDay('2026-08-27', values([0.2, 0.3, 0.4], [3.1, -3.1, 3.12]), 0.15, 5);
    expect(day.hasTravel).toBe(true);
    expect(day.portions).toHaveLength(1);
    expect(day.portions[0].averageSpeedMps).toBeCloseTo(0.3);
    expect(Math.abs(day.portions[0].averageWindAngleRad ?? 0)).toBeGreaterThan(3);
  });

  it('splits portions around a stop longer than five minutes', () => {
    const day = buildTripDay(
      '2026-08-27',
      values([0.3, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.3, 0.3]),
      0.15,
      5,
    );
    expect(day.stops).toEqual([expect.objectContaining({ durationSeconds: 360 })]);
    expect(day.portions).toHaveLength(1);
  });

  it('does not call exactly five minutes a stop', () => {
    const day = buildTripDay('2026-08-27', values([0.01, 0.01, 0.01, 0.01, 0.01, 0.01]), 0.15, 5);
    expect(day.stops).toEqual([]);
  });
});
