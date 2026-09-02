import { describe, expect, it } from 'vitest';
import { assessMoorings } from './mooring-occupancy';
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

describe('assessMoorings', () => {
  it('marks strong dwell and swing evidence as likely occupied', () => {
    const [result] = assessMoorings([mooring('m1')], [], [target('1')], NOW);
    expect(result.assessment.status).toBe('likely-occupied');
    expect(result.assessment.score).toBe(100);
    expect(result.assessment.source).toBe('destination');
  });

  it('leaves a mooring unknown when no AIS target is observed', () => {
    const [result] = assessMoorings([mooring('m1')], [], [], NOW);
    expect(result.assessment).toEqual({ status: 'unknown', score: 0, evidence: [] });
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
  });

  it('ignores stale destination targets', () => {
    const stale = { ...target('1'), lastReportAtMs: NOW - 3 * 60_000 };
    const [result] = assessMoorings([mooring('m1')], [], [stale], NOW);
    expect(result.assessment.status).toBe('unknown');
  });
});
