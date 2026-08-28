import { describe, expect, it } from 'vitest';
import { binnacleStorageKey } from '$shared/persistence';
import { createFakeStorage } from '$shared/testing';
import { AIS_NAME_CACHE_TTL_MS, AisNameCache } from './ais-name-cache.svelte';

const KEY = binnacleStorageKey('aisNames');

describe('AisNameCache', () => {
  it('restores a recently heard name across instances', () => {
    let now = 1_000;
    const storage = createFakeStorage();
    const first = new AisNameCache(storage, () => now);
    first.remember('368123456', 'WANDERER', now);

    now += 60_000;
    const restored = new AisNameCache(storage, () => now);
    expect(restored.lookup('368123456')).toEqual({
      name: 'WANDERER',
      expiresAt: 1_000 + AIS_NAME_CACHE_TTL_MS,
    });
  });

  it('expires and removes a name 24 hours after it was last heard', () => {
    let now = 1_000;
    const storage = createFakeStorage();
    const cache = new AisNameCache(storage, () => now);
    cache.remember('368123456', 'WANDERER', now);

    now += AIS_NAME_CACHE_TTL_MS;
    expect(cache.lookup('368123456')).toBeUndefined();
    expect(JSON.parse(storage.data.get(KEY) ?? 'null')).toEqual([]);
  });

  it('rolls the expiry forward when the name is heard again', () => {
    let now = 1_000;
    const storage = createFakeStorage();
    const cache = new AisNameCache(storage, () => now);
    cache.remember('368123456', 'WANDERER', now);

    now += 12 * 60 * 60_000;
    cache.remember('368123456', 'WANDERER', now);
    now += 13 * 60 * 60_000;
    expect(cache.lookup('368123456')?.name).toBe('WANDERER');
  });

  it('rejects non-MMSI identifiers and malformed names', () => {
    const storage = createFakeStorage();
    const cache = new AisNameCache(storage, () => 1_000);
    cache.remember('vessels.somewhere', 'WANDERER', 1_000);
    cache.remember('368123456', '\u0000bad', 1_000);
    expect(cache.lookup('368123456')).toBeUndefined();
    expect(storage.data.has(KEY)).toBe(false);
  });
});
