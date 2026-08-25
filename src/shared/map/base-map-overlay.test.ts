import { describe, expect, it } from 'vitest';
import { createBaseMapOverlay } from './base-map-overlay';
import { applyBaseIconVisibility, applyBaseRasterVisibility } from './base-theme';
import { mapThemePaint } from './map-theme';

function fakeMap() {
  const layers = [
    { id: 'background', type: 'background' },
    { id: 'land', type: 'fill', 'source-layer': 'landuse' },
    { id: 'road', type: 'line', 'source-layer': 'transportation' },
    {
      id: 'places',
      type: 'symbol',
      'source-layer': 'place',
      layout: { 'icon-image': ['get', 'icon'] },
    },
    { id: 'poi', type: 'circle', 'source-layer': 'poi' },
    { id: 'relief', type: 'raster' },
    { id: 'source-hidden', type: 'line', layout: { visibility: 'none' } },
    { id: 'chart-enc-depare', type: 'fill', 'source-layer': 'DEPARE' },
  ];
  const paint = new Map<string, unknown>();
  const layout = new Map<string, unknown>();
  const globalState = new Map<string, unknown>();
  const paintCalls: Array<[string, string, unknown]> = [];
  for (const layer of layers) {
    if (layer.layout && 'visibility' in layer.layout) {
      layout.set(`${layer.id}|visibility`, layer.layout.visibility);
    }
  }
  paint.set('road|line-layer-opacity', 0.8);
  paint.set('places|text-opacity', ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1]);

  return {
    layers,
    paint,
    layout,
    getStyle: () => ({ layers }),
    getLayer: (id: string) => layers.find((layer) => layer.id === id),
    getPaintProperty: (id: string, property: string) => paint.get(`${id}|${property}`),
    setPaintProperty: (id: string, property: string, value: unknown) => {
      paintCalls.push([id, property, value]);
      paint.set(`${id}|${property}`, value);
    },
    getLayoutProperty: (id: string, property: string) => layout.get(`${id}|${property}`),
    setLayoutProperty: (id: string, property: string, value: unknown) =>
      layout.set(`${id}|${property}`, value),
    setGlobalStateProperty: (property: string, value: unknown) => globalState.set(property, value),
    globalState,
    paintCalls,
  };
}

function context(map: ReturnType<typeof fakeMap>) {
  // biome-ignore lint/suspicious/noExplicitAny: focused MapLibre-shaped test double
  return { map: map as any, beforeIdFor: () => undefined };
}

describe('createBaseMapOverlay', () => {
  it('is a listed global chart control without owned draw layers', () => {
    const overlay = createBaseMapOverlay();
    expect(overlay).toMatchObject({
      id: 'basemap',
      title: 'OpenFreeMap base',
      category: 'charts',
      region: 'Global',
      band: 'basemap',
      supportsOpacity: true,
      layerIds: [],
    });
    expect(overlay.chartCoverage).toBeUndefined();
  });

  it('installs stable MapLibre expressions and changes only global state on slider input', async () => {
    const map = fakeMap();
    const overlay = createBaseMapOverlay();
    await overlay.add(context(map));
    const paintCallCount = map.paintCalls.length;
    overlay.setOpacity?.(context(map), 0.5);

    const baseFactor = [
      'number',
      ['get', 'base', ['global-state', 'binnacle-custom-basemap-opacity']],
    ];
    expect(map.paint.get('background|background-opacity')).toEqual(baseFactor);
    expect(map.paint.get('land|fill-layer-opacity')).toEqual(baseFactor);
    expect(map.paint.get('road|line-layer-opacity')).toEqual(['*', 0.8, baseFactor]);
    expect(map.paint.get('places|text-opacity')).toEqual([
      '*',
      ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1],
      baseFactor,
    ]);
    expect(map.paint.has('chart-enc-depare|fill-layer-opacity')).toBe(false);
    expect(map.globalState.get('binnacle-custom-basemap-opacity')).toEqual({
      base: 0.5,
      icon: 0.5,
      circle: 0.5,
      raster: 0.5,
    });
    expect(map.paintCalls).toHaveLength(paintCallCount);

    overlay.setOpacity?.(context(map), 0.25);
    expect(map.globalState.get('binnacle-custom-basemap-opacity')).toEqual({
      base: 0.25,
      icon: 0.25,
      circle: 0.25,
      raster: 0.25,
    });
    expect(map.paintCalls).toHaveLength(paintCallCount);
  });

  it('reinstalls expressions overwritten by the theme visibility passes', async () => {
    const map = fakeMap();
    const overlay = createBaseMapOverlay();
    await overlay.add(context(map));
    overlay.setOpacity?.(context(map), 0.5);
    const dusk = mapThemePaint('dusk');
    applyBaseIconVisibility(context(map).map, dusk);
    applyBaseRasterVisibility(context(map).map, dusk);
    overlay.applyTheme?.(context(map), dusk);

    expect(map.paint.get('places|icon-opacity')).toEqual([
      'number',
      ['get', 'icon', ['global-state', 'binnacle-custom-basemap-opacity']],
    ]);
    expect(map.paint.get('poi|circle-opacity')).toEqual([
      'number',
      ['get', 'circle', ['global-state', 'binnacle-custom-basemap-opacity']],
    ]);
    expect(map.paint.get('relief|raster-opacity')).toEqual([
      'number',
      ['get', 'raster', ['global-state', 'binnacle-custom-basemap-opacity']],
    ]);
    expect(map.globalState.get('binnacle-custom-basemap-opacity')).toEqual({
      base: 0.5,
      icon: 0.2,
      circle: 0.5,
      raster: 0.5,
    });

    const night = mapThemePaint('night-red');
    applyBaseIconVisibility(context(map).map, night);
    applyBaseRasterVisibility(context(map).map, night);
    overlay.applyTheme?.(context(map), night);
    expect(map.paint.get('places|icon-opacity')).toEqual([
      'number',
      ['get', 'icon', ['global-state', 'binnacle-custom-basemap-opacity']],
    ]);
    expect(map.globalState.get('binnacle-custom-basemap-opacity')).toEqual({
      base: 0.5,
      icon: 0,
      circle: 0,
      raster: 0,
    });
  });

  it('restores each source visibility when toggled back on', async () => {
    const map = fakeMap();
    const overlay = createBaseMapOverlay();
    await overlay.add(context(map));
    overlay.setVisible(context(map), false);
    expect(map.layout.get('land|visibility')).toBe('none');
    expect(map.layout.get('source-hidden|visibility')).toBe('none');

    overlay.setVisible(context(map), true);
    expect(map.layout.get('land|visibility')).toBeUndefined();
    expect(map.layout.get('source-hidden|visibility')).toBe('none');
  });

  it('restores source paint and clears its global state on removal', async () => {
    const map = fakeMap();
    const overlay = createBaseMapOverlay();
    await overlay.add(context(map));

    overlay.remove(context(map));

    expect(map.paint.get('road|line-layer-opacity')).toBe(0.8);
    expect(map.paint.get('places|text-opacity')).toEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      5,
      0.5,
      10,
      1,
    ]);
    expect(map.globalState.get('binnacle-custom-basemap-opacity')).toBeNull();
  });
});
