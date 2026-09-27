import { describe, expect, it } from 'vitest';
import { distanceToZoneBoundaryMeters, parseAnchorZone } from './anchor-zone';

describe('distanceToZoneBoundaryMeters', () => {
  it('measures boat clearance to the closest polygon edge and follows edits', () => {
    const triangle = {
      type: 'polygon' as const,
      vertices: [
        { bearing: 0, distance: 100 },
        { bearing: 120, distance: 100 },
        { bearing: 240, distance: 100 },
      ],
    };
    expect(distanceToZoneBoundaryMeters(triangle, 0, 0)).toBeCloseTo(50);
    expect(distanceToZoneBoundaryMeters(triangle, 25, 0)).toBeCloseTo(37.5);
    expect(
      distanceToZoneBoundaryMeters(
        {
          ...triangle,
          vertices: triangle.vertices.map((vertex) => ({ ...vertex, distance: 200 })),
        },
        0,
        0,
      ),
    ).toBeCloseTo(100);
  });

  it('handles an edge that reaches the anchor', () => {
    expect(
      distanceToZoneBoundaryMeters(
        {
          type: 'polygon',
          vertices: [
            { bearing: 0, distance: 0 },
            { bearing: 90, distance: 30 },
            { bearing: 180, distance: 30 },
          ],
        },
        0,
        0,
      ),
    ).toBe(0);
  });

  it('handles circles and sectors', () => {
    expect(distanceToZoneBoundaryMeters({ type: 'circle', radius: 50 }, 20, 0)).toBe(30);
    expect(distanceToZoneBoundaryMeters({ type: 'circle', radius: 50 }, 65, 0)).toBe(15);
    expect(
      distanceToZoneBoundaryMeters(
        { type: 'sector', radius: 50, startAngle: 0, endAngle: 90 },
        20,
        Math.PI / 4,
      ),
    ).toBeGreaterThan(10);
  });
});

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
