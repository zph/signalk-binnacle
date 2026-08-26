import { describe, expect, it, vi } from 'vitest';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { createChartOverlay } from './chart-overlay';
import { mapThemePaint } from './map-theme';
import { registerPmtilesArchive, unregisterPmtilesArchive } from './pmtiles';
import { registerS57Symbols } from './s57-symbols';

vi.mock('./pmtiles', () => ({
  registerPmtilesArchive: vi.fn(),
  unregisterPmtilesArchive: vi.fn(),
}));

vi.mock('./s57-symbols', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./s57-symbols')>();
  return { ...actual, registerS57Symbols: vi.fn(async () => undefined) };
});

describe('chart overlay', () => {
  const s57Chart = () => ({
    identifier: 'california-enc',
    name: 'NOAA ENC California',
    type: 'S-57' as const,
    format: 'pbf',
    tilemapUrl: '/charts/california-enc/{z}/{x}/{y}',
    layers: ['DEPARE', 'DEPCNT', 'SOUNDG', 'BOYLAT', 'WRECKS'],
  });

  it('lists a style-document chart as explicitly unsupported without touching the map', async () => {
    const overlay = createChartOverlay(
      {
        identifier: 'styled',
        name: 'Styled chart',
        type: 'mapstyleJSON',
        url: '/charts/style.json',
      },
      'http://pi.local',
    );
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);

    expect(overlay.chart).toMatchObject({
      identifier: 'styled',
      source: 'server',
      kind: 'style',
      type: 'mapstyleJSON',
      url: '/charts/style.json',
    });
    expect(overlay.defaultVisible).toBe(false);
    expect(overlay.supportsOpacity).toBe(false);
    expect(overlay.layerIds).toEqual([]);
    expect(overlay.available?.()).toBe(false);
    expect(overlay.unavailableHint).toContain('cannot display yet');

    await overlay.add(ctx);
    overlay.setVisible(ctx, true);
    overlay.remove(ctx);

    expect(map.sources.size).toBe(0);
    expect(map.layers.size).toBe(0);
    expect(map.handlerCount('sourcedata')).toBe(0);
    expect(registerPmtilesArchive).not.toHaveBeenCalled();
  });

  it('adds the chart source and layer in the basemap band', async () => {
    const overlay = createChartOverlay(
      { identifier: 'noaa', name: 'NOAA', type: 'tilelayer', tilemapUrl: '/t/{z}/{x}/{y}' },
      'http://pi.local',
    );
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    expect(overlay.band).toBe('basemap');
    expect(map.sources.size).toBe(1);
    expect(map.layers.size).toBe(1);
  });

  it('exposes chart metadata for the layer list', () => {
    const overlay = createChartOverlay(
      {
        identifier: 'noaa',
        name: 'NOAA',
        type: 'tilelayer',
        tilemapUrl: '/t/{z}/{x}/{y}',
        bounds: [-10, 40, 10, 60],
      },
      'http://pi.local',
    );
    expect(overlay.description).toBe('Chart source from the Signal K server');
    expect(overlay.chart).toMatchObject({
      identifier: 'noaa',
      source: 'server',
      kind: 'raster',
      bounds: [-10, 40, 10, 60],
    });
  });

  it('reports a query-suffixed PMTiles chart as vector', () => {
    const overlay = createChartOverlay(
      {
        identifier: 'pm',
        name: 'PMTiles',
        type: 'tilelayer',
        url: 'https://charts.example/coast.pmtiles?token=secret',
      },
      'http://pi.local',
    );
    expect(overlay.chart?.kind).toBe('vector');
  });

  it('honors a provider default while leaving normal charts visible by default', () => {
    const hidden = createChartOverlay(
      {
        identifier: 'optional',
        name: 'Optional cells',
        type: 'S-57',
        defaultVisible: false,
      },
      'http://pi.local',
    );
    const ordinary = createChartOverlay(
      { identifier: 'ordinary', name: 'Ordinary', type: 'tilelayer' },
      'http://pi.local',
    );
    expect(hidden.defaultVisible).toBe(false);
    expect(ordinary.defaultVisible).toBeUndefined();
  });

  it('remove deletes the layer and source', async () => {
    const overlay = createChartOverlay(
      { identifier: 'noaa', name: 'NOAA', type: 'tilelayer', tilemapUrl: '/t/{z}/{x}/{y}' },
      'http://pi.local',
    );
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.remove(fakeOverlayContext(map));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });

  it('setOpacity uses raster-opacity for a raster chart', async () => {
    const overlay = createChartOverlay(
      { identifier: 'noaa', name: 'NOAA', type: 'tilelayer', tilemapUrl: '/t/{z}/{x}/{y}' },
      'http://pi.local',
    );
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.setOpacity?.(fakeOverlayContext(map), 0.4);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      expect.stringContaining('chart-noaa'),
      'raster-opacity',
      0.4,
    );
  });

  it('setOpacity uses fill-opacity and line-opacity for a vector chart', async () => {
    const overlay = createChartOverlay(
      { identifier: 'vec', name: 'Vec', type: 'tileJSON', url: '/v/tilejson.json', layers: [] },
      'http://pi.local',
    );
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.setOpacity?.(fakeOverlayContext(map), 0.5);
    expect(map.setPaintProperty).toHaveBeenCalledWith('chart-vec-water', 'fill-opacity', 0.5);
    expect(map.setPaintProperty).toHaveBeenCalledWith('chart-vec-roads', 'line-opacity', 0.5);
  });

  it('registers, themes, and proportionally fades an S-57 portrayal', async () => {
    const overlay = createChartOverlay(
      {
        identifier: 'california-enc',
        name: 'NOAA ENC California',
        type: 'S-57',
        format: 'pbf',
        tilemapUrl: '/charts/california-enc/{z}/{x}/{y}',
        layers: ['DEPARE', 'ACHARE', 'RESARE', 'SOUNDG'],
      },
      'http://pi.local',
    );
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);

    await overlay.add(ctx);
    expect(registerS57Symbols).toHaveBeenCalledWith(
      map,
      mapThemePaint('day'),
      expect.any(Function),
    );
    expect(map.layers.has('chart-california-enc-depare-shallow')).toBe(true);

    overlay.setOpacity?.(ctx, 0.5);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'chart-california-enc-achare-fill',
      'fill-opacity',
      0.07,
    );
    expect(map.layers.has('chart-california-enc-resare-fill')).toBe(false);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'chart-california-enc-resare-edge-shade',
      'line-opacity',
      0.045,
    );
    expect(map.layers.has('chart-california-enc-resare-outline')).toBe(true);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'chart-california-enc-soundg-label',
      'text-opacity',
      0.5,
    );

    overlay.applyTheme?.(ctx, mapThemePaint('night-red'));
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'chart-california-enc-depare-shallow',
      'fill-color',
      '#220600',
    );
    expect(registerS57Symbols).toHaveBeenLastCalledWith(
      map,
      mapThemePaint('night-red'),
      expect.any(Function),
    );
  });

  it('derives stable child facets from the S-57 layers that are actually rendered', () => {
    const overlay = createChartOverlay(s57Chart(), 'http://pi.local');

    expect(overlay.facets?.map((facet) => facet.id)).toEqual([
      'chart-california-enc:facet:depth-areas',
      'chart-california-enc:facet:soundings-contours',
      'chart-california-enc:facet:navigation-aids',
      'chart-california-enc:facet:hazards',
    ]);
    for (const facet of overlay.facets ?? []) {
      expect(facet).toMatchObject({
        supportsOpacity: true,
        defaultVisible: true,
        defaultOpacity: 1,
      });
      expect(facet.layerIds.length).toBeGreaterThan(0);
      expect(facet.layerIds.every((id) => overlay.layerIds.includes(id))).toBe(true);
    }
    expect(overlay.facets?.flatMap((facet) => facet.layerIds)).toContain(
      'chart-california-enc-depare-shallow',
    );
    expect(overlay.facets?.flatMap((facet) => facet.layerIds)).toContain(
      'chart-california-enc-s57-symbol-boylat',
    );
  });

  it('scopes facet visibility and preserves it across parent visibility changes', async () => {
    const overlay = createChartOverlay(s57Chart(), 'http://pi.local');
    const depth = overlay.facets?.find((facet) => facet.id.endsWith(':depth-areas'));
    const navigation = overlay.facets?.find((facet) => facet.id.endsWith(':navigation-aids'));
    if (!depth || !navigation) throw new Error('expected S-57 facets');
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);

    const lastVisibility = (id: string): unknown =>
      map.setLayoutProperty.mock.calls.findLast(
        ([layerId, property]) => layerId === id && property === 'visibility',
      )?.[2];

    depth.setVisible(ctx, false);
    for (const id of depth.layerIds) expect(lastVisibility(id)).toBe('none');
    for (const id of navigation.layerIds) expect(lastVisibility(id)).toBeUndefined();

    overlay.setVisible(ctx, false);
    overlay.setVisible(ctx, true);
    for (const id of depth.layerIds) expect(lastVisibility(id)).toBe('none');
    for (const id of navigation.layerIds) expect(lastVisibility(id)).toBe('visible');

    overlay.setVisible(ctx, false);
    depth.setVisible(ctx, true);
    for (const id of depth.layerIds) expect(lastVisibility(id)).toBe('none');
    overlay.setVisible(ctx, true);
    for (const id of depth.layerIds) expect(lastVisibility(id)).toBe('visible');
  });

  it('multiplies parent and facet opacity without setter-order dependence', async () => {
    const overlay = createChartOverlay(s57Chart(), 'http://pi.local');
    const depth = overlay.facets?.find((facet) => facet.id.endsWith(':depth-areas'));
    const soundings = overlay.facets?.find((facet) => facet.id.endsWith(':soundings-contours'));
    if (!depth?.setOpacity || !soundings?.setOpacity) throw new Error('expected S-57 facets');
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);

    const lastOpacity = (id: string, property: string): unknown =>
      map.setPaintProperty.mock.calls.findLast(
        ([layerId, paintProperty]) => layerId === id && paintProperty === property,
      )?.[2];

    overlay.setOpacity?.(ctx, 0.5);
    depth.setOpacity(ctx, 0.4);
    expect(lastOpacity('chart-california-enc-depare-shallow', 'fill-opacity')).toBeCloseTo(0.2);
    expect(lastOpacity('chart-california-enc-soundg-label', 'text-opacity')).toBeCloseTo(0.5);

    depth.setOpacity(ctx, 0.25);
    overlay.setOpacity?.(ctx, 0.8);
    expect(lastOpacity('chart-california-enc-depare-shallow', 'fill-opacity')).toBeCloseTo(0.2);
    expect(lastOpacity('chart-california-enc-soundg-label', 'text-opacity')).toBeCloseTo(0.8);
  });

  it('reports a clicked S-57 depth cell and detaches its handlers on remove', async () => {
    const onFeatureSelect = vi.fn();
    const overlay = createChartOverlay(s57Chart(), 'http://pi.local', 'basemap', undefined, {
      onFeatureSelect,
    });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    const layerId = 'chart-california-enc-depare-shallow';
    expect(map.handlerCount('click', layerId)).toBe(1);

    map.emitLayer('click', layerId, {
      type: 'click',
      target: map,
      point: { x: 120, y: 90 },
      lngLat: { lng: -122.4, lat: 37.8 },
      features: [
        {
          sourceLayer: 'DEPARE',
          properties: { BATHY_DEPTH_M: 4.2, BATHY_CONFIDENCE: 0.75 },
        },
      ],
    });

    expect(onFeatureSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        chartIdentifier: 'california-enc',
        chartTitle: 'NOAA ENC California',
        sourceLayer: 'DEPARE',
        x: 120,
        y: 90,
        longitude: -122.4,
        latitude: 37.8,
        properties: { BATHY_DEPTH_M: 4.2, BATHY_CONFIDENCE: 0.75 },
      }),
    );

    overlay.remove(ctx);
    expect(map.handlerCount('click', layerId)).toBe(0);
  });

  it('registers a PMTiles archive on add and unregisters it on remove', async () => {
    const overlay = createChartOverlay(
      { identifier: 'pm', name: 'PM', type: 'tileJSON', url: 'https://x/c.pmtiles', layers: [] },
      'http://pi.local',
    );
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    expect(registerPmtilesArchive).toHaveBeenCalledWith('https://x/c.pmtiles', undefined);
    overlay.remove(fakeOverlayContext(map));
    expect(unregisterPmtilesArchive).toHaveBeenCalledWith('https://x/c.pmtiles');
  });

  it('does not touch the PMTiles registry for a plain tile-server chart', async () => {
    vi.mocked(registerPmtilesArchive).mockClear();
    vi.mocked(unregisterPmtilesArchive).mockClear();
    const overlay = createChartOverlay(
      { identifier: 'noaa', name: 'NOAA', type: 'tilelayer', tilemapUrl: '/t/{z}/{x}/{y}' },
      'http://pi.local',
    );
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.remove(fakeOverlayContext(map));
    expect(registerPmtilesArchive).not.toHaveBeenCalled();
    expect(unregisterPmtilesArchive).not.toHaveBeenCalled();
  });

  it('caps chart layers immediately when the spec declares the native max zoom', async () => {
    const overlay = createChartOverlay(
      {
        identifier: 'noaa',
        name: 'NOAA',
        type: 'tilelayer',
        tilemapUrl: '/t/{z}/{x}/{y}',
        maxzoom: 14,
      },
      'http://pi.local',
    );
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    const chartSource = [...map.sources.keys()][0];
    // MapLibre exposes its constructor default until source options are applied asynchronously.
    // The cap must still use the declared value rather than the temporary runtime value.
    expect(map.sources.get(chartSource)?.maxzoom).toBe(22);
    expect(map.setLayerZoomRange).toHaveBeenCalledWith(
      expect.stringContaining('chart-noaa'),
      0,
      15,
    );
  });

  it('keeps S-57 ENC layers visible beyond native max zoom for MapLibre overzoom', async () => {
    const overlay = createChartOverlay(
      {
        identifier: 'california-enc',
        name: 'California ENC',
        type: 'S-57',
        format: 'pbf',
        tilemapUrl: '/enc/{z}/{x}/{y}',
        maxzoom: 16,
        layers: ['DEPARE', 'DEPCNT', 'SOUNDG'],
      },
      'http://pi.local',
    );
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));

    // The vector source retains maxzoom=16, so MapLibre reuses its highest-detail tile at z17+
    // instead of requesting missing tiles. With no layer zoom cap, the ENC remains drawn up to the
    // map's own max zoom; chart-view-status separately marks that view as overzoomed.
    expect(map.setLayerZoomRange).not.toHaveBeenCalled();
  });

  it('caps a TileJSON-backed chart when its metadata arrives before the whole source loads', async () => {
    const overlay = createChartOverlay(
      { identifier: 'noaa', name: 'NOAA', type: 'tilelayer', tilemapUrl: '/t/{z}/{x}/{y}' },
      'http://pi.local',
    );
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    // The native max zoom is unknown until the TileJSON loads, so nothing is capped yet.
    expect(map.setLayerZoomRange).not.toHaveBeenCalled();
    const chartSource = [...map.sources.keys()][0];
    // Metadata arrives before the whole source loads, and now reports its native max zoom.
    const fakeSource = map.sources.get(chartSource);
    if (!fakeSource) throw new Error('chart source missing');
    fakeSource.maxzoom = 12;
    map.emit('sourcedata', { sourceId: chartSource, sourceDataType: 'metadata' });
    expect(map.setLayerZoomRange).toHaveBeenCalledWith(
      expect.stringContaining('chart-noaa'),
      0,
      13,
    );
  });

  it('keeps waiting for metadata instead of capping against the constructor default maxzoom', async () => {
    vi.useFakeTimers();
    try {
      const overlay = createChartOverlay(
        { identifier: 'noaa', name: 'NOAA', type: 'tilelayer', tilemapUrl: '/t/{z}/{x}/{y}' },
        'http://pi.local',
      );
      const map = createFakeMap();
      await overlay.add(fakeOverlayContext(map));
      const chartSource = [...map.sources.keys()][0];
      const fakeSource = map.sources.get(chartSource);
      if (!fakeSource) throw new Error('chart source missing');
      // A tile source reports the default maxzoom (22) from construction; a timed fallback
      // would cap against it and stop listening, so no amount of waiting may trigger a cap.
      expect(fakeSource.maxzoom).toBe(22);
      vi.advanceTimersByTime(60_000);
      expect(map.setLayerZoomRange).not.toHaveBeenCalled();
      // The real metadata arrives late (a slow satellite link): the cap uses the real value.
      fakeSource.maxzoom = 11;
      map.emit('sourcedata', { sourceId: chartSource, sourceDataType: 'metadata' });
      expect(map.setLayerZoomRange).toHaveBeenCalledWith(
        expect.stringContaining('chart-noaa'),
        0,
        12,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('remove detaches the metadata listener so a removed chart is never capped later', async () => {
    const overlay = createChartOverlay(
      { identifier: 'noaa', name: 'NOAA', type: 'tilelayer', tilemapUrl: '/t/{z}/{x}/{y}' },
      'http://pi.local',
    );
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    const chartSource = [...map.sources.keys()][0];
    overlay.remove(fakeOverlayContext(map));
    const fakeSource = map.sources.get(chartSource);
    if (fakeSource) fakeSource.maxzoom = 11;
    map.emit('sourcedata', { sourceId: chartSource, sourceDataType: 'metadata' });
    expect(map.setLayerZoomRange).not.toHaveBeenCalled();
  });
});
