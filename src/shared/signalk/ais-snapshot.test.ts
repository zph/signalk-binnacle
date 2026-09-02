import { describe, expect, it } from 'vitest';
import { parseAisSnapshot } from './ais-snapshot';
import { SK_PATHS } from './paths';

const NOW = Date.parse('2026-09-02T15:23:00Z');
const REPORTED_AT = '2026-09-02T14:39:01Z';

describe('parseAisSnapshot', () => {
  it('hydrates dated AIS basics, excludes self, and timestamps undated static fields', () => {
    const snapshot = parseAisSnapshot(
      {
        'self-id': {
          navigation: {
            position: { value: { latitude: 1, longitude: 2 }, timestamp: REPORTED_AT },
          },
        },
        'urn:mrn:imo:mmsi:368434280': {
          name: 'ZALOPHUS',
          navigation: {
            position: {
              value: { latitude: 38.0464, longitude: -122.3103 },
              timestamp: REPORTED_AT,
            },
            courseOverGroundTrue: { value: 1.04, timestamp: REPORTED_AT },
            speedOverGround: { value: 18.52, timestamp: REPORTED_AT },
            headingTrue: { value: 1.05, timestamp: REPORTED_AT },
            state: { value: 'motoring', timestamp: REPORTED_AT },
          },
          design: { aisShipType: { value: { id: 30 }, timestamp: REPORTED_AT } },
        },
      },
      'vessels.self-id',
      NOW,
    );

    const context = 'vessels.urn:mrn:imo:mmsi:368434280';
    expect(snapshot?.ais.has('vessels.self-id')).toBe(false);
    expect(snapshot?.ais.get(context)?.get(SK_PATHS.name)).toBe('ZALOPHUS');
    expect(snapshot?.ais.get(context)?.get(SK_PATHS.position)).toEqual({
      latitude: 38.0464,
      longitude: -122.3103,
    });
    expect(snapshot?.aisEpochs.get(context)?.get(SK_PATHS.name)).toBe(Date.parse(REPORTED_AT));
  });

  it('does not invent freshness for an entirely undated vessel', () => {
    const snapshot = parseAisSnapshot(
      {
        undated: {
          name: 'UNKNOWN',
          navigation: { position: { latitude: 1, longitude: 2 } },
        },
      },
      undefined,
      NOW,
    );

    expect(snapshot?.ais.size).toBe(0);
  });

  it('clamps a future provider clock to snapshot receipt time', () => {
    const snapshot = parseAisSnapshot(
      {
        future: {
          navigation: {
            position: {
              value: { latitude: 1, longitude: 2 },
              timestamp: '2026-09-02T16:23:00Z',
            },
          },
        },
      },
      undefined,
      NOW,
    );

    expect(snapshot?.aisEpochs.get('vessels.future')?.get(SK_PATHS.position)).toBe(NOW);
  });
});
