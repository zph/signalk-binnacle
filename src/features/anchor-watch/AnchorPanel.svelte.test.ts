import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { AnchorWatch } from '$entities/anchor';
import type { UnitsStore } from '$entities/units';
import type { DepthReading, OwnVessel } from '$entities/vessel';
import type { AlarmAudioState } from '$shared/audio';
import type { AuthController } from '$shared/signalk';
import AnchorPanel from './AnchorPanel.svelte';

const NO_DEPTH: DepthReading = {
  meters: undefined,
  source: undefined,
  path: 'environment.depth.belowTransducer',
  stale: false,
};

function renderPanel(
  mode: 'imperial' | 'metric',
  anchorDepth: DepthReading = NO_DEPTH,
  safetyDepth: DepthReading = NO_DEPTH,
  auth: AuthController = { writeBlocked: false } as AuthController,
  extras: { anchor?: Record<string, unknown>; audioState?: AlarmAudioState } = {},
): string {
  return render(AnchorPanel, {
    props: {
      auth,
      anchor: {
        watching: false,
        fixLost: false,
        distanceMeters: undefined,
        mode: 'off',
        radiusMeters: undefined,
        preferredRadiusMeters: 30,
        degradedCause: undefined,
        dragging: false,
        ...extras.anchor,
      } as unknown as AnchorWatch,
      vessel: {
        position: { latitude: 42, longitude: -83 },
        positionStale: false,
        anchorDepth,
        safetyDepth,
      } as OwnVessel,
      units: { mode } as UnitsStore,
      audioState: extras.audioState ?? 'ready',
      onDrop: vi.fn(),
      onRaise: vi.fn(),
      onSetRadius: vi.fn(),
      onClose: vi.fn(),
    },
  }).body;
}

function blockedAuth(upgrading: boolean): AuthController {
  return {
    writeBlocked: true,
    upgrading,
    requestWriteAccess: vi.fn(),
  } as unknown as AuthController;
}

describe('AnchorPanel', () => {
  it('renders the resolved watch-radius unit in the accessible name', () => {
    expect(renderPanel('metric')).toContain('aria-label="Watch radius in meters"');
    expect(renderPanel('imperial')).toContain('aria-label="Watch radius in feet"');
  });

  it('shows the server polygon and offers its editor without a misleading radius control', () => {
    const html = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, {
      anchor: {
        watching: true,
        mode: 'server',
        zone: {
          type: 'polygon',
          vertices: [
            { bearing: 0, distance: 20 },
            { bearing: 120, distance: 30 },
            { bearing: 240, distance: 40 },
          ],
        },
      },
    });
    expect(html).toContain('Polygon');
    expect(html).toContain('/hoekens-anchor-alarm/');
    expect(html).not.toContain('aria-label="Watch radius in meters"');
  });

  it('names the depth reference beside the reading', () => {
    const html = renderPanel('metric', {
      meters: 9,
      source: 'surface',
      path: 'environment.depth.belowSurface',
      stale: false,
    });
    expect(html).toContain('Depth (Surface)');
    expect(html).toContain('title="Depth below the surface"');
    expect(html).toContain('9.0');
  });

  it('holds out no depth value once the reading goes stale', () => {
    const html = renderPanel('metric', {
      meters: 9,
      source: 'surface',
      path: 'environment.depth.belowSurface',
      stale: true,
    });
    expect(html).toContain('Depth (Surface)');
    expect(html).not.toContain('9.0');
  });

  it('omits the depth row until a depth source reports', () => {
    expect(renderPanel('metric')).not.toContain('Depth (');
  });

  it('offers the read/write request while server anchor changes are blocked', () => {
    const body = renderPanel('metric', NO_DEPTH, NO_DEPTH, blockedAuth(false));

    expect(body).toContain('Anchor watch requires server read and write access.');
    expect(body).toContain('Request read and write access');
  });

  it('rests the request control while a request is outstanding', () => {
    expect(renderPanel('metric', NO_DEPTH, NO_DEPTH, blockedAuth(true))).toMatch(
      /<button[^>]+disabled[^>]*>\s*Requesting access/,
    );
  });

  it('warns when a previous browser-only watch was retired', () => {
    const retired = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, {
      anchor: {
        retiredLocalWatch: true,
      },
    });
    expect(retired).toContain('A previous browser-only anchor watch has been stopped.');
  });

  it('alarms the status line for stale server state', () => {
    // The panel words server-stale from the ungraced immediate cause, before the live region's
    // grace has held: the reassuring mode text must not stand in for untrusted geometry.
    const stale = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, {
      anchor: { watching: true, mode: 'server', immediateDegradedCause: 'server-stale' },
    });
    expect(stale).toContain('Last known server anchor only.');
    expect(stale).toContain('status--alarm');
  });

  it('shows cached server geometry as last known and disables watch actions', () => {
    const stale = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, {
      anchor: {
        watching: true,
        mode: 'server',
        degraded: true,
        immediateDegradedCause: 'server-stale',
        lastKnownPosition: { latitude: 37.8, longitude: -122.4 },
        lastKnownRadiusMeters: 60,
        lastKnownAt: 1_700_000_000_000,
      },
    });
    expect(stale).toContain('Last reported anchor: 37.80000°');
    expect(stale).toContain('-122.40000°');
    expect(stale).toContain('These cached values are read-only');
    expect(stale).toContain('>60</span>');
    expect(stale).toMatch(/<button[^>]*disabled[^>]*>\s*<[^>]+>.*Raise anchor/s);
  });

  it('keeps the reconnect blip (degraded without a cause yet) off the status line', () => {
    const body = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, {
      anchor: { watching: true, mode: 'server', degradedCause: undefined },
    });
    expect(body).toContain('Watching on the server.');
    expect(body).not.toContain('status--alarm');
  });

  it('warns that alarms are visual-only while audio is blocked', () => {
    const blocked = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, { audioState: 'blocked' });
    expect(blocked).toContain('Alarm sound is off');
    expect(renderPanel('metric')).not.toContain('Alarm sound is off');
  });

  it('states a failed or unsupported audio device, which the status strip no longer reports', () => {
    const failed = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, { audioState: 'failed' });
    expect(failed).toContain('failed to start');
    const unsupported = renderPanel('metric', NO_DEPTH, NO_DEPTH, undefined, {
      audioState: 'unsupported',
    });
    expect(unsupported).toContain('Audible alarms are unavailable');
    // Terminal and gesture-recoverable states must not be flattened into one message.
    expect(unsupported).not.toContain('Any tap');
  });

  it('explains the missing depth row on a keel-only sounder', () => {
    const keelOnly: DepthReading = {
      meters: 4,
      source: 'keel',
      path: 'environment.depth.belowKeel',
      stale: false,
    };
    const body = renderPanel('metric', NO_DEPTH, keelOnly);
    expect(body).not.toContain('Depth (');
    expect(body).toContain('The sounder publishes keel depth only');
  });
});
