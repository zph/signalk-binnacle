import { describe, expect, it } from 'vitest';
import { assessMarineConditions, deepWaterWaveSteepness } from './conditions';
import type { WeatherReadout } from './weather-readout';

function readout(overrides: Partial<WeatherReadout> = {}): WeatherReadout {
  return { speedMs: 4, fromRad: 0, ...overrides };
}

describe('assessMarineConditions', () => {
  it('calculates deep-water wave steepness', () => {
    expect(deepWaterWaveSteepness(2, 6)).toBeCloseTo(0.0356, 3);
    expect(deepWaterWaveSteepness(0, 6)).toBeUndefined();
  });

  it('flags very steep and steep short-period seas', () => {
    expect(assessMarineConditions(readout({ waveHeightM: 3, wavePeriodS: 5 }))[0]?.kind).toBe(
      'very-steep-seas',
    );
    expect(assessMarineConditions(readout({ waveHeightM: 2, wavePeriodS: 6 }))[0]?.kind).toBe(
      'steep-seas',
    );
  });

  it('compares wave travel against the direction current flows toward', () => {
    const opposing = assessMarineConditions(
      readout({
        waveHeightM: 1,
        wavePeriodS: 8,
        waveFromRad: 0,
        currentSpeedMs: 0.6,
        currentDirectionRad: 0,
      }),
    );
    expect(opposing.some((condition) => condition.kind === 'opposing-current')).toBe(true);

    const following = assessMarineConditions(
      readout({
        waveHeightM: 1,
        wavePeriodS: 8,
        waveFromRad: 0,
        currentSpeedMs: 0.6,
        currentDirectionRad: Math.PI,
      }),
    );
    expect(following.some((condition) => condition.kind === 'following-current')).toBe(true);
  });

  it('distinguishes crossing and aligned component wave trains', () => {
    const crossing = assessMarineConditions(
      readout({
        windWaveHeightM: 1,
        windWaveFromRad: 0,
        swellHeightM: 1,
        swellFromRad: Math.PI / 2,
      }),
    );
    expect(crossing.some((condition) => condition.kind === 'crossing-seas')).toBe(true);

    const aligned = assessMarineConditions(
      readout({
        windWaveHeightM: 1,
        windWaveFromRad: 0,
        swellHeightM: 1,
        swellFromRad: Math.PI / 12,
      }),
    );
    expect(aligned.some((condition) => condition.kind === 'reinforcing-seas')).toBe(true);
  });

  it('flags a material gust spread and ranks hazards first', () => {
    const conditions = assessMarineConditions(
      readout({ speedMs: 6, gustMs: 13, waveHeightM: 3, wavePeriodS: 5 }),
    );
    expect(conditions.some((condition) => condition.kind === 'gusty-wind')).toBe(true);
    expect(conditions[0]?.severity).toBe('hazard');
  });

  it('returns no icons for unremarkable model combinations', () => {
    expect(assessMarineConditions(readout({ waveHeightM: 0.3, wavePeriodS: 10 }))).toEqual([]);
  });
});
