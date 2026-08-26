import { describe, expect, it } from 'vitest';
import { chartToSpecs } from './chart-adapter';
import type { SignalKChart } from './chart-types';

const base = 'http://pi.local';

describe('chartToSpecs', () => {
  it('rejects a style document instead of returning an empty successful chart', () => {
    expect(() =>
      chartToSpecs(
        {
          identifier: 'styled',
          name: 'Styled chart',
          type: 'mapstyleJSON',
          url: '/charts/style.json',
        },
        base,
      ),
    ).toThrow('Style-document charts cannot be converted to standalone map resources.');
  });

  it('builds a raster source and layer for a tilelayer', () => {
    const chart: SignalKChart = {
      identifier: 'noaa',
      name: 'NOAA',
      type: 'tilelayer',
      minzoom: 0,
      maxzoom: 16,
      tilemapUrl: '/signalk/chart-tiles/noaa/{z}/{x}/{y}',
      bounds: [-180, -85, 180, 85],
    };
    const { sources, layers } = chartToSpecs(chart, base);
    const sourceId = Object.keys(sources)[0];
    expect(sources[sourceId].type).toBe('raster');
    expect((sources[sourceId] as { tiles: string[] }).tiles[0]).toBe(
      'http://pi.local/signalk/chart-tiles/noaa/{z}/{x}/{y}',
    );
    expect(layers[0].type).toBe('raster');
  });

  it('builds a vector source for a tileJSON chart', () => {
    const chart: SignalKChart = {
      identifier: 'enc',
      name: 'ENC',
      type: 'tileJSON',
      url: 'http://pi.local/signalk/enc/tilejson.json',
    };
    const { sources } = chartToSpecs(chart, base);
    const sourceId = Object.keys(sources)[0];
    expect(sources[sourceId].type).toBe('vector');
    expect((sources[sourceId] as { url: string }).url).toBe(
      'http://pi.local/signalk/enc/tilejson.json',
    );
  });

  it('builds a vector source with a tiles array for an xyz template endpoint', () => {
    // A vector tile chart served as a {z}/{x}/{y} template, not a TileJSON document. The
    // template must go in tiles[] so MapLibre substitutes z/x/y per tile; placed in url it
    // would be fetched verbatim and 404 with percent-encoded braces.
    const chart: SignalKChart = {
      identifier: 'depth',
      name: 'Depth',
      type: 'tilelayer',
      format: 'pbf',
      tilemapUrl: '/signalk/v1/api/resources/charts/depth/{z}/{x}/{y}',
    };
    const { sources } = chartToSpecs(chart, base);
    const sourceId = Object.keys(sources)[0];
    expect(sources[sourceId].type).toBe('vector');
    expect((sources[sourceId] as { tiles?: string[] }).tiles).toEqual([
      'http://pi.local/signalk/v1/api/resources/charts/depth/{z}/{x}/{y}',
    ]);
    expect((sources[sourceId] as { url?: string }).url).toBeUndefined();
  });

  it('resolves a pmtiles url to the pmtiles protocol', () => {
    const chart: SignalKChart = {
      identifier: 'region',
      name: 'Region',
      type: 'tileJSON',
      url: '/signalk/pmtiles/region.pmtiles',
    };
    const { sources } = chartToSpecs(chart, base);
    const sourceId = Object.keys(sources)[0];
    expect((sources[sourceId] as { url: string }).url).toBe(
      'pmtiles://http://pi.local/signalk/pmtiles/region.pmtiles',
    );
  });

  it('preserves a signed query when resolving a vector PMTiles URL', () => {
    const chart: SignalKChart = {
      identifier: 'signed-vector',
      name: 'Signed vector',
      type: 'tileJSON',
      url: 'https://charts.example/coast.pmtiles?X-Amz-Signature=secret&style=day',
    };
    const { sources } = chartToSpecs(chart, base);
    const sourceId = Object.keys(sources)[0];

    expect((sources[sourceId] as { url: string }).url).toBe(
      'pmtiles://https://charts.example/coast.pmtiles?X-Amz-Signature=secret&style=day',
    );
  });

  it('builds a vector source and themed draw layers for an mvt pmtiles tilelayer', () => {
    const chart: SignalKChart = {
      identifier: 'Michigan-pmtiles',
      name: 'Michigan',
      type: 'tilelayer',
      format: 'mvt',
      layers: ['boundaries', 'buildings', 'earth', 'landcover', 'landuse', 'roads', 'water'],
      url: '/signalk/pmtiles/Michigan.pmtiles',
      minzoom: 0,
      maxzoom: 15,
    };
    const { sources, layers } = chartToSpecs(chart, base);
    const sourceId = Object.keys(sources)[0];
    expect(sourceId).toBe('chart-Michigan-pmtiles');
    expect(sources[sourceId].type).toBe('vector');
    expect((sources[sourceId] as { url: string }).url).toBe(
      'pmtiles://http://pi.local/signalk/pmtiles/Michigan.pmtiles',
    );

    // Draw layers are emitted only for known source-layers, back to front, each
    // bound to its source-layer. "buildings" is unknown, so it is skipped.
    const ids = layers.map((layer) => layer.id);
    expect(ids).toEqual([
      'chart-Michigan-pmtiles-earth',
      'chart-Michigan-pmtiles-landcover',
      'chart-Michigan-pmtiles-landuse',
      'chart-Michigan-pmtiles-water',
      'chart-Michigan-pmtiles-roads',
      'chart-Michigan-pmtiles-boundaries',
    ]);
    const byId = new Map(layers.map((layer) => [layer.id, layer]));
    expect(byId.get('chart-Michigan-pmtiles-water')?.type).toBe('fill');
    expect(byId.get('chart-Michigan-pmtiles-roads')?.type).toBe('line');
    expect(
      (byId.get('chart-Michigan-pmtiles-water') as { 'source-layer': string })['source-layer'],
    ).toBe('water');
    // landuse is held back from low zoom (heavy and invisible there); the light layers are not.
    expect((byId.get('chart-Michigan-pmtiles-landuse') as { minzoom?: number }).minzoom).toBe(12);
    expect(
      (byId.get('chart-Michigan-pmtiles-earth') as { minzoom?: number }).minzoom,
    ).toBeUndefined();
  });

  it('draws the full known vector set when a pmtiles chart declares no layers', () => {
    // The live v2 charts API returns this shape: a pmtiles tilelayer with no format
    // and an empty layers list. The adapter must still emit themed draw layers.
    const chart: SignalKChart = {
      identifier: 'Michigan-pmtiles',
      name: 'Michigan',
      type: 'tilelayer',
      url: '/signalk/pmtiles/Michigan.pmtiles',
      layers: [],
    };
    const { sources, layers } = chartToSpecs(chart, base);
    const sourceId = Object.keys(sources)[0];
    expect(sources[sourceId].type).toBe('vector');
    // Both the Protomaps and OpenMapTiles line names are emitted; MapLibre ignores
    // the draw layers whose source-layer is absent from this archive.
    expect(layers.map((layer) => layer.id)).toEqual([
      'chart-Michigan-pmtiles-earth',
      'chart-Michigan-pmtiles-landcover',
      'chart-Michigan-pmtiles-landuse',
      'chart-Michigan-pmtiles-water',
      'chart-Michigan-pmtiles-roads',
      'chart-Michigan-pmtiles-transportation',
      'chart-Michigan-pmtiles-boundaries',
      'chart-Michigan-pmtiles-boundary',
    ]);
  });

  it('builds marine portrayal layers for an S-57 chart', () => {
    const chart: SignalKChart = {
      identifier: 'california-enc',
      name: 'NOAA ENC California',
      type: 'S-57',
      format: 'pbf',
      tilemapUrl: '/signalk/v1/api/resources/charts/california-enc/{z}/{x}/{y}',
      layers: ['DEPARE', 'DEPCNT', 'SOUNDG', 'LNDARE', 'BOYLAT', 'WRECKS'],
      minzoom: 8,
      maxzoom: 16,
    };

    const { sources, layers } = chartToSpecs(chart, base);

    expect(sources['chart-california-enc']).toMatchObject({
      type: 'vector',
      tiles: ['http://pi.local/signalk/v1/api/resources/charts/california-enc/{z}/{x}/{y}'],
      minzoom: 8,
      maxzoom: 16,
    });
    expect(layers.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        'chart-california-enc-depare-shallow',
        'chart-california-enc-depcnt-safety',
        'chart-california-enc-soundg-label',
        'chart-california-enc-lndare-outline',
        'chart-california-enc-s57-symbol-boylat',
        'chart-california-enc-s57-symbol-wrecks',
      ]),
    );
    expect(layers.every((layer) => !layer.id.includes('-earth'))).toBe(true);
  });

  it('uses the bathymetry cell portrayal only for an explicit provider contract', () => {
    const chart: SignalKChart = {
      identifier: 'local-bathymetry',
      name: 'Local bathymetry cells',
      type: 'S-57',
      format: 'pbf',
      tilemapUrl: '/plugins/signalk-bathymetry/tiles/{z}/{x}/{y}.pbf?mode=datum',
      layers: ['DEPARE', 'SOUNDG'],
      featureInfo: 'bathymetry-cell',
    };

    const { layers } = chartToSpecs(chart, base, {
      s57Style: { safetyDepth: 3, depthUnit: 'ft' },
    });

    expect(layers.map(({ id }) => id)).toEqual([
      'chart-local-bathymetry-depare-bathymetry-fill',
      'chart-local-bathymetry-depare-bathymetry-outline',
      'chart-local-bathymetry-soundg-bathymetry-label',
    ]);
    expect(JSON.stringify(layers[0]?.paint)).toContain('BATHY_DEPTH_M');
    expect(JSON.stringify(layers[2]?.layout)).toContain('3.28084');
  });

  it('treats S-57 as vector without relying on a format hint', () => {
    const chart: SignalKChart = {
      identifier: 'enc-without-format',
      name: 'ENC without format',
      type: 'S-57',
      tilemapUrl: '/signalk/v1/api/resources/charts/enc-without-format/{z}/{x}/{y}',
      layers: ['DEPARE', 'SOUNDG'],
    };

    const { sources, layers } = chartToSpecs(chart, base, { s57Style: { depthUnit: 'ft' } });

    expect(sources['chart-enc-without-format'].type).toBe('vector');
    expect(layers.map(({ id }) => id)).toContain('chart-enc-without-format-depare-shallow');
    const sounding = layers.find(({ id }) => id === 'chart-enc-without-format-soundg-label');
    expect(sounding?.type).toBe('symbol');
    if (sounding?.type === 'symbol') {
      expect(JSON.stringify(sounding.layout?.['text-field'])).toContain('3.28084');
      expect(JSON.stringify(sounding.layout?.['text-field'])).not.toContain('"concat"');
      expect(sounding.layout).not.toHaveProperty('icon-image');
      expect(sounding.paint).toEqual({ 'text-color': '#000000' });
    }
  });

  it('builds a raster source for a WMS chart', () => {
    const chart: SignalKChart = {
      identifier: 'wms',
      name: 'WMS',
      type: 'WMS',
      tilemapUrl: '/signalk/wms/{bbox-epsg-3857}',
    };
    const { sources, layers } = chartToSpecs(chart, base);
    const sourceId = Object.keys(sources)[0];
    expect(sources[sourceId].type).toBe('raster');
    expect(layers[0].type).toBe('raster');
  });

  it('passes through an absolute tile url unchanged', () => {
    const chart: SignalKChart = {
      identifier: 'osm',
      name: 'OSM',
      type: 'tilelayer',
      url: 'https://tile.example/{z}/{x}/{y}.png',
    };
    const { sources } = chartToSpecs(chart, base);
    const sourceId = Object.keys(sources)[0];
    expect((sources[sourceId] as { tiles: string[] }).tiles[0]).toBe(
      'https://tile.example/{z}/{x}/{y}.png',
    );
  });

  it('builds a raster source referencing the pmtiles protocol for a raster pmtiles archive', () => {
    const chart: SignalKChart = {
      identifier: 'bathy',
      name: 'Bathy',
      type: 'tilelayer',
      format: 'png',
      url: '/signalk/pmtiles/bathy.pmtiles',
      bounds: [-10, 40, 10, 60],
    };
    const { sources, layers } = chartToSpecs(chart, base);
    const sourceId = Object.keys(sources)[0];
    expect(sources[sourceId].type).toBe('raster');
    expect((sources[sourceId] as { url: string }).url).toBe(
      'pmtiles://http://pi.local/signalk/pmtiles/bathy.pmtiles',
    );
    expect(layers[0].type).toBe('raster');
  });

  it('preserves a query when resolving a raster PMTiles URL', () => {
    const chart: SignalKChart = {
      identifier: 'signed-raster',
      name: 'Signed raster',
      type: 'tilelayer',
      format: 'png',
      url: 'https://charts.example/bathy.PMTILES?token=secret',
    };
    const { sources } = chartToSpecs(chart, base);
    const sourceId = Object.keys(sources)[0];

    expect(sources[sourceId].type).toBe('raster');
    expect((sources[sourceId] as { url: string }).url).toBe(
      'pmtiles://https://charts.example/bathy.PMTILES?token=secret',
    );
  });
});
