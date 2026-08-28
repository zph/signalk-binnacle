import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import { SignalKStore } from '$shared/signalk';
import { createFakeStorage } from '$shared/testing';
import AisTargetsReactiveHarness from './AisTargetsReactiveHarness.svelte';
import { AisNameCache } from './ais-name-cache.svelte';
import { AisTargets } from './ais-targets.svelte';

describe('AisTargets reactive consumers', () => {
  it('can cache a reported name while a derived view reads the target list', () => {
    const now = 1_000;
    const store = new SignalKStore();
    const storage = createFakeStorage();
    const targets = new AisTargets(store, () => now, new AisNameCache(storage, () => now));
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.urn:mrn:imo:mmsi:368123456',
          new Map<string, unknown>([
            ['navigation.position', { latitude: 38, longitude: -122 }],
            ['name', 'WANDERER'],
          ]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: now,
    });
    const host = document.createElement('div');
    let component!: ReturnType<typeof mount>;

    expect(() => {
      flushSync(() => {
        component = mount(AisTargetsReactiveHarness, { target: host, props: { targets } });
      });
    }).not.toThrow();
    expect(host.textContent).toBe('WANDERER');

    flushSync(() => void unmount(component));
  });
});
