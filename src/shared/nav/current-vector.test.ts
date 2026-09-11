import { describe, expect, it } from 'vitest';
import { knotsToMetersPerSecond } from '$shared/lib';
import {
  CURRENT_VECTOR_UPDATE_INTERVAL_MS,
  createCurrentVectorTracker,
  currentVectorOpacity,
} from './current-vector';

describe('current vector presentation', () => {
  it('holds set and drift for one minute, then accepts the newest sample', () => {
    const tracker = createCurrentVectorTracker();
    expect(tracker.push(0.5, 0.4, 1_000)).toEqual({
      setTrueRad: 0.5,
      driftMps: 0.4,
      epochMs: 1_000,
    });
    expect(tracker.push(1.2, 0.8, 1_000 + CURRENT_VECTOR_UPDATE_INTERVAL_MS - 1)).toEqual({
      setTrueRad: 0.5,
      driftMps: 0.4,
      epochMs: 1_000,
    });
    expect(tracker.push(1.2, 0.8, 1_000 + CURRENT_VECTOR_UPDATE_INTERVAL_MS)).toEqual({
      setTrueRad: 1.2,
      driftMps: 0.8,
      epochMs: 61_000,
    });
  });

  it('resets immediately for a new stream generation with an earlier epoch', () => {
    const tracker = createCurrentVectorTracker();
    tracker.push(0.5, 0.4, 100_000);
    expect(tracker.push(1.2, 0.8, 2_000)).toEqual({
      setTrueRad: 1.2,
      driftMps: 0.8,
      epochMs: 2_000,
    });
  });

  it('hides negligible current and reaches full opacity at two knots', () => {
    expect(currentVectorOpacity(undefined)).toBe(0);
    expect(currentVectorOpacity(0.05)).toBe(0);
    expect(currentVectorOpacity(0.5)).toBeGreaterThan(0.4);
    expect(currentVectorOpacity(knotsToMetersPerSecond(2))).toBe(1);
    expect(currentVectorOpacity(2)).toBe(1);
  });
});
