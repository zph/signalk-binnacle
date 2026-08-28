import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnVessel } from '$entities/vessel';
import { knotsToMetersPerSecond } from '$shared/lib';
import { mapThemePaint, rgbaCss } from '$shared/map';
import { geodesicDestination } from '$shared/nav';
import { SignalKStore } from '$shared/signalk';
import { createFakeMap, fakeOverlayContext, sourceFeatures } from '$shared/testing';
import { buildOwnVesselVectorFeatures, createVesselOverlay } from './vessel-overlay';

const VECTOR_SOURCE_ID = 'binnacle-own-vessel-vector';
const VECTOR_FAR_LAYER_ID = 'binnacle-own-vessel-vector-10-minute';
const VECTOR_MIDDLE_LAYER_ID = 'binnacle-own-vessel-vector-5-minute';
const VECTOR_NEAR_LAYER_ID = 'binnacle-own-vessel-vector-2-5-minute';

function applyMotion(store: SignalKStore, sogMps: number, cogRad = 0): void {
  store.applyFrame({
    self: new Map<string, unknown>([
      ['navigation.position', { latitude: 36.8, longitude: -121.7 }],
      ['navigation.speedOverGround', sogMps],
      ['navigation.courseOverGroundTrue', cogRad],
    ]),
    connection: { phase: 'open', attempt: 0 },
    epoch: 1,
  });
}

// ImageData is a browser global; the overlay builds the vessel icon with it, so the
// node test environment needs a minimal stand-in.
class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

beforeEach(() => {
  vi.stubGlobal('ImageData', FakeImageData);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('vessel overlay', () => {
  it('adds the marker and three layered course-vector horizons', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    expect(map.images.size).toBe(2);
    expect(map.sources.size).toBe(2);
    expect(map.layers.size).toBe(5);
    expect(map.layers.get(VECTOR_FAR_LAYER_ID)).toMatchObject({
      filter: ['==', ['get', 'horizon'], '10-minute'],
      paint: {
        'line-color': rgbaCss(mapThemePaint('day').aisTarget),
        'line-opacity': 0.8,
        'line-width': 2,
      },
    });
    expect(map.layers.get(VECTOR_MIDDLE_LAYER_ID)).toMatchObject({
      filter: ['==', ['get', 'horizon'], '5-minute'],
    });
    expect(map.layers.get(VECTOR_NEAR_LAYER_ID)).toMatchObject({
      filter: ['==', ['get', 'horizon'], '2.5-minute'],
    });
    expect(map.layers.get('binnacle-own-vessel-stale')).toMatchObject({
      filter: ['==', ['get', 'stale'], true],
      layout: { 'icon-rotation-alignment': 'viewport' },
    });
  });

  it('draws 10-, 5-, and 2.5-minute geodesic vectors while underway', () => {
    const store = new SignalKStore();
    applyMotion(store, 4, Math.PI / 2);
    const features = buildOwnVesselVectorFeatures(new OwnVessel(store)).features;

    expect(features.map((feature) => feature.properties?.horizon)).toEqual([
      '10-minute',
      '5-minute',
      '2.5-minute',
    ]);
    const expectedTips = [600, 300, 150].map((seconds) =>
      geodesicDestination(36.8, -121.7, Math.PI / 2, 4 * seconds),
    );
    for (const [index, feature] of features.entries()) {
      const coordinates = (feature.geometry as GeoJSON.LineString).coordinates;
      expect(coordinates[0]).toEqual([-121.7, 36.8]);
      expect(coordinates[1][0]).toBeCloseTo(expectedTips[index][0], 8);
      expect(coordinates[1][1]).toBeCloseTo(expectedTips[index][1], 8);
    }
  });

  it('hides the vector at and below 0.15 kn, or when motion is stale', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    applyMotion(store, knotsToMetersPerSecond(0.15));
    expect(buildOwnVesselVectorFeatures(vessel).features).toHaveLength(0);

    applyMotion(store, knotsToMetersPerSecond(0.151));
    expect(buildOwnVesselVectorFeatures(vessel).features).toHaveLength(3);

    store.applyFrame({
      self: new Map(),
      selfStales: new Map([
        ['navigation.position', {}],
        ['navigation.speedOverGround', {}],
        ['navigation.courseOverGroundTrue', {}],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 2,
    });
    expect(buildOwnVesselVectorFeatures(vessel).features).toHaveLength(0);
  });

  it('sync updates and clears the vector as own-vessel motion changes', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);

    applyMotion(store, 3);
    overlay.sync(ctx);
    expect(sourceFeatures(map, VECTOR_SOURCE_ID)).toHaveLength(3);

    applyMotion(store, knotsToMetersPerSecond(0.1));
    overlay.sync(ctx);
    expect(sourceFeatures(map, VECTOR_SOURCE_ID)).toHaveLength(0);
  });

  it('shows the unrotated question badge when the retained fix becomes stale', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    store.applyFrame({
      self: new Map([['navigation.position', { latitude: 36.8, longitude: -121.7 }]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1,
    });
    await overlay.add(ctx);
    expect(
      sourceFeatures<{ properties: { stale: boolean } }>(map, 'binnacle-own-vessel')[0],
    ).toMatchObject({ properties: { stale: false } });

    store.applyFrame({
      self: new Map(),
      selfStales: new Map([['navigation.position', {}]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 2,
    });
    overlay.sync(ctx);
    expect(
      sourceFeatures<{ properties: { stale: boolean } }>(map, 'binnacle-own-vessel')[0],
    ).toMatchObject({ properties: { stale: true } });
  });

  it('updates the source position from the store', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    store.applyFrame({
      self: new Map<string, unknown>([
        ['navigation.position', { latitude: 36.8, longitude: -121.7 }],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1,
    });
    overlay.sync(fakeOverlayContext(map));
    const source = map.sources.get('binnacle-own-vessel');
    if (!source) throw new Error('own-vessel source not added');
    const fc = source.data as { features: Array<{ geometry: { coordinates: number[] } }> };
    expect(fc.features[0].geometry.coordinates).toEqual([-121.7, 36.8]);
  });

  it('applyTheme recolors the icon image', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.applyTheme?.(fakeOverlayContext(map), mapThemePaint('night-red'));
    expect(map.updatedImages).toContain('binnacle-vessel');
    expect(map.updatedImages).toContain('binnacle-vessel-stale-badge');
  });

  it('dims review rendering without changing the accepted layer opacity', async () => {
    const store = new SignalKStore();
    let reviewing = false;
    const overlay = createVesselOverlay(new OwnVessel(store), () => reviewing);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.setOpacity?.(ctx, 0.8);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-own-vessel-symbol',
      'icon-opacity',
      0.8,
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-own-vessel-stale',
      'icon-opacity',
      0.8,
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      VECTOR_FAR_LAYER_ID,
      'line-opacity',
      0.8 * 0.8,
    );
    reviewing = true;
    overlay.sync(ctx);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-own-vessel-symbol',
      'icon-opacity',
      0.8 * 0.35,
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-own-vessel-stale',
      'icon-opacity',
      0.8 * 0.35,
    );
    reviewing = false;
    overlay.sync(ctx);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-own-vessel-symbol',
      'icon-opacity',
      0.8,
    );
    expect(map.setPaintProperty).toHaveBeenLastCalledWith(
      'binnacle-own-vessel-stale',
      'icon-opacity',
      0.8,
    );
  });

  it('themes all vector horizons without introducing blue in night-red mode', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);

    overlay.applyTheme?.(ctx, mapThemePaint('night-red'));

    const colorCalls = vi
      .mocked(map.setPaintProperty)
      .mock.calls.filter(
        ([id, property]) =>
          [VECTOR_FAR_LAYER_ID, VECTOR_MIDDLE_LAYER_ID, VECTOR_NEAR_LAYER_ID].includes(
            id as string,
          ) && property === 'line-color',
      );
    expect(colorCalls).toHaveLength(3);
    for (const [, , color] of colorCalls) expect(String(color)).toMatch(/^rgba\(\d+, \d+, 0, /);
  });

  it('remove deletes the layer and source', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.remove(fakeOverlayContext(map));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });
});
