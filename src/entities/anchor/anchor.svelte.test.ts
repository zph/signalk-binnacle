import { describe, expect, it } from 'vitest';
import { OwnVessel } from '$entities/vessel';
import { SignalKStore } from '$shared/signalk';
import { createFakeStorage, createFrameFactory } from '$shared/testing';
import { AnchorWatch } from './anchor.svelte';

const frame = createFrameFactory();

// About 111 meters per 0.001 degree of latitude, so these fixes sit well outside a 50 m radius.
const ANCHOR = { latitude: 0, longitude: 0 };
const INSIDE = { latitude: 0.0002, longitude: 0 };

function setup(seed?: Record<string, string>) {
  const store = new SignalKStore();
  const vessel = new OwnVessel(store);
  const anchor = new AnchorWatch(store, vessel, undefined, createFakeStorage(seed));
  const fix = (position: { latitude: number; longitude: number }) => {
    store.applyFrame(frame({ 'navigation.position': position }));
    anchor.updateFix();
  };
  return { store, anchor, fix };
}

describe('AnchorWatch (server-only)', () => {
  it('starts off with no browser-only watch', () => {
    const { anchor } = setup();
    expect(anchor.mode).toBe('off');
    expect(anchor.watching).toBe(false);
  });

  it('retires an old browser-only watch without promoting its coordinates', () => {
    const storage = createFakeStorage({
      'binnacle-custom:anchor-watch': JSON.stringify({
        position: ANCHOR,
        radiusMeters: 50,
        dragging: false,
      }),
    });
    const store = new SignalKStore();
    const anchor = new AnchorWatch(store, new OwnVessel(store), undefined, storage);
    expect(anchor.mode).toBe('off');
    expect(anchor.retiredLocalWatch).toBe(true);
    expect(storage.getItem('binnacle-custom:anchor-watch')).not.toContain('radiusMeters');
    store.applyFrame(frame({ 'navigation.anchor.position': ANCHOR }));
    anchor.updateFix();
    expect(anchor.retiredLocalWatch).toBe(false);
    expect(anchor.mode).toBe('server');
  });

  it('keeps the preferred radius as a local setting, never as an active watch', () => {
    const { anchor } = setup();
    anchor.rememberRadius(70);
    expect(anchor.preferredRadiusMeters).toBe(70);
    expect(anchor.radiusMeters).toBeUndefined();
    expect(anchor.watching).toBe(false);
  });
});

describe('AnchorWatch (server mode)', () => {
  it('reflects a server watch from the stream cells', () => {
    const { store, anchor } = setup();
    store.applyFrame(
      frame({
        'navigation.anchor.position': ANCHOR,
        'navigation.anchor.maxRadius': 60,
      }),
    );
    expect(anchor.mode).toBe('server');
    expect(anchor.position).toEqual(ANCHOR);
    expect(anchor.radiusMeters).toBe(60);
    expect(anchor.zone).toEqual({ type: 'circle', radius: 60 });
  });

  it('uses Hoekens watchZone when maxRadius is null for a polygon', () => {
    const { store, anchor } = setup();
    const zone = {
      type: 'polygon',
      vertices: [
        { bearing: 0, distance: 20 },
        { bearing: 120, distance: 30 },
        { bearing: 240, distance: 40 },
      ],
    };
    store.applyFrame(
      frame({
        'navigation.anchor.position': ANCHOR,
        'navigation.anchor.maxRadius': null,
        'navigation.anchor.watchZone': zone,
      }),
    );
    expect(anchor.zone).toEqual(zone);
    expect(anchor.radiusMeters).toBeUndefined();
    store.applyFrame({ ...frame({}), connection: { phase: 'reconnecting', attempt: 1 } });
    expect(anchor.zone).toBeUndefined();
    expect(anchor.lastKnownZone).toEqual(zone);
  });

  it('does not present retained server geometry as current after reconnect', () => {
    const { store, anchor } = setup();
    store.applyFrame({
      ...frame({
        'navigation.anchor.position': ANCHOR,
        'navigation.anchor.maxRadius': 60,
        'notifications.navigation.anchor': { state: 'emergency', message: 'dragging' },
      }),
      generation: 1,
    });
    store.applyFrame({ ...frame({}), generation: 2 });

    expect(anchor.mode).toBe('server');
    expect(anchor.position).toBeUndefined();
    expect(anchor.radiusMeters).toBeUndefined();
    expect(anchor.lastKnownPosition).toEqual(ANCHOR);
    expect(anchor.lastKnownRadiusMeters).toBe(60);
    expect(anchor.lastKnownAt).toBeGreaterThan(0);
    expect(anchor.degraded).toBe(true);
    // Without a clock there is no grace window to wait out, so the cause reports immediately.
    expect(anchor.degradedCause).toBe('server-stale');
    // Keep the latched safety alarm visible while waiting for current server state.
    expect(anchor.dragging).toBe(true);
  });

  it('keeps server values read-only on disconnect and clears them after an explicit server raise', () => {
    const { store, anchor, fix } = setup();
    store.applyFrame(
      frame({
        'navigation.anchor.position': ANCHOR,
        'navigation.anchor.maxRadius': 60,
      }),
    );
    fix(INSIDE);
    store.applyFrame({
      ...frame({}),
      connection: { phase: 'reconnecting', attempt: 1 },
    });
    expect(anchor.degraded).toBe(true);
    expect(anchor.position).toBeUndefined();
    expect(anchor.radiusMeters).toBeUndefined();
    expect(anchor.distanceMeters).toBeUndefined();
    expect(anchor.lastKnownPosition).toEqual(ANCHOR);
    expect(anchor.lastKnownRadiusMeters).toBe(60);
    expect(anchor.dragging).toBe(false);
    store.applyFrame(frame({ 'navigation.anchor.position': null }));
    expect(anchor.mode).toBe('off');
    expect(anchor.lastKnownPosition).toBeUndefined();
  });

  it('does not call the watch current until both position and radius refresh after reconnect', () => {
    const { store, anchor } = setup();
    store.applyFrame({
      ...frame({ 'navigation.anchor.position': ANCHOR, 'navigation.anchor.maxRadius': 60 }),
      generation: 1,
    });
    store.applyFrame({ ...frame({}), generation: 2 });
    store.applyFrame({ ...frame({ 'navigation.anchor.position': ANCHOR }), generation: 2 });
    expect(anchor.degraded).toBe(true);
    expect(anchor.position).toBeUndefined();
    expect(anchor.lastKnownRadiusMeters).toBe(60);
    store.applyFrame({ ...frame({ 'navigation.anchor.maxRadius': 60 }), generation: 2 });
    expect(anchor.degraded).toBe(false);
    expect(anchor.position).toEqual(ANCHOR);
    expect(anchor.radiusMeters).toBe(60);
  });

  it('holds the reconnect stale blip out of degradedCause until it persists past the grace', () => {
    const store = new SignalKStore();
    const clock = $state({ now: 100_000 });
    const vessel = new OwnVessel(store, clock);
    const anchor = new AnchorWatch(store, vessel, clock, createFakeStorage());
    store.applyFrame({
      ...createFrameFactory(99_000)({ 'navigation.anchor.position': ANCHOR }),
      generation: 1,
    });
    store.applyFrame({ ...frame({}), generation: 2 });

    // Degraded flips at once so nothing safety-relevant is masked, but the cause (what the live
    // region and panel report) waits out the routine reconnect window.
    expect(anchor.degraded).toBe(true);
    expect(anchor.degradedCause).toBeUndefined();
    clock.now += 6_000;
    expect(anchor.degradedCause).toBe('server-stale');
    // The resubscribed cells arrive: the stale window ends and the cause clears with it.
    store.applyFrame({
      ...createFrameFactory(clock.now)({ 'navigation.anchor.position': ANCHOR }),
      generation: 2,
    });
    expect(anchor.degraded).toBe(false);
    expect(anchor.degradedCause).toBeUndefined();
  });

  it('clears when the plugin raises the anchor (position goes null)', () => {
    const { store, anchor } = setup();
    store.applyFrame(frame({ 'navigation.anchor.position': ANCHOR }));
    expect(anchor.watching).toBe(true);
    store.applyFrame(frame({ 'navigation.anchor.position': null }));
    expect(anchor.mode).toBe('off');
  });

  it('grades dragging from the anchor notification', () => {
    const { store, anchor } = setup();
    store.applyFrame(frame({ 'navigation.anchor.position': ANCHOR }));
    expect(anchor.dragging).toBe(false);
    store.applyFrame(
      frame({ 'notifications.navigation.anchor': { state: 'emergency', message: 'dragging' } }),
    );
    expect(anchor.dragging).toBe(true);
    store.applyFrame(
      frame({ 'notifications.navigation.anchor': { state: 'normal', message: 'ok' } }),
    );
    expect(anchor.dragging).toBe(false);
  });

  it('acknowledge silences the current grade and re-arms once the server clears', () => {
    const { store, anchor, fix } = setup();
    store.applyFrame(
      frame({
        'navigation.anchor.position': ANCHOR,
        'notifications.navigation.anchor': { state: 'emergency', message: 'dragging' },
      }),
    );
    anchor.acknowledge();
    expect(anchor.acknowledged).toBe(true);
    // Server clears, then alarms again: the old acknowledge must not silence the new alarm.
    store.applyFrame(
      frame({ 'notifications.navigation.anchor': { state: 'normal', message: 'ok' } }),
    );
    fix(INSIDE);
    store.applyFrame(
      frame({ 'notifications.navigation.anchor': { state: 'emergency', message: 'dragging' } }),
    );
    expect(anchor.acknowledged).toBe(false);
  });

  it('uses server acknowledgement status for a managed anchor notification', () => {
    const { store, anchor } = setup();
    store.applyFrame(
      frame({
        'navigation.anchor.position': ANCHOR,
        'notifications.navigation.anchor': {
          id: 'anchor-1',
          state: 'emergency',
          status: { acknowledged: false },
        },
      }),
    );
    expect(anchor.acknowledged).toBe(false);
    store.applyFrame(
      frame({
        'notifications.navigation.anchor': {
          id: 'anchor-1',
          state: 'emergency',
          status: { acknowledged: true },
        },
      }),
    );
    expect(anchor.acknowledged).toBe(true);
    store.applyFrame(
      frame({
        'notifications.navigation.anchor': {
          id: 'anchor-1',
          state: 'emergency',
          status: { acknowledged: false },
        },
      }),
    );
    expect(anchor.acknowledged).toBe(false);
  });

  it('does not retain a watch after the server raises its anchor', () => {
    const { store, anchor, fix } = setup();
    store.applyFrame(frame({ 'navigation.anchor.position': ANCHOR }));
    fix(INSIDE);
    store.applyFrame(frame({ 'navigation.anchor.position': null }));
    expect(anchor.mode).toBe('off');
  });

  it('re-arms acknowledge when the server escalates to a more severe grade', () => {
    const { store, anchor, fix } = setup();
    // Put the anchor into server mode by publishing a position cell.
    store.applyFrame(frame({ 'navigation.anchor.position': ANCHOR }));
    // Raise an alarm-grade drag notification and acknowledge it (alarm and emergency are the
    // anchor-drag grades; warn is not a dragging state).
    store.applyFrame(
      frame({ 'notifications.navigation.anchor': { state: 'alarm', message: 'dragging' } }),
    );
    fix(INSIDE);
    anchor.acknowledge();
    expect(anchor.acknowledged).toBe(true);
    // The server escalates to emergency: the acknowledge must not suppress the new grade.
    store.applyFrame(
      frame({ 'notifications.navigation.anchor': { state: 'emergency', message: 'dragging!' } }),
    );
    expect(anchor.acknowledged).toBe(false);
  });
});
