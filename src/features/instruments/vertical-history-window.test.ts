import { describe, expect, it } from 'vitest';
import {
  instrumentHistoryWindowsCodec,
  verticalHistoryResolutionSeconds,
  verticalHistoryWindowMinutesFor,
} from './vertical-history-window';

describe('vertical history windows', () => {
  it('keeps short views detailed and bounds a full day to 720 provider buckets', () => {
    expect(verticalHistoryResolutionSeconds(10)).toBe(5);
    expect(verticalHistoryResolutionSeconds(1_440)).toBe(120);
  });

  it('uses ten minutes for an unset instrument', () => {
    expect(verticalHistoryWindowMinutesFor({}, 'twa-history')).toBe(10);
  });

  it('rejects invalid stored windows and strips unknown fields', () => {
    expect(instrumentHistoryWindowsCodec.decode({ 'tws-history': 25 })).toEqual({
      state: 'invalid',
    });
    expect(
      instrumentHistoryWindowsCodec.decode({ 'twa-history': 60, privateField: 'discarded' }),
    ).toEqual({ state: 'migrated', value: { 'twa-history': 60 } });
  });
});
