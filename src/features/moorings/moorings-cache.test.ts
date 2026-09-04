import { describe, expect, it } from 'vitest';
import { createExpiringStore } from '$shared/storage';
import { createMooringsCache, MOORINGS_CACHE_TTL_MS } from './moorings-cache';
import type { MooringPoint } from './moorings-types';

const mooring: MooringPoint = {
  id: 'noaa-enc:harbour:US5TEST:42',
  name: 'Test mooring',
  position: { longitude: -123.15, latitude: 48.55 },
  scaleBand: 'harbour',
  assessment: {
    status: 'likely-occupied',
    score: 100,
    vesselId: 'urn:mrn:imo:mmsi:123456789',
    evidence: ['Old AIS evidence'],
  },
};

function memoryCache() {
  return createMooringsCache(
    createExpiringStore<unknown>('test-moorings', {
      factory: undefined,
      maxEntries: 33,
    }),
  );
}

describe('mooring position cache', () => {
  it('restores a containing saved area without replaying old AIS occupancy', async () => {
    const cache = memoryCache();
    await cache.put([-123.2, 48.5, -123.1, 48.6], [mooring], 1_000, 1_000);

    const result = await cache.find([-123.18, 48.52, -123.12, 48.58], 2_000);

    expect(result).toMatchObject({
      savedAtMs: 1_000,
      moorings: [{ name: 'Test mooring' }],
    });
    expect(result?.moorings[0]?.assessment).toEqual({
      status: 'unknown',
      score: 0,
      evidence: [],
    });
  });

  it('expires saved positions after 90 days', async () => {
    const cache = memoryCache();
    const bbox: [-123.2, 48.5, -123.1, 48.6] = [-123.2, 48.5, -123.1, 48.6];
    await cache.put(bbox, [mooring], 1_000, 1_000);

    await expect(cache.find(bbox, 1_000 + MOORINGS_CACHE_TTL_MS)).resolves.toBeUndefined();
  });
});
