import { describe, expect, it } from 'vitest';

import { knotsToMetersPerSecond } from '$shared/lib';
import { verticalHistoryGeometry } from './vertical-history';

const WINDOW_MS = 10 * 60 * 1000;

describe('verticalHistoryGeometry', () => {
  it('puts the newest speed sample at the top and ages older samples downward', () => {
    const geometry = verticalHistoryGeometry(
      [
        { atMs: 0, value: knotsToMetersPerSecond(2) },
        { atMs: WINDOW_MS / 2, value: knotsToMetersPerSecond(5) },
        { atMs: WINDOW_MS, value: knotsToMetersPerSecond(10) },
      ],
      WINDOW_MS,
      'speed',
      WINDOW_MS,
    );

    expect(geometry.scale).toEqual(['2.0', '6.0', '10']);
    expect(geometry.deltaLabel).toBe('8.0 Δ');
    expect(geometry.paths).toEqual(['M100 0', 'M37.5 50', 'M0 100']);
    expect(geometry.current).toEqual({ x: 100, y: 0 });
  });

  it('keeps contiguous five-second samples in one squiggle', () => {
    const geometry = verticalHistoryGeometry(
      [
        { atMs: 590_000, value: knotsToMetersPerSecond(2) },
        { atMs: 595_000, value: knotsToMetersPerSecond(4) },
        { atMs: 600_000, value: knotsToMetersPerSecond(3) },
      ],
      600_000,
      'speed',
      WINDOW_MS,
    );

    expect(geometry.paths).toHaveLength(1);
    expect(geometry.scale).toEqual(['2.0', '3.0', '4.0']);
    expect(geometry.paths[0]).toBe('M50 0 L100 0.83 L0 1.67');
  });

  it('breaks TWA at the stern wrap instead of drawing across the plot', () => {
    const geometry = verticalHistoryGeometry(
      [
        { atMs: 590_000, value: (170 * Math.PI) / 180 },
        { atMs: 595_000, value: (-175 * Math.PI) / 180 },
        { atMs: 600_000, value: (-165 * Math.PI) / 180 },
      ],
      600_000,
      'angle',
      WINDOW_MS,
    );

    expect(geometry.scale).toEqual(['P 175', 'P 2', 'S 170']);
    expect(geometry.paths).toEqual(['M2.9 0 L0 0.83', 'M100 1.67']);
    expect(geometry.deltaLabel).toBe('25° Δ');
  });

  it('omits expired samples and breaks continuity across a data gap', () => {
    const geometry = verticalHistoryGeometry(
      [
        { atMs: -1, value: 1 },
        { atMs: 500_000, value: 1 },
        { atMs: 595_000, value: 2 },
        { atMs: 600_000, value: 3 },
      ],
      600_000,
      'speed',
      WINDOW_MS,
    );

    expect(geometry.paths).toHaveLength(2);
    expect(geometry.paths[0]).toContain(' L');
    expect(geometry.paths[1]).not.toContain(' L');
  });

  it('centers an unchanged value in a zero-width measured range', () => {
    const geometry = verticalHistoryGeometry(
      [
        { atMs: 595_000, value: knotsToMetersPerSecond(5) },
        { atMs: 600_000, value: knotsToMetersPerSecond(5) },
      ],
      600_000,
      'speed',
      WINDOW_MS,
    );

    expect(geometry.scale).toEqual(['5.0', '5.0', '5.0']);
    expect(geometry.deltaLabel).toBe('0.0 Δ');
    expect(geometry.paths).toEqual(['M50 0 L50 0.83']);
  });

  it('includes the five-second maximum trace in the speed scale', () => {
    const geometry = verticalHistoryGeometry(
      [
        { atMs: 595_000, value: knotsToMetersPerSecond(5) },
        { atMs: 600_000, value: knotsToMetersPerSecond(6) },
      ],
      600_000,
      'speed',
      WINDOW_MS,
      [
        { atMs: 595_000, value: knotsToMetersPerSecond(8) },
        { atMs: 600_000, value: knotsToMetersPerSecond(9) },
      ],
    );

    expect(geometry.scale).toEqual(['5.0', '7.0', '9.0']);
    expect(geometry.deltaLabel).toBe('4.0 Δ');
    expect(geometry.maximumPaths).toEqual(['M100 0 L75 0.83']);
  });

  it('measures TWA across the stern wrap as the shortest circular span', () => {
    const geometry = verticalHistoryGeometry(
      [
        { atMs: 595_000, value: (170 * Math.PI) / 180 },
        { atMs: 600_000, value: (-170 * Math.PI) / 180 },
      ],
      600_000,
      'angle',
      WINDOW_MS,
    );

    expect(geometry.deltaLabel).toBe('20° Δ');
  });
});
