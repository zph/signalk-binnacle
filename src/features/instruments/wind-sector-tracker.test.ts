import { describe, expect, it } from 'vitest';
import { createWindSectorTracker } from './wind-sector-tracker';

const DEG = Math.PI / 180;

function signedDegrees(angleRad: number): number {
  return angleRad / DEG;
}

describe('wind sector tracker', () => {
  it('uses a circular mean across the port-starboard seam', () => {
    const tracker = createWindSectorTracker();
    tracker.push(179 * DEG, 1_000, 'true');
    const filtered = tracker.push(-179 * DEG, 2_000, 'true');

    expect(Math.abs(signedDegrees(filtered))).toBeCloseTo(180, 6);
  });

  it('keeps only samples inside the rolling window', () => {
    const tracker = createWindSectorTracker(2_000);
    tracker.push(0, 1_000, 'true');
    tracker.push(30 * DEG, 2_000, 'true');
    const filtered = tracker.push(60 * DEG, 4_001, 'true');

    expect(signedDegrees(filtered)).toBeCloseTo(60, 6);
  });

  it('replaces a repeated receipt epoch instead of weighting it twice', () => {
    const tracker = createWindSectorTracker();
    tracker.push(0, 1_000, 'true');
    tracker.push(90 * DEG, 2_000, 'true');
    const filtered = tracker.push(30 * DEG, 2_000, 'true');

    expect(signedDegrees(filtered)).toBeCloseTo(15, 6);
  });

  it('resets when falling back from true to apparent wind', () => {
    const tracker = createWindSectorTracker();
    tracker.push(-40 * DEG, 1_000, 'true');
    const filtered = tracker.push(70 * DEG, 2_000, 'apparent');

    expect(signedDegrees(filtered)).toBeCloseTo(70, 6);
  });

  it('resets when replay time moves backward', () => {
    const tracker = createWindSectorTracker();
    tracker.push(-40 * DEG, 2_000, 'true');
    const filtered = tracker.push(20 * DEG, 1_000, 'true');

    expect(signedDegrees(filtered)).toBeCloseTo(20, 6);
  });
});
