import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnchorDegradedCause, AnchorWatch } from '$entities/anchor';
import type { OwnVessel } from '$entities/vessel';
import type { GatedAlarm } from '$shared/audio';
import { stubFetch } from '$shared/testing';
import { createAnchorController } from './anchor-controller.svelte';

interface AnchorFake {
  degradedCause: AnchorDegradedCause | undefined;
  dragging: boolean;
  acknowledged: boolean;
  retiredLocalWatch: boolean;
}

function controllerWith(overrides: Partial<AnchorFake>) {
  const anchor = {
    degradedCause: undefined,
    dragging: false,
    acknowledged: false,
    retiredLocalWatch: false,
    mode: 'off',
    updateFix: vi.fn(),
    ...overrides,
  } as unknown as AnchorWatch;
  return createAnchorController({
    origin: 'http://sk',
    getToken: () => undefined,
    anchor,
    vessel: { position: undefined, positionStale: false } as unknown as OwnVessel,
    anchorAlarm: { update: vi.fn() } as unknown as GatedAlarm,
    serverHasAnchorApi: () => false,
    writeBlocked: () => false,
  });
}

describe('createAnchorController', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('announces a retired browser-only watch', () => {
    expect(controllerWith({ retiredLocalWatch: true }).anchorAlert).toBe(
      'Previous browser-only anchor watch stopped. Set a server anchor watch before relying on an alarm.',
    );
  });

  it('words a held server-stale window as a reconnect, never a GPS loss', () => {
    expect(controllerWith({ degradedCause: 'server-stale' }).anchorAlert).toBe(
      'Last known server anchor only. Connection lost or state not refreshed; watch status is unconfirmed.',
    );
  });

  it('announces a drag only while unacknowledged, and stays quiet otherwise', () => {
    expect(controllerWith({ dragging: true }).anchorAlert).toBe(
      'Anchor alarm: the boat is dragging.',
    );
    expect(controllerWith({ dragging: true, acknowledged: true }).anchorAlert).toBe('');
    expect(controllerWith({}).anchorAlert).toBe('');
  });

  it('does not arm or log a browser watch when the server refuses a drop', async () => {
    const fetch = stubFetch({ ok: false });
    const onAnchorLogMoment = vi.fn();
    const anchor = {
      mode: 'off',
      preferredRadiusMeters: 45,
      updateFix: vi.fn(),
    } as unknown as AnchorWatch;
    const controller = createAnchorController({
      origin: 'http://sk',
      getToken: () => undefined,
      anchor,
      vessel: {
        position: { latitude: 1, longitude: 2 },
        positionStale: false,
      } as OwnVessel,
      anchorAlarm: { update: vi.fn() } as unknown as GatedAlarm,
      serverHasAnchorApi: () => false,
      writeBlocked: () => false,
      onAnchorLogMoment,
    });
    await controller.onDrop();
    expect(fetch).toHaveBeenCalledOnce();
    expect(anchor.mode).toBe('off');
    expect(onAnchorLogMoment).not.toHaveBeenCalled();
    expect(controller.anchorError).toContain('do not rely on an alarm');
  });

  it('refuses to change a watch using only cached server state', async () => {
    const fetch = stubFetch({ ok: true });
    const anchor = {
      mode: 'server',
      watching: true,
      degraded: true,
      updateFix: vi.fn(),
    } as unknown as AnchorWatch;
    const controller = createAnchorController({
      origin: 'http://sk',
      getToken: () => undefined,
      anchor,
      vessel: { position: undefined, positionStale: false } as OwnVessel,
      anchorAlarm: { update: vi.fn() } as unknown as GatedAlarm,
      serverHasAnchorApi: () => false,
      writeBlocked: () => false,
    });
    await controller.onRaise();
    expect(fetch).not.toHaveBeenCalled();
    expect(controller.anchorError).toContain('reconnect first');
  });
});
