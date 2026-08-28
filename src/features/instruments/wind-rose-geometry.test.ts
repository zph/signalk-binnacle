import { describe, expect, it } from 'vitest';
import { DEG_TO_RAD } from '$shared/lib';
import { windRoseSectorGeometry } from './wind-rose-geometry';

describe('windRoseSectorGeometry', () => {
  it('keeps the fill, arc ends, and boundary lines on the configured angle', () => {
    const geometry = windRoseSectorGeometry(60 * DEG_TO_RAD);

    expect(geometry.fillPath).toContain('M278 115.485');
    expect(geometry.fillPath).toContain('722 115.485');
    expect(geometry.portArcPath).toContain('278 115.485');
    expect(geometry.starboardArcPath).toContain('M722 115.485');
    expect(geometry.portBoundaryPath).toBe('M278 115.485 L500 500');
    expect(geometry.starboardBoundaryPath).toBe('M722 115.485 L500 500');
  });
});
