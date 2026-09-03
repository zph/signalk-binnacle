import { describe, expect, it } from 'vitest';
import { TidesStore } from '$entities/tides';
import { WeatherStore } from '$entities/weather';
import { mapThemePaint } from '$shared/map';
import { createFakeMap, fakeOverlayContext, sourceFeatures } from '$shared/testing';
import { createConditionsOverlay } from './conditions-overlay';

function storeWithGrid(): WeatherStore {
  const store = new WeatherStore();
  const filled = (value: number) => new Array(4).fill(value);
  store.setGrid(
    {
      lats: [0, 1],
      lons: [0, 1],
      times: [1_000, 2_000],
      windU: [filled(0), filled(0)],
      windV: [filled(-6), filled(-2)],
      windGust: [filled(13), filled(2)],
      waveHeight: [filled(1), filled(0.2)],
      wavePeriod: [filled(8), filled(10)],
      waveDirection: [filled(0), filled(0)],
      oceanCurrentSpeed: [filled(0.6), filled(0)],
      oceanCurrentDirection: [filled(0), filled(0)],
    },
    1_000,
  );
  return store;
}

describe('conditions overlay', () => {
  it('adds stable icon and hit layers and recalculates after pans, zooms, and time changes', async () => {
    const store = storeWithGrid();
    const overlay = createConditionsOverlay(store, new TidesStore(), {
      speedUnit: 'kn',
      mode: 'metric',
    } as never);
    const baseMap = createFakeMap();
    let bounds = { west: 0, south: 0, east: 1, north: 1 };
    const map = {
      ...baseMap,
      getCanvas: () => ({
        ...baseMap.getCanvas(),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 300 }),
      }),
      getBounds: () => ({
        getWest: () => bounds.west,
        getSouth: () => bounds.south,
        getEast: () => bounds.east,
        getNorth: () => bounds.north,
      }),
    };
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.setVisible(ctx, true);
    expect(overlay.layerIds).toEqual([
      'binnacle-weather-conditions-circles',
      'binnacle-weather-conditions-glyphs',
      'binnacle-weather-conditions-hits',
    ]);
    expect(sourceFeatures(baseMap, 'binnacle-weather-conditions')).toHaveLength(4);

    const source = baseMap.sources.get('binnacle-weather-conditions');
    const beforePan = source?.data;
    bounds = { west: 0.1, south: 0, east: 0.9, north: 1 };
    baseMap.emit('moveend', {});
    expect(source?.data).not.toBe(beforePan);

    const beforeZoom = source?.data;
    bounds = { west: 0.25, south: 0.25, east: 0.75, north: 0.75 };
    baseMap.emit('moveend', {});
    expect(source?.data).not.toBe(beforeZoom);

    store.setSelectedTime(2_000);
    overlay.sync(ctx);
    expect(sourceFeatures(baseMap, 'binnacle-weather-conditions')).toHaveLength(0);
  });

  it('recolors for night-red and removes its listeners, layers, and source', async () => {
    const overlay = createConditionsOverlay(storeWithGrid(), new TidesStore(), {
      speedUnit: 'kn',
      mode: 'metric',
    } as never);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    expect(() => overlay.applyTheme?.(ctx, mapThemePaint('night-red'))).not.toThrow();
    expect(map.handlerCount('mousemove', 'binnacle-weather-conditions-hits')).toBe(1);
    expect(map.handlerCount('moveend')).toBe(1);
    overlay.remove(ctx);
    expect(map.handlerCount('mousemove', 'binnacle-weather-conditions-hits')).toBe(0);
    expect(map.handlerCount('moveend')).toBe(0);
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });
});
