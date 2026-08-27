import { describe, expect, it } from 'vitest';
import type { AisTargetView } from '$entities/ais';
import type { Assessment } from '$entities/collision';
import {
  buildAisRadarContacts,
  DEFAULT_AIS_RADAR_RANGE_NM,
  isAisRadarRangeNm,
} from './ais-radar-model';

const CLEAR: Assessment = { contacts: [], unassessed: [], worst: 'clear' };

function target(overrides: Partial<AisTargetView> = {}): AisTargetView {
  return {
    id: 'urn:mrn:imo:mmsi:123456789',
    name: 'TEST BOAT',
    position: { latitude: 0.01, longitude: 0 },
    cogRad: Math.PI / 2,
    headingRad: Math.PI,
    sogMps: 5,
    ...overrides,
  };
}

describe('AIS radar model', () => {
  it('projects contacts north-up and points the boat by heading before COG', () => {
    const [contact] = buildAisRadarContacts({
      ownPosition: { latitude: 0, longitude: 0 },
      targets: [target()],
      assessment: CLEAR,
      rangeNm: DEFAULT_AIS_RADAR_RANGE_NM,
    });

    expect(contact?.x).toBeCloseTo(0, 4);
    expect(contact?.y).toBeLessThan(0);
    expect(contact?.directionDeg).toBeCloseTo(180);
    expect(contact?.vectorX).toBeGreaterThan(0);
    expect(contact?.sogText).toBe('SOG 9.7 kn');
  });

  it('uses COG when heading is unavailable and filters beyond the selected range', () => {
    const contacts = buildAisRadarContacts({
      ownPosition: { latitude: 0, longitude: 0 },
      targets: [
        target({ id: 'near', headingRad: undefined, position: { latitude: 0, longitude: 0.005 } }),
        target({ id: 'far', position: { latitude: 0.2, longitude: 0 } }),
      ],
      assessment: CLEAR,
      rangeNm: 1,
    });

    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.id).toBe('near');
    expect(contacts[0]?.directionDeg).toBeCloseTo(90);
  });

  it('prioritizes dangerous contacts and falls back to computed CPA data', () => {
    const assessment: Assessment = {
      worst: 'danger',
      unassessed: [],
      contacts: [
        {
          id: 'danger',
          position: { latitude: 0.01, longitude: 0 },
          cpaMeters: 370.4,
          tcpaSeconds: 600,
          severity: 'danger',
          source: 'computed',
        },
      ],
    };
    const contacts = buildAisRadarContacts({
      ownPosition: { latitude: 0, longitude: 0 },
      targets: [
        target({ id: 'clear', position: { latitude: 0.005, longitude: 0 } }),
        target({ id: 'danger' }),
      ],
      assessment,
      rangeNm: 6,
    });

    expect(contacts[0]?.id).toBe('danger');
    expect(contacts[0]?.severity).toBe('danger');
    expect(contacts[0]?.cpaText).toBe('CPA 0.20 nm / 10 min');
  });

  it('accepts only supported persisted ranges', () => {
    expect(isAisRadarRangeNm(6)).toBe(true);
    expect(isAisRadarRangeNm(5)).toBe(false);
    expect(isAisRadarRangeNm('6')).toBe(false);
  });
});
