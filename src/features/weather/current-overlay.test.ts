import { describe, expect, it, vi } from 'vitest';
import { TidesStore } from '$entities/tides';
import { WeatherStore } from '$entities/weather';
import { mapThemePaint } from '$shared/map';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { createCurrentOverlay } from './current-overlay';

function storeWithGrid(): WeatherStore {
  const store = new WeatherStore();
  const cells = 4;
  store.setGrid({
    lats: [0, 1],
    lons: [0, 1],
    times: [1_000],
    windU: [new Array(cells).fill(0)],
    windV: [new Array(cells).fill(0)],
    oceanCurrentSpeed: [new Array(cells).fill(1)],
    oceanCurrentDirection: [new Array(cells).fill(Math.PI / 2)],
  });
  return store;
}

function tidesWithCurrent(): TidesStore {
  const tides = new TidesStore();
  tides.setReadings(undefined, {
    station: { id: 'C1', name: 'Local channel', latitude: 0.5, longitude: 0.5 },
    distanceMeters: 0,
    events: [{ timeMs: 1_000, velocityMps: 1, directionRad: Math.PI / 2, kind: 'flood' }],
  });
  return tides;
}

describe('current overlay', () => {
  it('is visible by default', () => {
    const overlay = createCurrentOverlay(storeWithGrid(), tidesWithCurrent());
    expect(overlay.defaultVisible).toBe(true);
    expect(overlay.title).toBe('Ocean currents');
  });

  it('adds arrow and NOAA speed-label layers in the weather band', async () => {
    const overlay = createCurrentOverlay(storeWithGrid(), tidesWithCurrent());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    expect(overlay.band).toBe('weather');
    expect(map.sources.size).toBe(2);
    expect(map.layers.size).toBe(2);
    expect(map.layers.get('binnacle-weather-current-arrow-layer')?.layout).toMatchObject({
      'text-size': ['case', ['has', 'station'], 36, 23],
    });
    expect(map.layers.get('binnacle-weather-current-label-layer')).toMatchObject({
      layout: {
        'text-size': 13,
        'text-offset': [0, 1.65],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: { 'text-halo-width': 2 },
    });
  });

  it('syncs modeled current arrows and the NOAA label when visible', async () => {
    const overlay = createCurrentOverlay(storeWithGrid(), tidesWithCurrent());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.setVisible(fakeOverlayContext(map), true);
    const arrows = map.sources.get('binnacle-weather-current-arrows')
      ?.data as GeoJSON.FeatureCollection;
    const labels = map.sources.get('binnacle-weather-current-labels')
      ?.data as GeoJSON.FeatureCollection;
    expect(arrows.features).toHaveLength(5);
    expect(arrows.features[0].properties?.bearing).toBeCloseTo(90);
    expect(arrows.features.at(-1)?.properties?.phase).toBe('flood');
    expect(labels.features[0].properties?.label).toBe('Flood · 1.9 kn\nLocal channel');
  });

  it('keeps modeled arrows visible without a nearby NOAA station', async () => {
    const overlay = createCurrentOverlay(storeWithGrid(), new TidesStore());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.setVisible(fakeOverlayContext(map), true);
    const arrows = map.sources.get('binnacle-weather-current-arrows')
      ?.data as GeoJSON.FeatureCollection;
    const labels = map.sources.get('binnacle-weather-current-labels')
      ?.data as GeoJSON.FeatureCollection;
    expect(arrows.features).toHaveLength(4);
    expect(labels.features).toHaveLength(0);
  });

  it('clears vector sources when neither modeled nor NOAA currents are available', async () => {
    const store = storeWithGrid();
    const tides = tidesWithCurrent();
    const overlay = createCurrentOverlay(store, tides);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.setVisible(fakeOverlayContext(map), true);
    if (store.grid) {
      store.grid.oceanCurrentSpeed = undefined;
      store.grid.oceanCurrentDirection = undefined;
    }
    tides.setNoCoverage();
    overlay.sync(fakeOverlayContext(map));
    const arrows = map.sources.get('binnacle-weather-current-arrows')
      ?.data as GeoJSON.FeatureCollection;
    expect(arrows.features).toHaveLength(0);
  });

  it('does not mutate its map sources while the grid, time, units, and tide prediction are steady', async () => {
    const overlay = createCurrentOverlay(storeWithGrid(), tidesWithCurrent());
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.setVisible(ctx, true);

    const arrows = map.sources.get('binnacle-weather-current-arrows');
    const labels = map.sources.get('binnacle-weather-current-labels');
    const originalArrowUpdate = arrows?.setData;
    const originalLabelUpdate = labels?.setData;
    const arrowUpdates = vi.fn((data: unknown) => originalArrowUpdate?.(data));
    const labelUpdates = vi.fn((data: unknown) => originalLabelUpdate?.(data));
    if (arrows) arrows.setData = arrowUpdates;
    if (labels) labels.setData = labelUpdates;

    for (let i = 0; i < 120; i += 1) overlay.sync(ctx);

    expect(arrowUpdates).not.toHaveBeenCalled();
    expect(labelUpdates).not.toHaveBeenCalled();
  });

  it('removes all layers and sources and recolors safely', async () => {
    const overlay = createCurrentOverlay(storeWithGrid(), tidesWithCurrent());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    expect(() =>
      overlay.applyTheme?.(fakeOverlayContext(map), mapThemePaint('night-red')),
    ).not.toThrow();
    overlay.remove(fakeOverlayContext(map));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });
});
