import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LatLon } from '$shared/geo';
import { createFollowController } from './follow-controller.svelte';

const mountedCleanups: Array<() => void> = [];

function mount(options: { commandsReady?: boolean; lookAheadPx?: number } = {}) {
  const vessel = $state<{ position: LatLon | undefined; positionStale: boolean }>({
    position: undefined,
    positionStale: false,
  });
  const recenterOnVessel = vi.fn();
  const commands = $state<{ current: { recenterOnVessel: typeof recenterOnVessel } | undefined }>({
    current: options.commandsReady === false ? undefined : { recenterOnVessel },
  });
  const lookAhead = $state({ value: options.lookAheadPx ?? 0 });
  let controller!: ReturnType<typeof createFollowController>;
  let disposeRoot!: () => void;
  flushSync(() => {
    disposeRoot = $effect.root(() => {
      controller = createFollowController({
        vessel,
        commands: () => commands.current,
        lookAheadPx: () => lookAhead.value,
      });
    });
  });
  mountedCleanups.push(disposeRoot);
  return { vessel, recenterOnVessel, commands, lookAhead, controller };
}

afterEach(() => {
  for (const cleanup of mountedCleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});

describe('createFollowController', () => {
  it('recenters immediately on enable and again on each new fix', () => {
    const test = mount();
    test.vessel.position = { latitude: 60, longitude: 24 };
    flushSync();
    expect(test.recenterOnVessel).not.toHaveBeenCalled();

    test.controller.toggle();
    flushSync();
    expect(test.recenterOnVessel).toHaveBeenCalledExactlyOnceWith(60, 24, 0);

    test.vessel.position = { latitude: 60.001, longitude: 24.001 };
    flushSync();
    expect(test.recenterOnVessel).toHaveBeenCalledTimes(2);
    expect(test.recenterOnVessel).toHaveBeenLastCalledWith(60.001, 24.001, 0);
  });

  it('coalesces stationary GPS noise but follows meaningful underway motion', () => {
    const test = mount();
    const position = { latitude: 60, longitude: 24 };
    test.vessel.position = position;
    test.controller.toggle();
    flushSync();
    test.recenterOnVessel.mockClear();

    for (let index = 0; index < 1_000; index += 1) {
      const sign = index % 2 === 0 ? 1 : -1;
      test.vessel.position = {
        latitude: position.latitude + sign * 0.000_001,
        longitude: position.longitude - sign * 0.000_001,
      };
      flushSync();
    }
    expect(test.recenterOnVessel).not.toHaveBeenCalled();

    test.vessel.position = { latitude: 60.001, longitude: 24 };
    flushSync();
    expect(test.recenterOnVessel).toHaveBeenCalledExactlyOnceWith(60.001, 24, 0);
  });

  it('recenters when the look-ahead layout changes or follow is re-enabled', () => {
    const test = mount({ lookAheadPx: 0 });
    test.vessel.position = { latitude: 60, longitude: 24 };
    test.controller.toggle();
    flushSync();
    test.recenterOnVessel.mockClear();

    test.lookAhead.value = 140;
    flushSync();
    expect(test.recenterOnVessel).toHaveBeenCalledExactlyOnceWith(60, 24, 140);

    test.controller.toggle();
    test.controller.toggle();
    flushSync();
    expect(test.recenterOnVessel).toHaveBeenCalledTimes(2);
  });

  it('stays armed through a stale fix and resumes when the fix recovers', () => {
    const test = mount();
    test.vessel.position = { latitude: 60, longitude: 24 };
    test.controller.toggle();
    flushSync();
    test.recenterOnVessel.mockClear();

    test.vessel.positionStale = true;
    flushSync();
    expect(test.controller.following).toBe(true);

    test.vessel.position = { latitude: 60.01, longitude: 24.01 };
    flushSync();
    expect(test.recenterOnVessel).not.toHaveBeenCalled();

    test.vessel.positionStale = false;
    flushSync();
    expect(test.recenterOnVessel).toHaveBeenCalledExactlyOnceWith(60.01, 24.01, 0);
  });

  it('release disarms follow and stops recentering on later fixes', () => {
    const test = mount();
    test.vessel.position = { latitude: 60, longitude: 24 };
    test.controller.toggle();
    flushSync();
    test.recenterOnVessel.mockClear();

    test.controller.release();
    flushSync();
    expect(test.controller.following).toBe(false);

    test.vessel.position = { latitude: 61, longitude: 25 };
    flushSync();
    expect(test.recenterOnVessel).not.toHaveBeenCalled();
  });

  it('does not recenter while the map commands are not ready, then recenters when they arrive', () => {
    const test = mount({ commandsReady: false });
    test.vessel.position = { latitude: 60, longitude: 24 };
    test.controller.toggle();
    flushSync();
    expect(test.recenterOnVessel).not.toHaveBeenCalled();

    test.commands.current = { recenterOnVessel: test.recenterOnVessel };
    flushSync();
    expect(test.recenterOnVessel).toHaveBeenCalledExactlyOnceWith(60, 24, 0);
  });
});
