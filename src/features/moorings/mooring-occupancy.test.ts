import { describe, expect, it } from 'vitest';
import type { AisTargetView } from '$entities/ais';
import { assessMoorings, OnboardAisHistory } from './mooring-occupancy';
import type { MooringAisTarget, MooringPoint } from './moorings-types';

const NOW = 2_000_000;

function mooring(id: string, longitude = 0): MooringPoint {
  return {
    id,
    name: id,
    position: { latitude: 0, longitude },
    scaleBand: 'harbour',
    assessment: { status: 'unknown', score: 0, evidence: [] },
  };
}

function target(id: string, longitude = 0): MooringAisTarget {
  return {
    id,
    mmsi: id.padStart(9, '0'),
    name: `Vessel ${id}`,
    position: { latitude: 0, longitude },
    sogMps: 0.1,
    navigationState: 'moored',
    lastReportAtMs: NOW,
    source: 'destination',
    history: {
      firstSeenAtMs: NOW - 20 * 60_000,
      sampleCount: 12,
      medianSogMps: 0.1,
      center: { latitude: 0, longitude },
      maxRadiusMeters: 12,
    },
  };
}

function longitudeAtMeters(meters: number): number {
  return meters / 111_194.9266;
}

function distanceOnlyTarget(id: string, meters: number): MooringAisTarget {
  const result = target(id, longitudeAtMeters(meters));
  return {
    ...result,
    sogMps: undefined,
    navigationState: undefined,
    history: {
      ...result.history,
      firstSeenAtMs: NOW,
      sampleCount: 1,
      medianSogMps: undefined,
    },
  };
}

describe('assessMoorings', () => {
  it('preserves destination provenance for viewport AIS targets in the shared target model', () => {
    const history = new OnboardAisHistory();
    const [observed] = history.observe(
      [
        {
          id: 'aisstream:123456789',
          position: { latitude: 0, longitude: 0 },
          lastReportAtMs: NOW,
        } satisfies AisTargetView,
      ],
      NOW,
    );
    expect(observed.source).toBe('destination');
    expect(observed.mmsi).toBe('123456789');
  });

  it('marks strong dwell and swing evidence as likely occupied', () => {
    const [result] = assessMoorings([mooring('m1')], [], [target('1')], NOW);
    expect(result.assessment.status).toBe('likely-occupied');
    expect(result.assessment.score).toBe(100);
    expect(result.assessment.source).toBe('destination');
  });

  it('awards full proximity points through 35 m and tapers to zero at 75 m', () => {
    const distances = [1, 35, 55, 74];
    const expectedScores = [30, 30, 15, 1];

    for (const [index, meters] of distances.entries()) {
      const [result] = assessMoorings(
        [mooring(`m${index}`)],
        [],
        [distanceOnlyTarget(`${index}`, meters)],
        NOW,
      );
      expect(result.assessment.score).toBe(expectedScores[index]);
      expect(result.assessment.evidence[0]).toBe(
        `AIS target ${meters} m from the charted position: ${expectedScores[index]} of 30 proximity points`,
      );
    }
  });

  it('does not match a target beyond the 75 m maximum', () => {
    const [result] = assessMoorings([mooring('m1')], [], [distanceOnlyTarget('1', 76)], NOW);

    expect(result.assessment).toEqual({
      status: 'unknown',
      score: 0,
      evidence: ['Nearest current AIS target is 76 m away, beyond the 75 m matching limit'],
    });
  });

  it('leaves a mooring unknown when no AIS target is observed', () => {
    const [result] = assessMoorings([mooring('m1')], [], [], NOW);
    expect(result.assessment).toEqual({
      status: 'unknown',
      score: 0,
      evidence: ['No current AIS targets were observed in this chart area'],
    });
  });

  it('explains when the nearest current vessel is beyond the matching limit', () => {
    const [result] = assessMoorings([mooring('m1')], [], [target('1', 0.001)], NOW);

    expect(result.assessment).toEqual({
      status: 'unknown',
      score: 0,
      evidence: ['Nearest current AIS target is 111 m away, beyond the 75 m matching limit'],
    });
  });

  it('assigns one nearby target to only one mooring', () => {
    const results = assessMoorings(
      [mooring('nearest'), mooring('farther', 0.0002)],
      [],
      [target('1', 0.00005)],
      NOW,
    );
    expect(results.filter((result) => result.assessment.vesselId)).toHaveLength(1);
    expect(results[0].assessment.vesselId).toBe('1');
    expect(results[1].assessment.evidence).toEqual([
      'Nearest current AIS target is 17 m away, but it is assigned to a closer charted mooring',
    ]);
  });

  it('keeps a slow-reporting target current for the shared AIS motion window', () => {
    const slow = { ...target('1'), lastReportAtMs: NOW - 3 * 60_000 };
    const [result] = assessMoorings([mooring('m1')], [], [slow], NOW);
    expect(result.assessment.status).toBe('likely-occupied');
  });

  it('ignores destination targets after the shared AIS motion window', () => {
    const stale = { ...target('1'), lastReportAtMs: NOW - 6 * 60_000 };
    const [result] = assessMoorings([mooring('m1')], [], [stale], NOW);
    expect(result.assessment.status).toBe('unknown');
    expect(result.assessment.evidence).toEqual([
      'No current AIS targets were observed in this chart area',
    ]);
  });
});
