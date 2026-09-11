import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AisTargets } from '$entities/ais';
import type { Assessment } from '$entities/collision';
import { mapThemePaint, rgbaCss } from '$shared/map';
import { SignalKStore, type SKFrame } from '$shared/signalk';
import {
  createFakeMap,
  createFrameFactory,
  fakeOverlayContext,
  sourceFeatures,
} from '$shared/testing';
import { AIS_ICON_IDS, AIS_ICON_IMAGE_IDS, aisIconId, aisStaleIconId } from './ais-icon';
import { createAisOverlay } from './ais-overlay';

// Seeded from the wall clock: AIS freshness is judged against real time, so a tiny epoch would
// read as an ancient fix and filter every target out.
const frameFactory = createFrameFactory(Date.now());

function positionFrame(vessels: Record<string, { latitude: number; longitude: number }>): SKFrame {
  return frameFactory(
    {},
    Object.fromEntries(
      Object.entries(vessels).map(([id, position]) => [id, { 'navigation.position': position }]),
    ),
  );
}

class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

beforeEach(() => vi.stubGlobal('ImageData', FakeImageData));
afterEach(() => vi.unstubAllGlobals());

describe('ais overlay', () => {
  it('adds vessel images, sources, projection layers, a selection ring, and a scaled hit layer', async () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    const addLayer = vi.spyOn(map, 'addLayer');
    await overlay.add(fakeOverlayContext(map));
    expect(overlay.band).toBe('traffic');
    expect(overlay.manageable).toBe(true);
    expect(map.images.size).toBe(AIS_ICON_IMAGE_IDS.length);
    expect(map.sources.size).toBe(2);
    expect(map.layers.size).toBe(6);
    expect(map.layers.get('binnacle-ais-position-projection-connector')).toMatchObject({
      type: 'line',
      paint: {
        'line-dasharray': [1, 2],
        'line-opacity': ['*', 1, 0.22, ['coalesce', ['get', 'confidence'], 0]],
      },
    });
    expect(map.layers.get('binnacle-ais-position-projection-ghost')).toMatchObject({
      type: 'symbol',
      paint: {
        'icon-opacity': ['*', 1, 0.3, ['coalesce', ['get', 'confidence'], 0]],
      },
    });
    expect(addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'binnacle-ais-selected' }),
      'binnacle-ais-symbol',
    );
    expect(map.layers.get('binnacle-ais-selected')?.paint).toMatchObject({
      'circle-radius': ['*', 18, ['coalesce', ['get', 'iconScale'], 1]],
    });
    expect(map.layers.get('binnacle-ais-hit')?.paint).toMatchObject({
      'circle-radius': ['max', 22, ['*', 16, ['coalesce', ['get', 'iconScale'], 1]]],
    });
    expect(map.layers.get('binnacle-ais-name')).toMatchObject({
      type: 'symbol',
      filter: ['==', ['get', 'showName'], true],
      layout: {
        'text-field': ['get', 'name'],
        'text-allow-overlap': false,
      },
    });
    expect(map.setLayoutProperty).toHaveBeenCalledWith('binnacle-ais-symbol', 'icon-image', [
      'get',
      'iconImage',
    ]);
    expect(map.setLayoutProperty).toHaveBeenCalledWith('binnacle-ais-symbol', 'icon-size', [
      'coalesce',
      ['get', 'iconScale'],
      1,
    ]);
  });

  it('chooses vessel symbols from AIS type and scales them from reported length', async () => {
    const store = new SignalKStore();
    store.applyFrame(
      frameFactory(
        {},
        {
          'vessels.tanker': {
            'navigation.position': { latitude: 1, longitude: 1 },
            'design.aisShipType': { id: 83 },
            'design.length': { overall: 250 },
          },
          'vessels.tug': {
            'navigation.position': { latitude: 2, longitude: 2 },
            'design.aisShipType': { id: 52 },
            'design.length': { overall: 30 },
          },
          'vessels.motorboat': {
            'navigation.position': { latitude: 3, longitude: 3 },
            'design.aisShipType': { id: 37 },
            'design.length': { overall: 8 },
          },
          'vessels.sailboat': {
            'navigation.position': { latitude: 4, longitude: 4 },
            'design.aisShipType': { id: 36 },
          },
          'vessels.cargo': {
            'navigation.position': { latitude: 5, longitude: 5 },
            'design.aisShipType': { id: 74 },
          },
          'vessels.passenger': {
            'navigation.position': { latitude: 6, longitude: 6 },
            'design.aisShipType': { id: 61 },
          },
          'vessels.fishing': {
            'navigation.position': { latitude: 7, longitude: 7 },
            'design.aisShipType': { id: 30 },
          },
          'vessels.service': {
            'navigation.position': { latitude: 8, longitude: 8 },
            'design.aisShipType': { id: 50 },
          },
        },
      ),
    );
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    const byId = Object.fromEntries(
      sourceFeatures(map, 'binnacle-ais').map((feature) => [feature.properties?.id, feature]),
    );

    expect(byId['vessels.tanker'].properties).toMatchObject({
      iconImage: AIS_ICON_IDS.tanker,
      iconScale: 1.8,
    });
    expect(byId['vessels.tug'].properties).toMatchObject({
      iconImage: AIS_ICON_IDS.tug,
      iconScale: 1.1,
    });
    expect(byId['vessels.motorboat'].properties?.iconImage).toBe(AIS_ICON_IDS.motorboat);
    expect(byId['vessels.motorboat'].properties?.iconScale).toBeLessThan(1);
    expect(byId['vessels.sailboat'].properties).toMatchObject({
      iconImage: AIS_ICON_IDS.sailboat,
      iconScale: 1,
    });
    expect(byId['vessels.cargo'].properties).toMatchObject({
      iconImage: AIS_ICON_IDS.cargo,
      iconScale: 1,
    });
    expect(byId['vessels.passenger'].properties?.iconImage).toBe(AIS_ICON_IDS.passenger);
    expect(byId['vessels.fishing'].properties?.iconImage).toBe(AIS_ICON_IDS.fishing);
    expect(byId['vessels.service'].properties?.iconImage).toBe(AIS_ICON_IDS.service);
  });

  it('can render a generic ship for every AIS type and refreshes when the mode changes', async () => {
    let kindMode: 'type-specific' | 'generic' = 'generic';
    const store = new SignalKStore();
    store.applyFrame(
      frameFactory(
        {},
        {
          'vessels.tanker': {
            'navigation.position': { latitude: 1, longitude: 1 },
            'design.aisShipType': { id: 83 },
          },
        },
      ),
    );
    const overlay = createAisOverlay(new AisTargets(store), { kindMode: () => kindMode });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);

    expect(sourceFeatures(map, 'binnacle-ais')[0].properties?.iconImage).toBe(AIS_ICON_IDS.ship);

    kindMode = 'type-specific';
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-ais')[0].properties?.iconImage).toBe(AIS_ICON_IDS.tanker);
  });

  it('supports an explicit names-off mode and an all-names mode', async () => {
    let nameMode: 'off' | 'adaptive' | 'on' = 'off';
    const store = new SignalKStore();
    store.applyFrame(
      frameFactory(
        {},
        {
          'vessels.named': {
            name: 'WANDERER',
            'navigation.position': { latitude: 1, longitude: 1 },
          },
        },
      ),
    );
    const overlay = createAisOverlay(new AisTargets(store), { nameMode: () => nameMode });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);

    expect(sourceFeatures(map, 'binnacle-ais')[0].properties?.showName).toBe(false);

    nameMode = 'on';
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-ais')[0].properties?.showName).toBe(true);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      'binnacle-ais-name',
      'text-allow-overlap',
      true,
    );
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      'binnacle-ais-name',
      'text-ignore-placement',
      true,
    );
  });

  it('shows adaptive names only when zoomed in and suppresses a crowded screen area', async () => {
    const store = new SignalKStore();
    store.applyFrame(
      frameFactory(
        {},
        Object.fromEntries(
          [
            ['isolated', 10, 10],
            ['crowded-a', 30, 30],
            ['crowded-b', 31, 30],
            ['crowded-c', 32, 30],
            ['crowded-d', 33, 30],
          ].map(([id, longitude, latitude]) => [
            `vessels.${id}`,
            {
              name: String(id).toUpperCase(),
              'navigation.position': { latitude, longitude },
            },
          ]),
        ),
      ),
    );
    const overlay = createAisOverlay(new AisTargets(store), { nameMode: () => 'adaptive' });
    const map = createFakeMap();
    let zoom = 15;
    map.getZoom = () => zoom;
    map.getCenter = () => ({ lat: 0, lng: 0 });
    map.getCanvas().getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    map.project = (coordinate) => {
      const [longitude, latitude] = Array.isArray(coordinate)
        ? coordinate
        : [coordinate.lng, coordinate.lat];
      return { x: longitude * 10, y: latitude * 10 };
    };
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    const shownIds = () =>
      sourceFeatures(map, 'binnacle-ais')
        .filter((feature) => feature.properties?.showName)
        .map((feature) => feature.properties?.id);

    expect(shownIds()).toEqual([]);

    zoom = 16;
    overlay.sync(ctx);
    expect(shownIds()).toEqual(['vessels.isolated']);

    zoom = 15;
    overlay.sync(ctx);
    expect(shownIds()).toEqual([]);
  });

  it('colors target icons from the live CPA assessment and refreshes when a grade changes', async () => {
    const store = new SignalKStore();
    const targets = new AisTargets(store);
    store.applyFrame(
      positionFrame({
        'vessels.danger': { latitude: 1, longitude: 2 },
        'vessels.warning': { latitude: 3, longitude: 4 },
        'vessels.clear': { latitude: 5, longitude: 6 },
      }),
    );
    let assessment: Assessment = {
      contacts: [
        {
          id: 'vessels.danger',
          position: { latitude: 1, longitude: 2 },
          cpaMeters: 100,
          tcpaSeconds: 60,
          severity: 'danger',
          source: 'provider',
        },
        {
          id: 'vessels.warning',
          position: { latitude: 3, longitude: 4 },
          cpaMeters: 1_000,
          tcpaSeconds: 600,
          severity: 'warning',
          source: 'provider',
        },
      ],
      worst: 'danger',
      unassessed: [],
    };
    const overlay = createAisOverlay(targets, { assessment: () => assessment });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);

    const featuresById = () =>
      Object.fromEntries(
        sourceFeatures(map, 'binnacle-ais').map((feature) => [feature.properties?.id, feature]),
      );
    expect(featuresById()['vessels.danger'].properties).toMatchObject({
      severity: 'danger',
      iconImage: aisIconId('ship', 'danger'),
    });
    expect(featuresById()['vessels.warning'].properties).toMatchObject({
      severity: 'warning',
      iconImage: aisIconId('ship', 'warning'),
    });
    expect(featuresById()['vessels.clear'].properties).toMatchObject({
      severity: 'clear',
      iconImage: aisIconId('ship', 'clear'),
    });

    assessment = { contacts: [], worst: 'clear', unassessed: [] };
    overlay.sync(ctx);
    expect(featuresById()['vessels.danger'].properties).toMatchObject({
      severity: 'clear',
      iconImage: aisIconId('ship', 'clear'),
    });
  });

  it('renders an old retained target with a gray stale icon and reduced opacity', async () => {
    const now = 60 * 60_000;
    const store = new SignalKStore();
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.zalophus',
          new Map<string, unknown>([
            ['navigation.position', { latitude: 38.04, longitude: -122.31 }],
            ['design.aisShipType', { id: 30 }],
          ]),
        ],
      ]),
      aisEpochs: new Map([
        [
          'vessels.zalophus',
          new Map([
            ['navigation.position', now - 30 * 60_000],
            ['design.aisShipType', now - 30 * 60_000],
          ]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: now,
    });
    const targets = new AisTargets(store, () => now);
    const map = createFakeMap();
    await createAisOverlay(targets, { now: () => now }).add(fakeOverlayContext(map));

    const feature = sourceFeatures(map, 'binnacle-ais')[0];
    expect(feature.properties?.iconImage).toBe(aisStaleIconId('fishing'));
    expect(feature.properties?.ageOpacity).toBeCloseTo(6 / 11);
  });

  it('projects between fixes and reconciles immediately to a new reported position', async () => {
    let now = 10_000;
    const store = new SignalKStore();
    const targets = new AisTargets(store, () => now);
    const overlay = createAisOverlay(targets, { now: () => now });
    const map = createFakeMap();
    map.project = (coordinate) => {
      const [longitude, latitude] = Array.isArray(coordinate)
        ? coordinate
        : [coordinate.lng, coordinate.lat];
      return { x: longitude * 111_320, y: latitude * -111_320 };
    };
    const ctx = fakeOverlayContext(map);
    const moving = (longitude: number): SKFrame => ({
      self: new Map(),
      ais: new Map([
        [
          'vessels.moving',
          new Map<string, unknown>([
            ['navigation.position', { latitude: 0, longitude }],
            ['navigation.courseOverGroundTrue', Math.PI / 2],
            ['navigation.speedOverGround', 5],
          ]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: now,
    });

    store.applyFrame(moving(0));
    await overlay.add(ctx);
    expect(sourceFeatures(map, 'binnacle-ais-position-projection')).toEqual([]);

    now += 2_000;
    overlay.sync(ctx);
    const projected = sourceFeatures(map, 'binnacle-ais-position-projection');
    expect(projected).toHaveLength(2);
    expect(
      projected.find((feature) => feature.properties?.projectionPart === 'ghost')?.geometry,
    ).toMatchObject({ type: 'Point' });

    // The authoritative source deliberately coalesces steady position churn to 1 Hz. Advance to
    // that bounded paint tick, where the received fix replaces the estimate and resets its clock.
    now += 1_000;
    store.applyFrame(moving(0.001));
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-ais-position-projection')).toEqual([]);
    expect((sourceFeatures(map, 'binnacle-ais')[0].geometry as GeoJSON.Point).coordinates[0]).toBe(
      0.001,
    );

    now += 2_000;
    overlay.sync(ctx);
    const connector = sourceFeatures(map, 'binnacle-ais-position-projection').find(
      (feature) => feature.properties?.projectionPart === 'connector',
    );
    expect(connector).toBeDefined();
    expect((connector?.geometry as GeoJSON.LineString | undefined)?.coordinates[0][0]).toBe(0.001);
  });

  it('does not invalidate MapLibre while the periodic projection remains empty', async () => {
    let now = 10_000;
    const store = new SignalKStore();
    const targets = new AisTargets(store, () => now);
    const overlay = createAisOverlay(targets, { now: () => now });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    const projection = map.sources.get('binnacle-ais-position-projection');
    if (!projection?.setData) throw new Error('AIS projection source was not added');
    const setData = vi.spyOn(projection, 'setData');

    for (let tick = 0; tick < 10; tick += 1) {
      now += 1_000;
      overlay.sync(ctx);
    }

    expect(setData).not.toHaveBeenCalled();
  });

  it('does not repaint fresh AIS objects whose rendered values remain unchanged', async () => {
    let now = 20_000;
    const store = new SignalKStore();
    const targets = new AisTargets(store, () => now);
    const overlay = createAisOverlay(targets, { now: () => now });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    const unchangedFrame = (): SKFrame => ({
      self: new Map(),
      ais: new Map([
        [
          'vessels.stationary',
          new Map<string, unknown>([
            ['navigation.position', { latitude: 1, longitude: 2 }],
            ['navigation.courseOverGroundTrue', 0],
            ['navigation.speedOverGround', 0],
          ]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: now,
    });
    store.applyFrame(unchangedFrame());
    await overlay.add(ctx);
    const aisSource = map.sources.get('binnacle-ais');
    const projectionSource = map.sources.get('binnacle-ais-position-projection');
    if (!aisSource?.setData || !projectionSource?.setData) {
      throw new Error('AIS sources were not added');
    }
    const setAisData = vi.spyOn(aisSource, 'setData');
    const setProjectionData = vi.spyOn(projectionSource, 'setData');

    for (let update = 0; update < 20; update += 1) {
      now += 1_000;
      store.applyFrame(unchangedFrame());
      overlay.sync(ctx);
    }

    expect(setAisData).not.toHaveBeenCalled();
    expect(setProjectionData).not.toHaveBeenCalled();
  });

  it('resets the projection clock when an identical position is republished', async () => {
    let now = 20_000;
    const store = new SignalKStore();
    const targets = new AisTargets(store, () => now);
    const overlay = createAisOverlay(targets, { now: () => now });
    const map = createFakeMap();
    map.project = (coordinate) => {
      const [longitude, latitude] = Array.isArray(coordinate)
        ? coordinate
        : [coordinate.lng, coordinate.lat];
      return { x: longitude * 111_320, y: latitude * -111_320 };
    };
    const ctx = fakeOverlayContext(map);
    const frameAtNow = (): SKFrame => ({
      self: new Map(),
      ais: new Map([
        [
          'vessels.same',
          new Map<string, unknown>([
            ['navigation.position', { latitude: 0, longitude: 0 }],
            ['navigation.courseOverGroundTrue', Math.PI / 2],
            ['navigation.speedOverGround', 5],
          ]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: now,
    });

    store.applyFrame(frameAtNow());
    await overlay.add(ctx);
    now += 2_000;
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-ais-position-projection')).toHaveLength(2);
    const version = targets.version;

    // This lands inside the periodic projection repaint interval. A fresh fix must invalidate the
    // ghost immediately even though its quantized coordinate (and rendered target view) is equal.
    now += 100;
    store.applyFrame(frameAtNow());
    expect(targets.version).toBe(version);
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-ais-position-projection')).toEqual([]);
  });

  it('syncs one feature per positioned target', async () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.a',
          new Map<string, unknown>([['navigation.position', { latitude: 1, longitude: 2 }]]),
        ],
        ['vessels.b', new Map<string, unknown>([['name', 'no pos']])],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: Date.now(),
    });
    overlay.sync(fakeOverlayContext(map));
    const source = [...map.sources.values()][0];
    const fc = source.data as { features: unknown[] };
    expect(fc.features).toHaveLength(1);
  });

  it('retains stale targets for pruning but does not render a stale position', async () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.old',
          new Map<string, unknown>([['navigation.position', { latitude: 1, longitude: 2 }]]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      // Hours past the position TTL. The entity retains it until the prune timer runs, but the
      // overlay must not present the old position as current traffic.
      epoch: Date.now() - 10_000_000,
    });
    overlay.sync(fakeOverlayContext(map));
    const source = [...map.sources.values()][0];
    const fc = source.data as { features: unknown[] };
    expect(fc.features).toHaveLength(0);
    expect(store.aisTargets.size).toBe(1);
  });

  it('removes a target when its position expires without an AIS version update', async () => {
    let now = 1_000;
    const store = new SignalKStore();
    const targets = new AisTargets(store, () => now);
    const overlay = createAisOverlay(targets, { now: () => now });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.expiring',
          new Map<string, unknown>([['navigation.position', { latitude: 1, longitude: 2 }]]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: now,
    });
    await overlay.add(ctx);
    overlay.sync(ctx);
    const source = [...map.sources.values()][0];
    const version = targets.version;
    expect((source.data as GeoJSON.FeatureCollection).features).toHaveLength(1);
    const spy = vi.spyOn(source, 'setData');

    // Positions remain visible for the default 60 minutes. Crossing that boundary changes the
    // entity's clock-derived list without mutating the underlying Signal K store or its AIS version.
    now += 60 * 60_000 + 1;
    overlay.sync(ctx);

    expect(targets.version).toBe(version);
    expect(spy).toHaveBeenCalledOnce();
    expect((source.data as GeoJSON.FeatureCollection).features).toHaveLength(0);
    expect(store.aisTargets.size).toBe(1);
  });

  it('skips setData when the ais version is unchanged', async () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.a',
          new Map<string, unknown>([['navigation.position', { latitude: 1, longitude: 2 }]]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: Date.now(),
    });
    const source = [...map.sources.values()][0];
    const spy = vi.spyOn(source, 'setData');
    overlay.sync(fakeOverlayContext(map));
    overlay.sync(fakeOverlayContext(map));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('throttles steady-state position churn to about 1 Hz and paints the latest data', async () => {
    const store = new SignalKStore();
    let t = 0;
    const overlay = createAisOverlay(new AisTargets(store), { now: () => t });
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    store.applyFrame(positionFrame({ 'vessels.a': { latitude: 1, longitude: 2 } }));
    overlay.sync(fakeOverlayContext(map));
    const source = [...map.sources.values()][0];
    const spy = vi.spyOn(source, 'setData');

    store.applyFrame(positionFrame({ 'vessels.a': { latitude: 1.001, longitude: 2 } }));
    t = 250;
    overlay.sync(fakeOverlayContext(map));
    store.applyFrame(positionFrame({ 'vessels.a': { latitude: 1.002, longitude: 2 } }));
    t = 500;
    overlay.sync(fakeOverlayContext(map));
    expect(spy).not.toHaveBeenCalled();

    t = 1_000;
    overlay.sync(fakeOverlayContext(map));
    expect(spy).toHaveBeenCalledTimes(1);
    const fc = source.data as GeoJSON.FeatureCollection;
    const point = fc.features[0].geometry as GeoJSON.Point;
    expect(point.coordinates[1]).toBe(1.002);
  });

  it('paints a new target immediately even inside the throttle window', async () => {
    const store = new SignalKStore();
    let t = 0;
    const overlay = createAisOverlay(new AisTargets(store), { now: () => t });
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    store.applyFrame(positionFrame({ 'vessels.a': { latitude: 1, longitude: 2 } }));
    overlay.sync(fakeOverlayContext(map));
    const source = [...map.sources.values()][0];
    const spy = vi.spyOn(source, 'setData');

    store.applyFrame(positionFrame({ 'vessels.b': { latitude: 3, longitude: 4 } }));
    t = 100;
    overlay.sync(fakeOverlayContext(map));
    expect(spy).toHaveBeenCalledTimes(1);
    const fc = source.data as GeoJSON.FeatureCollection;
    expect(fc.features).toHaveLength(2);
  });

  it('records a selection-driven paint before the next target count change', async () => {
    let now = 1_000_000;
    let selectedId: string | undefined;
    const store = new SignalKStore();
    const targets = new AisTargets(store, () => now);
    const overlay = createAisOverlay(targets, {
      now: () => now,
      selectedId: () => selectedId,
    });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.current',
          new Map<string, unknown>([['navigation.position', { latitude: 1, longitude: 2 }]]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: now,
    });
    await overlay.add(ctx);
    overlay.sync(ctx);
    const source = [...map.sources.values()][0];
    const spy = vi.spyOn(source, 'setData');

    // This second position has only 500 ms of freshness left. Selecting the first vessel makes the
    // same sync paint both targets, and the gate must remember that two-target source snapshot.
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.expiring',
          new Map<string, unknown>([['navigation.position', { latitude: 3, longitude: 4 }]]),
        ],
      ]),
      aisEpochs: new Map([
        ['vessels.expiring', new Map([['navigation.position', now - 60 * 60_000 + 500]])],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: now,
    });
    selectedId = 'vessels.current';
    overlay.sync(ctx);
    expect((source.data as GeoJSON.FeatureCollection).features).toHaveLength(2);

    now += 501;
    overlay.sync(ctx);

    expect(spy).toHaveBeenCalledTimes(2);
    expect((source.data as GeoJSON.FeatureCollection).features).toHaveLength(1);
    expect((source.data as GeoJSON.FeatureCollection).features[0].properties?.id).toBe(
      'vessels.current',
    );
  });

  it('applyTheme recolors the icon image', async () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.applyTheme?.(fakeOverlayContext(map), mapThemePaint('night-red'));
    expect(map.updatedImages).toEqual(expect.arrayContaining(AIS_ICON_IMAGE_IDS));
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-ais-position-projection-connector',
      'line-color',
      rgbaCss(mapThemePaint('night-red').aisTarget),
    );
  });

  it('dispatches only current target ids and tears down hit handlers idempotently', async () => {
    const store = new SignalKStore();
    const targets = new AisTargets(store);
    const onSelect = vi.fn();
    const overlay = createAisOverlay(targets, { onSelect });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    store.applyFrame(positionFrame({ 'vessels.current': { latitude: 1, longitude: 2 } }));

    await overlay.add(ctx);
    await overlay.add(ctx);
    expect(map.handlerCount('click', 'binnacle-ais-hit')).toBe(1);
    map.emitLayer('mouseenter', 'binnacle-ais-hit', {});
    expect(map.getCanvas().style.cursor).toBe('pointer');

    map.emitLayer('click', 'binnacle-ais-hit', {
      features: [
        {
          geometry: { type: 'Point', coordinates: [2, 1] },
          properties: { id: 'vessels.missing' },
        },
      ],
    });
    map.emitLayer('click', 'binnacle-ais-hit', {
      features: [
        {
          geometry: {
            type: 'LineString',
            coordinates: [
              [2, 1],
              [3, 2],
            ],
          },
          properties: { id: 'vessels.current' },
        },
        {
          geometry: { type: 'Point', coordinates: [2, 1] },
          properties: { id: 'vessels.missing' },
        },
        {
          geometry: { type: 'Point', coordinates: [2, 1] },
          properties: { id: 'vessels.current' },
        },
      ],
    });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('vessels.current');

    overlay.remove(ctx);
    expect(map.handlerCount('click', 'binnacle-ais-hit')).toBe(0);
    expect(map.getCanvas().style.cursor).toBe('');
    expect(map.images.size).toBe(0);
    expect(map.sources.size).toBe(0);
    expect(map.layers.size).toBe(0);
  });

  it('preserves the chart-tool cursor and blocks selection while interactions are owned', async () => {
    const store = new SignalKStore();
    const targets = new AisTargets(store);
    const onSelect = vi.fn();
    const overlay = createAisOverlay(targets, {
      onSelect,
      interactionsAllowed: () => false,
    });
    const map = createFakeMap();
    store.applyFrame(positionFrame({ 'vessels.current': { latitude: 1, longitude: 2 } }));
    await overlay.add(fakeOverlayContext(map));
    map.getCanvas().style.cursor = 'crosshair';

    map.emitLayer('mouseenter', 'binnacle-ais-hit', {});
    map.emitLayer('click', 'binnacle-ais-hit', {
      features: [
        {
          geometry: { type: 'Point', coordinates: [2, 1] },
          properties: { id: 'vessels.current' },
        },
      ],
    });
    map.emitLayer('mouseleave', 'binnacle-ais-hit', {});

    expect(onSelect).not.toHaveBeenCalled();
    expect(map.getCanvas().style.cursor).toBe('crosshair');
  });

  it('refreshes the selected target ring without waiting for AIS churn', async () => {
    const store = new SignalKStore();
    const targets = new AisTargets(store);
    let selectedId: string | undefined;
    const overlay = createAisOverlay(targets, { selectedId: () => selectedId });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    store.applyFrame(positionFrame({ 'vessels.a': { latitude: 1, longitude: 2 } }));
    await overlay.add(ctx);
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-ais')[0]?.properties?.selected).toBe(false);

    selectedId = 'vessels.a';
    overlay.sync(ctx);

    expect(sourceFeatures(map, 'binnacle-ais')[0]?.properties?.selected).toBe(true);
  });

  it('disables the hit surface when the overlay is hidden or fully transparent', async () => {
    const overlay = createAisOverlay(new AisTargets(new SignalKStore()));
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);

    overlay.setVisible?.(ctx, false);
    expect(map.setLayoutProperty).toHaveBeenCalledWith('binnacle-ais-hit', 'visibility', 'none');

    map.setLayoutProperty.mockClear();
    overlay.setVisible?.(ctx, true);
    overlay.setOpacity?.(ctx, 0);
    expect(map.setLayoutProperty).toHaveBeenCalledWith('binnacle-ais-hit', 'visibility', 'none');
  });

  it('cancels an armed target touch and pointer when visibility or opacity changes', async () => {
    const store = new SignalKStore();
    const targets = new AisTargets(store);
    const onSelect = vi.fn();
    const overlay = createAisOverlay(targets, { onSelect });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    const originalEvent = {};
    const touchEvent = (type: string) =>
      ({
        features: [
          {
            geometry: { type: 'Point', coordinates: [2, 1] },
            properties: { id: 'vessels.current' },
          },
        ],
        originalEvent,
        point: { x: 10, y: 10 },
        points: [{ x: 10, y: 10 }],
        type,
      }) as never;
    store.applyFrame(positionFrame({ 'vessels.current': { latitude: 1, longitude: 2 } }));
    await overlay.add(ctx);

    map.emitLayer('mouseenter', 'binnacle-ais-hit', {});
    expect(map.getCanvas().style.cursor).toBe('pointer');
    map.emit('touchstart', touchEvent('touchstart'));
    map.emitLayer('touchstart', 'binnacle-ais-hit', touchEvent('touchstart'));
    overlay.setVisible?.(ctx, false);
    expect(map.getCanvas().style.cursor).toBe('');
    map.emit('touchend', touchEvent('touchend'));
    await Promise.resolve();
    expect(onSelect).not.toHaveBeenCalled();

    overlay.setVisible?.(ctx, true);
    map.emit('touchstart', touchEvent('touchstart'));
    map.emitLayer('touchstart', 'binnacle-ais-hit', touchEvent('touchstart'));
    overlay.setOpacity?.(ctx, 0);
    map.emit('touchend', touchEvent('touchend'));
    await Promise.resolve();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
