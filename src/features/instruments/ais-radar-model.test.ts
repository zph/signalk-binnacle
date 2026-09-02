import { describe, expect, it } from 'vitest';
import type { AisTargetView } from '$entities/ais';
import type { Assessment } from '$entities/collision';
import {
  buildAisRadarContacts,
  createAisRadarContactIndexer,
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

  it('never lets distant traffic evict a nearby contact at the plot cap', () => {
    const farTargets = Array.from({ length: 6 }, (_, index) =>
      target({
        id: `far-${index}`,
        position: { latitude: 0.05 + index * 0.001, longitude: 0 },
      }),
    );
    const assessment: Assessment = {
      worst: 'warning',
      unassessed: [],
      contacts: farTargets.map((contact) => ({
        id: contact.id,
        position: contact.position,
        cpaMeters: 500,
        tcpaSeconds: 600,
        severity: 'warning',
        source: 'computed',
      })),
    };

    const contacts = buildAisRadarContacts({
      ownPosition: { latitude: 0, longitude: 0 },
      targets: [
        ...farTargets,
        target({ id: 'zalophus', name: 'ZALOPHUS', position: { latitude: 0.005, longitude: 0 } }),
      ],
      assessment,
      rangeNm: 6,
      maxContacts: 3,
    });

    expect(contacts.map((contact) => contact.id)).toContain('zalophus');
    expect(contacts).toHaveLength(3);
  });

  it('accepts only supported persisted ranges', () => {
    expect(isAisRadarRangeNm(6)).toBe(true);
    expect(isAisRadarRangeNm(5)).toBe(false);
    expect(isAisRadarRangeNm('6')).toBe(false);
  });

  it('keeps sequential plot indexes stable and reuses a departed target index', () => {
    const indexContacts = createAisRadarContactIndexer();
    const contacts = buildAisRadarContacts({
      ownPosition: { latitude: 0, longitude: 0 },
      targets: [
        target({ id: 'alpha', position: { latitude: 0.005, longitude: 0 } }),
        target({ id: 'bravo', position: { latitude: 0.006, longitude: 0 } }),
      ],
      assessment: CLEAR,
      rangeNm: 1,
    });

    expect(indexContacts(contacts).map(({ id, index }) => [id, index])).toEqual([
      ['alpha', 1],
      ['bravo', 2],
    ]);

    const bravo = contacts.find((contact) => contact.id === 'bravo');
    const alpha = contacts[0];
    if (!bravo || !alpha) throw new Error('Expected both radar contacts');
    const charlie = { ...alpha, id: 'charlie' };
    expect(indexContacts([bravo, charlie]).map(({ id, index }) => [id, index])).toEqual([
      ['charlie', 1],
      ['bravo', 2],
    ]);
  });
});
