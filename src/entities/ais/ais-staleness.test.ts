import { describe, expect, it } from 'vitest';
import { AIS_MOTION_STALE_TTL_MS, aisTargetAgeOpacity } from './ais-staleness';

describe('AIS target age opacity', () => {
  const retentionMs = 60 * 60_000;

  it('stays fully visible through the live-motion window', () => {
    expect(aisTargetAgeOpacity(AIS_MOTION_STALE_TTL_MS, retentionMs)).toBe(1);
  });

  it('fades linearly after motion becomes stale and reaches zero at retention', () => {
    const halfway = AIS_MOTION_STALE_TTL_MS + (retentionMs - AIS_MOTION_STALE_TTL_MS) / 2;
    expect(aisTargetAgeOpacity(halfway, retentionMs)).toBeCloseTo(0.5);
    expect(aisTargetAgeOpacity(retentionMs, retentionMs)).toBe(0);
  });
});
