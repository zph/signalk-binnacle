import { describe, expect, it } from 'vitest';
import { parseAnchorZone } from './anchor-zone';

describe('parseAnchorZone', () => {
  it('accepts the three Hoekens watch shapes', () => {
    expect(parseAnchorZone({ type: 'circle', radius: 45 })).toEqual({ type: 'circle', radius: 45 });
    expect(parseAnchorZone({ type: 'sector', radius: 80, startAngle: 300, endAngle: 60 })).toEqual({
      type: 'sector',
      radius: 80,
      startAngle: 300,
      endAngle: 60,
    });
    expect(
      parseAnchorZone({
        type: 'polygon',
        vertices: [
          { bearing: 0, distance: 20 },
          { bearing: 120, distance: 25 },
          { bearing: 240, distance: 30 },
        ],
      }),
    ).toMatchObject({ type: 'polygon' });
  });

  it('rejects malformed and unbounded server geometry', () => {
    expect(parseAnchorZone({ type: 'circle', radius: Infinity })).toBeUndefined();
    expect(
      parseAnchorZone({ type: 'sector', radius: 40, startAngle: -1, endAngle: 90 }),
    ).toBeUndefined();
    expect(
      parseAnchorZone({ type: 'polygon', vertices: [{ bearing: 0, distance: 10 }] }),
    ).toBeUndefined();
    expect(
      parseAnchorZone({
        type: 'polygon',
        vertices: Array.from({ length: 25 }, () => ({ bearing: 0, distance: 10 })),
      }),
    ).toBeUndefined();
  });
});
