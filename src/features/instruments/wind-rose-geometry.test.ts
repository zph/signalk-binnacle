import { describe, expect, it } from 'vitest';
import { DEG_TO_RAD } from '$shared/lib';
import { windRoseSectorGeometry } from './wind-rose-geometry';

const CENTER = 500;

function arcAngles(path: string): [number, number] {
  const coordinates = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!coordinates || coordinates.length < 9) throw new Error(`Invalid arc path: ${path}`);
  const angle = (x: number, y: number) => Math.atan2(x - CENTER, CENTER - y);
  return [angle(coordinates[0], coordinates[1]), angle(coordinates[7], coordinates[8])];
}

describe('windRoseSectorGeometry', () => {
  it('centers each perimeter arc on its configured boundary line', () => {
    const geometry = windRoseSectorGeometry(60 * DEG_TO_RAD, 15 * DEG_TO_RAD);
    const portAngles = arcAngles(geometry.portArcPath);
    const starboardAngles = arcAngles(geometry.starboardArcPath);

    expect(geometry.fillPath).toContain('M278 115.485');
    expect(geometry.fillPath).toContain('722 115.485');
    expect((portAngles[0] + portAngles[1]) / 2).toBeCloseTo(-30 * DEG_TO_RAD, 5);
    expect((starboardAngles[0] + starboardAngles[1]) / 2).toBeCloseTo(30 * DEG_TO_RAD, 5);
    expect(portAngles[1] - portAngles[0]).toBeCloseTo(30 * DEG_TO_RAD, 5);
    expect(starboardAngles[1] - starboardAngles[0]).toBeCloseTo(30 * DEG_TO_RAD, 5);
    expect(geometry.portBoundaryPath).toBe('M500 500 L278 115.485');
    expect(geometry.starboardBoundaryPath).toBe('M500 500 L722 115.485');
  });

  it('moves the centered arcs with a changed no-go angle without changing their span', () => {
    const geometry = windRoseSectorGeometry(90 * DEG_TO_RAD, 15 * DEG_TO_RAD);
    const portAngles = arcAngles(geometry.portArcPath);
    const starboardAngles = arcAngles(geometry.starboardArcPath);

    expect((portAngles[0] + portAngles[1]) / 2).toBeCloseTo(-45 * DEG_TO_RAD, 5);
    expect((starboardAngles[0] + starboardAngles[1]) / 2).toBeCloseTo(45 * DEG_TO_RAD, 5);
    expect(portAngles[1] - portAngles[0]).toBeCloseTo(30 * DEG_TO_RAD, 5);
    expect(starboardAngles[1] - starboardAngles[0]).toBeCloseTo(30 * DEG_TO_RAD, 5);
    expect(geometry.portBoundaryPath).toBe('M500 500 L186.045 186.045');
    expect(geometry.starboardBoundaryPath).toBe('M500 500 L813.955 186.045');
  });

  it('uses the configured margin on both sides of each limit line', () => {
    const geometry = windRoseSectorGeometry(40 * DEG_TO_RAD, 8 * DEG_TO_RAD);
    const portAngles = arcAngles(geometry.portArcPath);
    const starboardAngles = arcAngles(geometry.starboardArcPath);

    expect(portAngles[0]).toBeCloseTo(-28 * DEG_TO_RAD, 5);
    expect(portAngles[1]).toBeCloseTo(-12 * DEG_TO_RAD, 5);
    expect(starboardAngles[0]).toBeCloseTo(12 * DEG_TO_RAD, 5);
    expect(starboardAngles[1]).toBeCloseTo(28 * DEG_TO_RAD, 5);
  });
});
