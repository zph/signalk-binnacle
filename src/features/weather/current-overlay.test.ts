import { describe, expect, it } from 'vitest';
import { WeatherStore } from '$entities/weather';
import { mapThemePaint } from '$shared/map';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { createCurrentOverlay } from './current-overlay';

function fakeCanvas() {
  return { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement;
}

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

describe('current overlay', () => {
  it('adds the field, arrow, and speed-label layers in the weather band', async () => {
    const overlay = createCurrentOverlay(storeWithGrid(), fakeCanvas);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    expect(overlay.band).toBe('weather');
    expect(map.sources.size).toBe(3);
    expect(map.layers.size).toBe(3);
  });

  it('syncs current arrows and labels when visible', async () => {
    const overlay = createCurrentOverlay(storeWithGrid(), fakeCanvas);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.setVisible(fakeOverlayContext(map), true);
    const arrows = map.sources.get('binnacle-weather-current-arrows')
      ?.data as GeoJSON.FeatureCollection;
    const labels = map.sources.get('binnacle-weather-current-labels')
      ?.data as GeoJSON.FeatureCollection;
    expect(arrows.features.length).toBeGreaterThan(0);
    expect(labels.features[0].properties?.label).toBe('1.9 kn');
  });

  it('clears vector sources when a refreshed grid has no currents', async () => {
    const store = storeWithGrid();
    const overlay = createCurrentOverlay(store, fakeCanvas);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.setVisible(fakeOverlayContext(map), true);
    store.setGrid({
      lats: [0, 1],
      lons: [0, 1],
      times: [1_000],
      windU: [[0, 0, 0, 0]],
      windV: [[0, 0, 0, 0]],
    });
    overlay.sync(fakeOverlayContext(map));
    const arrows = map.sources.get('binnacle-weather-current-arrows')
      ?.data as GeoJSON.FeatureCollection;
    expect(arrows.features).toHaveLength(0);
  });

  it('removes all layers and sources and recolors safely', async () => {
    const overlay = createCurrentOverlay(storeWithGrid(), fakeCanvas);
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
