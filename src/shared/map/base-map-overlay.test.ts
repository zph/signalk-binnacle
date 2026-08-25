import { describe, expect, it } from 'vitest';
import { createBaseMapOverlay } from './base-map-overlay';
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
    setPaintProperty: (id: string, property: string, value: unknown) =>
      paint.set(`${id}|${property}`, value),
    getLayoutProperty: (id: string, property: string) => layout.get(`${id}|${property}`),
    setLayoutProperty: (id: string, property: string, value: unknown) =>
      layout.set(`${id}|${property}`, value),
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

  it('scales the native base paint without touching chart-owned layers or compounding', async () => {
    const map = fakeMap();
    const overlay = createBaseMapOverlay();
    await overlay.add(context(map));
    overlay.setOpacity?.(context(map), 0.5);

    expect(map.paint.get('background|background-opacity')).toBe(0.5);
    expect(map.paint.get('land|fill-layer-opacity')).toBe(0.5);
    expect(map.paint.get('road|line-layer-opacity')).toBe(0.4);
    expect(map.paint.get('places|text-opacity')).toEqual([
      '*',
      ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1],
      0.5,
    ]);
    expect(map.paint.has('chart-enc-depare|fill-layer-opacity')).toBe(false);

    overlay.setOpacity?.(context(map), 0.25);
    expect(map.paint.get('road|line-layer-opacity')).toBe(0.2);
  });

  it('composes user opacity with dusk and night base-art rules', async () => {
    const map = fakeMap();
    const overlay = createBaseMapOverlay();
    await overlay.add(context(map));
    overlay.setOpacity?.(context(map), 0.5);
    overlay.applyTheme?.(context(map), mapThemePaint('dusk'));

    expect(map.paint.get('places|icon-opacity')).toBe(0.2);
    expect(map.paint.get('places|text-opacity')).toEqual([
      '*',
      ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1],
      0.5,
    ]);
    expect(map.paint.get('relief|raster-opacity')).toBe(0.5);

    overlay.applyTheme?.(context(map), mapThemePaint('night-red'));
    expect(map.paint.get('places|icon-opacity')).toBe(0);
    expect(map.paint.get('poi|circle-opacity')).toBe(0);
    expect(map.paint.get('poi|circle-stroke-opacity')).toBe(0);
    expect(map.paint.get('relief|raster-opacity')).toBe(0);
    expect(map.paint.get('land|fill-layer-opacity')).toBe(0.5);
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
});
