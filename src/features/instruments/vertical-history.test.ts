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

    expect(geometry.scale).toEqual(['0', '5.0', '10']);
    expect(geometry.paths).toEqual(['M100 0', 'M50 50', 'M20 100']);
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
    expect(geometry.paths[0]).toBe('M60 0 L80 0.83 L40 1.67');
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

    expect(geometry.scale).toEqual(['P 180', '0', 'S 180']);
    expect(geometry.paths).toEqual(['M4.17 0 L1.39 0.83', 'M97.22 1.67']);
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
});
