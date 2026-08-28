import { describe, expect, it, vi } from 'vitest';
import { WeatherStore } from '$entities/weather';
import { mapThemePaint } from '$shared/map';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { createWindOverlay } from './wind-overlay';

function makeCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      clearRect: vi.fn(),
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: vi.fn(),
    }),
  } as unknown as HTMLCanvasElement;
}

function storeWithGrid(): WeatherStore {
  const store = new WeatherStore();
  store.setGrid({
    lats: [0, 1],
    lons: [0, 1],
    times: [1000, 4000],
    windU: [
      [-10, -10, -10, -10],
      [-10, -10, -10, -10],
    ],
    windV: [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  });
  return store;
}

describe('wind overlay', () => {
  it('mounts the static field and arrows hidden, then adds the animated renderer when visible', async () => {
    const overlay = createWindOverlay(storeWithGrid(), makeCanvas);
    const map = createFakeMap();
    Object.assign(map, { triggerRepaint: vi.fn() });
    await overlay.add(fakeOverlayContext(map));
    expect(overlay.band).toBe('weather');
    expect(map.sources.size).toBe(3);
    expect(map.layers.size).toBe(4);

    overlay.setVisible(fakeOverlayContext(map), true);
    expect(map.sources.size).toBe(3);
    expect(map.layers.size).toBeGreaterThanOrEqual(4);
  });

  it('syncs the arrow features from the grid', async () => {
    const overlay = createWindOverlay(storeWithGrid(), makeCanvas);
    const map = createFakeMap();
    Object.assign(map, { triggerRepaint: vi.fn() });
    await overlay.add(fakeOverlayContext(map));
    overlay.sync(fakeOverlayContext(map));
    expect(map.sources.size).toBe(3);

    overlay.setVisible(fakeOverlayContext(map), true);
    const source = map.sources.get('binnacle-weather-wind');
    if (!source) throw new Error('wind arrow source was not added');
    const fc = source.data as GeoJSON.FeatureCollection;
    expect(fc.features).toHaveLength(4);
    const markers = map.sources.get('binnacle-weather-wind-markers');
    if (!markers) throw new Error('wind marker source was not added');
    expect((markers.data as GeoJSON.FeatureCollection).features[0].properties?.label).toBe('19 kn');
    overlay.sync(fakeOverlayContext(map));
    expect(source.data).toBe(fc);
  });

  it('removes its layer and source', async () => {
    const overlay = createWindOverlay(storeWithGrid(), makeCanvas);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.remove(fakeOverlayContext(map));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });

  it('recolors for the theme without throwing', async () => {
    const overlay = createWindOverlay(storeWithGrid(), makeCanvas);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    const paint = mapThemePaint('night-red');
    expect(() => overlay.applyTheme?.(fakeOverlayContext(map), paint)).not.toThrow();
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-weather-wind-marker-label',
      'text-color',
      paint.label,
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-weather-wind-marker-label',
      'text-halo-color',
      paint.background,
    );
  });
});
