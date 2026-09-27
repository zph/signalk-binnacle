import { describe, expect, it } from 'vitest';
import type { TripPoint, TripPortion } from '$features/tracks';
import {
  annotationCapacity,
  annotationFor,
  selectAnnotationPoints,
  windBarbGeometry,
} from './history-track-annotations';

function point(index: number, overrides: Partial<TripPoint> = {}): TripPoint {
  return {
    position: { latitude: 38 + index * 0.001, longitude: -122 + index * 0.001 },
    timestamp: new Date(2026, 7, 27, 12, index * 10).getTime(),
    speedMps: 3,
    ...overrides,
  };
}

function portion(points: TripPoint[]): TripPortion {
  return {
    id: 'portion',
    points,
    startedAt: points[0].timestamp,
    endedAt: points.at(-1)?.timestamp ?? points[0].timestamp,
    durationSeconds:
      ((points.at(-1)?.timestamp ?? points[0].timestamp) - points[0].timestamp) / 1000,
    averageSpeedMps: 3,
    labelPosition: points[Math.floor(points.length / 2)].position,
  };
}

describe('history track annotations', () => {
  it('keeps a bounded, evenly spread set including the endpoints', () => {
    const points = Array.from({ length: 20 }, (_, index) => point(index));
    const selected = selectAnnotationPoints([portion(points)], 6);
    expect(selected).toHaveLength(6);
    expect(selected[0]).toBe(points[0]);
    expect(selected.at(-1)).toBe(points.at(-1));
  });

  it('scales the visible annotation budget with the chart width', () => {
    expect(annotationCapacity(320)).toBe(6);
    expect(annotationCapacity(1200)).toBe(10);
    expect(annotationCapacity(10_000)).toBe(28);
  });

  it('formats time, true wind, direction, and travel speed for the map', () => {
    const annotation = annotationFor(
      point(0, {
        speedMps: 3.1,
        windSpeedMps: 7.2,
        windDirectionRad: Math.PI / 2,
        windReference: 'true',
      }),
    );
    expect(annotation.timeLabel).toMatch(/12:00/);
    expect(annotation.conditionsLabel).toContain('TWS 14.0 kn');
    expect(annotation.conditionsLabel).toContain('SOG 6.0 kn');
    expect(annotation.detailLabel).toContain('Wind 090°T');
  });

  it('builds a staff and five-knot feathers toward the wind source', () => {
    const geometry = windBarbGeometry(point(0, { windSpeedMps: 5.2, windDirectionRad: 0 }), 10);
    expect(geometry?.coordinates.length).toBe(3);
    expect(geometry?.coordinates[0][1][1]).toBeGreaterThan(geometry?.coordinates[0][0][1] ?? 0);
  });
});
