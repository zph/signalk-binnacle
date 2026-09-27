import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnchorDegradedCause, AnchorWatch } from '$entities/anchor';
import type { OwnVessel } from '$entities/vessel';
import type { GatedAlarm } from '$shared/audio';
import type { AnchorCommands } from './anchor-commands';
import { createAnchorController } from './anchor-controller.svelte';

function commands(): AnchorCommands {
  return {
    drop: vi.fn().mockResolvedValue(false),
    raise: vi.fn().mockResolvedValue(false),
    setZone: vi.fn().mockResolvedValue(false),
  };
}

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
    commands: commands(),
    anchor,
    vessel: { position: undefined, positionStale: false } as unknown as OwnVessel,
    anchorAlarm: { update: vi.fn() } as unknown as GatedAlarm,
    writeBlocked: () => false,
  });
}

describe('createAnchorController', () => {
  afterEach(() => vi.clearAllMocks());

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
    const server = commands();
    const onAnchorLogMoment = vi.fn();
    const anchor = {
      mode: 'off',
      preferredRadiusMeters: 45,
      updateFix: vi.fn(),
    } as unknown as AnchorWatch;
    const controller = createAnchorController({
      commands: server,
      anchor,
      vessel: {
        position: { latitude: 1, longitude: 2 },
        positionStale: false,
      } as OwnVessel,
      anchorAlarm: { update: vi.fn() } as unknown as GatedAlarm,
      writeBlocked: () => false,
      onAnchorLogMoment,
    });
    await controller.onDrop();
    expect(server.drop).toHaveBeenCalledExactlyOnceWith(
      { latitude: 1, longitude: 2 },
      { type: 'circle', radius: 45 },
    );
    expect(anchor.mode).toBe('off');
    expect(onAnchorLogMoment).not.toHaveBeenCalled();
    expect(controller.anchorError).toContain('do not rely on an alarm');
  });

  it('refuses to change a watch using only cached server state', async () => {
    const server = commands();
    const anchor = {
      mode: 'server',
      watching: true,
      degraded: true,
      updateFix: vi.fn(),
    } as unknown as AnchorWatch;
    const controller = createAnchorController({
      commands: server,
      anchor,
      vessel: { position: undefined, positionStale: false } as OwnVessel,
      anchorAlarm: { update: vi.fn() } as unknown as GatedAlarm,
      writeBlocked: () => false,
    });
    await controller.onRaise();
    expect(server.raise).not.toHaveBeenCalled();
    expect(controller.anchorError).toContain('reconnect first');
  });

  it('uses the injected commands for an active server watch', async () => {
    const server = commands();
    vi.mocked(server.raise).mockResolvedValue(true);
    vi.mocked(server.setZone).mockResolvedValue(true);
    const rememberRadius = vi.fn();
    const anchor = {
      mode: 'server',
      watching: true,
      degraded: false,
      zone: { type: 'circle', radius: 45 },
      updateFix: vi.fn(),
      rememberRadius,
    } as unknown as AnchorWatch;
    const controller = createAnchorController({
      commands: server,
      anchor,
      vessel: { position: undefined, positionStale: false } as OwnVessel,
      anchorAlarm: { update: vi.fn() } as unknown as GatedAlarm,
      writeBlocked: () => false,
    });

    await controller.onSetRadius(60);
    await controller.onAnchorMoved({ latitude: 1.5, longitude: -2.5 });
    await controller.onRaise();

    expect(server.setZone).toHaveBeenNthCalledWith(1, { type: 'circle', radius: 60 });
    expect(server.setZone).toHaveBeenNthCalledWith(
      2,
      { type: 'circle', radius: 45 },
      {
        latitude: 1.5,
        longitude: -2.5,
      },
    );
    expect(server.raise).toHaveBeenCalledOnce();
    expect(rememberRadius).toHaveBeenCalledExactlyOnceWith(60);
  });
});
