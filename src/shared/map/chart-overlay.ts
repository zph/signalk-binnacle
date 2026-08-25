import type { Map as MapLibreMap, MapSourceDataEvent } from 'maplibre-gl';
import {
  chartSourceId,
  chartToSpecs,
  hasPmtilesPath,
  PMTILES_SCHEME,
  THEME_PAINT_KEY,
} from './chart-adapter';
import type { SignalKChart } from './chart-types';
import { applyRasterTheme, colorProperty, DAY_PAINT, type MapColorKey } from './map-theme';
import { removeLayersAndSources, setLayersVisibility, setPaintProp } from './overlay-helpers';
import { registerPmtilesArchive, unregisterPmtilesArchive } from './pmtiles';
import {
  S57_THEME_PAINT_KEY,
  type S57StyleOptions,
  type S57ThemePaintMap,
  s57ThemeColor,
} from './s57-chart-style';
import { registerS57Symbols } from './s57-symbols';
import type { ChartLayerInfo, OverlayModule, ZBand } from './types';

// How far past a raster or generic chart's native max zoom its layers keep drawing before they hand
// off to the base map. S-57 ENC is deliberately exempt: MapLibre can overzoom its last vector tile
// with crisp geometry, and hiding navigation features at close zoom is much worse than retaining
// them with an explicit "Chart overzoomed" warning from chart-view-status.
const CHART_OVERZOOM_BUDGET = 1;

const OPACITY_PROPERTIES = {
  circle: ['circle-opacity', 'circle-stroke-opacity'],
  fill: ['fill-opacity'],
  line: ['line-opacity'],
  raster: ['raster-opacity'],
  symbol: ['icon-opacity', 'text-opacity'],
} as const;
const RASTER_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif']);
const STYLE_CHART_UNAVAILABLE_HINT =
  'This chart is delivered as a map style document, a format Binnacle cannot display yet. It stays listed so you can see the server offers it.';

// The opacity paint property for a layer type, or undefined for a type the chart adapter never
// emits (only fill, line, and raster are produced). setOpacity skips an undefined so an unexpected
// type is a clear no-op rather than a wrong property silently applied.
function opacityProperties(layerType: string): readonly string[] {
  return OPACITY_PROPERTIES[layerType as keyof typeof OPACITY_PROPERTIES] ?? [];
}

function chartKind(chart: SignalKChart): ChartLayerInfo['kind'] {
  if (chart.type === 'mapstyleJSON') return 'style';
  if (chart.type === 'tileJSON' || chart.format === 'mvt' || chart.format === 'pbf')
    return 'vector';
  if (chart.format && RASTER_FORMATS.has(chart.format)) return 'raster';
  const candidate = chart.url ?? chart.tilemapUrl ?? '';
  return hasPmtilesPath(candidate) ? 'vector' : 'raster';
}

function createUnsupportedStyleChartOverlay(
  chart: SignalKChart,
  band: ZBand,
  source: ChartLayerInfo['source'],
): OverlayModule {
  const url = chart.url ?? chart.tilemapUrl;
  return {
    id: chartSourceId(chart.identifier),
    title: chart.name,
    description:
      chart.description ??
      'A style-document chart source reported by the Signal K server, which Binnacle cannot display yet',
    band,
    defaultVisible: false,
    supportsOpacity: false,
    layerIds: [],
    available: () => false,
    unavailableHint: STYLE_CHART_UNAVAILABLE_HINT,
    chart: {
      identifier: chart.identifier,
      source,
      kind: 'style',
      type: chart.type,
      url,
      bounds: chart.bounds,
      minzoom: chart.minzoom,
      maxzoom: chart.maxzoom,
      format: chart.format,
    },
    add() {},
    remove() {},
    setVisible() {},
  };
}

// Server charts default to the basemap band; a user-imported chart passes 'bathymetry' so it
// layers above the base map. Pass getToken when the archive may be companion-provided so each
// PMTiles fetch carries the current auth token on a security-enabled server.
export function createChartOverlay(
  chart: SignalKChart,
  serverBase: string,
  band: ZBand = 'basemap',
  getToken?: () => string | undefined,
  options: { source?: ChartLayerInfo['source']; s57Style?: S57StyleOptions } = {},
): OverlayModule {
  const source = options.source ?? 'server';
  if (chart.type === 'mapstyleJSON') {
    return createUnsupportedStyleChartOverlay(chart, band, source);
  }
  const specs = chartToSpecs(chart, serverBase, { s57Style: options.s57Style });
  const sourceIds = Object.keys(specs.sources);
  // A lightweight view of just the fields the lifecycle methods touch, derived once from
  // specs.layers. add() works from the full specs, while remove, setVisible, setOpacity, applyTheme,
  // and capToNativeZoom iterate this. It is derived, so it cannot drift from specs.layers.
  const layers = specs.layers.map((layer) => {
    const metadata = layer.metadata as Record<string, unknown> | undefined;
    const paint = layer.paint as Record<string, unknown> | undefined;
    return {
      id: layer.id,
      type: layer.type,
      minzoom: (layer as { minzoom?: number }).minzoom ?? 0,
      themePaint: metadata?.[THEME_PAINT_KEY] as MapColorKey | undefined,
      s57ThemePaint: metadata?.[S57_THEME_PAINT_KEY] as S57ThemePaintMap | undefined,
      opacity: opacityProperties(layer.type).map((property) => ({
        property,
        base: typeof paint?.[property] === 'number' ? paint[property] : 1,
      })),
    };
  });
  const layerIds = layers.map((layer) => layer.id);
  const chartSource = sourceIds[0];
  // The bare http urls of this chart's PMTiles archives, registered with the protocol on add and
  // unregistered on remove so a deleted chart does not leak its archive instance (for a blob: url,
  // a permanently dead one).
  const pmtilesUrls = sourceIds.flatMap((sourceId) => {
    const spec = specs.sources[sourceId];
    return 'url' in spec && typeof spec.url === 'string' && spec.url.startsWith(PMTILES_SCHEME)
      ? [spec.url.slice(PMTILES_SCHEME.length)]
      : [];
  });
  let onSourceData: ((event: MapSourceDataEvent) => void) | undefined;
  // The one teardown for the metadata wait, shared by the add preamble (reattach path), the
  // sourcedata handler, and remove.
  const stopCapWait = (map: MapLibreMap): void => {
    if (onSourceData) {
      map.off('sourcedata', onSourceData);
      onSourceData = undefined;
    }
  };
  const url = chart.url ?? chart.tilemapUrl;
  const kind = chartKind(chart);
  const description =
    chart.description ??
    (source === 'user' ? 'User-added chart source' : 'Chart source from the Signal K server');
  const isS57 = chart.type === 'S-57';
  let symbolGeneration = 0;

  // The native max zoom lives in the source's TileJSON, which a PMTiles archive reports
  // only once it has loaded, so this is applied after the source is loaded. Each layer's
  // own minzoom is preserved (e.g. landuse is held back from low zoom for performance).
  const capToNativeZoom = (map: MapLibreMap, declaredMax?: number): boolean => {
    const source = map.getSource(chartSource) as { maxzoom?: number } | undefined;
    // MapLibre constructs tile sources with its default maxzoom before applying source options
    // asynchronously. Use a declared value directly so an explicit maxzoom cannot be mistaken for
    // the temporary default. URL-backed sources without one still wait for loaded metadata below.
    const nativeMax = declaredMax ?? source?.maxzoom;
    if (nativeMax === undefined) return false;
    for (const layer of layers) {
      if (map.getLayer(layer.id)) {
        map.setLayerZoomRange(layer.id, layer.minzoom, nativeMax + CHART_OVERZOOM_BUDGET);
      }
    }
    return true;
  };

  return {
    id: chartSourceId(chart.identifier),
    title: chart.name,
    description,
    band,
    supportsOpacity: true,
    layerIds,
    chart: {
      identifier: chart.identifier,
      source,
      kind,
      type: chart.type,
      url,
      bounds: chart.bounds,
      minzoom: chart.minzoom,
      maxzoom: chart.maxzoom,
      format: chart.format,
    },
    async add(ctx) {
      if (isS57) {
        const generation = ++symbolGeneration;
        await registerS57Symbols(ctx.map, DAY_PAINT, () => generation === symbolGeneration);
      }
      // A PMTiles archive registers a no-store source first so MapLibre resolves the
      // pmtiles:// url to it rather than the default cache-writing fetch source.
      for (const url of pmtilesUrls) {
        registerPmtilesArchive(url, getToken);
      }
      for (const sourceId of sourceIds) {
        if (!ctx.map.getSource(sourceId)) {
          ctx.map.addSource(sourceId, specs.sources[sourceId]);
        }
      }
      for (const layer of specs.layers) {
        if (!ctx.map.getLayer(layer.id)) {
          ctx.map.addLayer(layer, ctx.beforeIdFor(band));
        }
      }
      // A malformed or future source-free chart has nothing to cap, so skip the listener instead
      // of waiting forever on an undefined source id.
      if (!chartSource) return;
      // Keep ENC vectors visible through MapLibre's full map zoom range. The source maxzoom still
      // tells MapLibre to reuse (overzoom) the z16 California tile rather than requesting nonexistent
      // z17+ tiles, while the chart status badge continues to warn beyond the declared native scale.
      if (isS57) return;
      // Clear anything left by a prior add (the reattach path) so the handler reference cannot
      // be orphaned.
      stopCapWait(ctx.map);
      // A spec-declared maxzoom is final at construction, so cap immediately. A TileJSON-backed
      // source (a PMTiles archive, or any url-form source) reports its native maxzoom only once
      // its metadata loads; reading earlier would see MapLibre's default instead.
      const specSource = specs.sources[chartSource] as { maxzoom?: number } | undefined;
      if (specSource?.maxzoom !== undefined) {
        capToNativeZoom(ctx.map, specSource.maxzoom);
        return;
      }
      // A URL-backed source's native maxzoom becomes authoritative when its metadata arrives, so
      // use the matching 'metadata' sourcedata event while still accepting a loaded event. The
      // wait is purely event-driven, with no timed fallback: a tile source reports MapLibre's
      // default maxzoom of 22 from construction, so capping on a timer before the metadata arrives
      // would cap against the default and, worse, stop listening for the real value. The listener
      // costs one string compare per sourcedata event and is detached on success or remove.
      const handler = (event: MapSourceDataEvent) => {
        if (event.sourceId !== chartSource) return;
        if (event.sourceDataType !== 'metadata' && !event.isSourceLoaded) return;
        if (capToNativeZoom(ctx.map)) stopCapWait(ctx.map);
      };
      onSourceData = handler;
      ctx.map.on('sourcedata', handler);
    },
    remove(ctx) {
      symbolGeneration += 1;
      stopCapWait(ctx.map);
      removeLayersAndSources(ctx.map, layerIds, sourceIds);
      for (const url of pmtilesUrls) {
        unregisterPmtilesArchive(url);
      }
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, layerIds, visible);
    },
    setOpacity(ctx, opacity) {
      for (const layer of layers) {
        // Guard on getLayer, matching setLayersVisibility: setPaintProperty throws on a layer that is
        // not present, for example if the slider moves during the window after a base-style reload and
        // before the overlay reattaches.
        if (!ctx.map.getLayer(layer.id)) continue;
        for (const property of layer.opacity) {
          setPaintProp(ctx.map, layer.id, property.property, property.base * opacity);
        }
      }
    },
    applyTheme(ctx, paint) {
      if (isS57) {
        const generation = ++symbolGeneration;
        registerS57Symbols(ctx.map, paint, () => generation === symbolGeneration).catch((error) =>
          console.warn('[charts] could not update S-57 symbols', error),
        );
      }
      // Recolor this chart's own themed vector draw layers; a raster layer cannot be recolored,
      // so adjust it the way the streaming bathymetry does: night-red desaturates and dims it so
      // it carries no blue and keeps the brightest pixel low.
      for (const layer of layers) {
        if (layer.type === 'raster') {
          applyRasterTheme(ctx.map, layer.id, paint);
          continue;
        }
        // Guard on getLayer, matching setLayersVisibility and setOpacity: setPaintProperty throws on a
        // layer absent during the window after a base-style reload and before reattach.
        if (!ctx.map.getLayer(layer.id)) continue;
        if (layer.themePaint) {
          const property = colorProperty(layer.type);
          ctx.map.setPaintProperty(layer.id, property, paint[layer.themePaint]);
        }
        if (layer.s57ThemePaint) {
          for (const [property, color] of Object.entries(layer.s57ThemePaint)) {
            setPaintProp(ctx.map, layer.id, property, s57ThemeColor(paint.theme, color));
          }
        }
      }
    },
  };
}
