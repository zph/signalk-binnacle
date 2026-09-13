import type { Map as MapLibreMap, MapSourceDataEvent, SourceSpecification } from 'maplibre-gl';
import type { Theme } from '$shared/ui';
import {
  BATHYMETRY_THEME_PAINT_KEY,
  type BathymetryThemePaintMap,
  bathymetryLabelTextSize,
  bathymetryThemePaint,
} from './bathymetry-cell-style';
import {
  chartSourceId,
  chartToSpecs,
  hasPmtilesPath,
  PMTILES_SCHEME,
  THEME_PAINT_KEY,
} from './chart-adapter';
import type { SignalKChart } from './chart-types';
import { NAVIGATION_CHART_OVERZOOM_LEVELS } from './chart-view-status';
import { createLayerHitHandlers, type LayerHitEvent } from './layer-hit-handlers';
import { applyRasterTheme, colorProperty, DAY_PAINT, type MapColorKey } from './map-theme';
import { removeLayersAndSources, setLayersVisibility, setPaintProp } from './overlay-helpers';
import { registerPmtilesArchive, unregisterPmtilesArchive } from './pmtiles';
import { s57FacetLayerGroups } from './s57-chart-facets';
import {
  S57_THEME_PAINT_KEY,
  type S57StyleOptions,
  type S57ThemePaintMap,
  s57ThemeColor,
} from './s57-chart-style';
import { registerS57Symbols } from './s57-symbols';
import type {
  BathymetryColorScheme,
  CellPortrayalMode,
  ChartLayerInfo,
  DepthDisplayMode,
  OverlayFacet,
  OverlayModule,
  ZBand,
} from './types';

export interface ChartFeatureSelection {
  chartIdentifier: string;
  chartTitle: string;
  sourceLayer: string;
  properties: Record<string, unknown>;
  x: number;
  y: number;
  width: number;
  height: number;
  longitude: number;
  latitude: number;
  bathymetryComparison?: {
    depthM: number;
    deltaM: number;
    count: number;
    source: string;
  };
}

// How far past a raster or generic chart's native max zoom its layers keep drawing before they hand
// off to the base map. S-57 ENC is deliberately exempt: MapLibre can overzoom its last vector tile
// with crisp geometry, and hiding navigation features at close zoom is much worse than retaining
// them. Vector geometry remains crisp while MapLibre overzooms the final native tile.

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
const BATHYMETRY_LABEL_SIZE_CONTROL = {
  queryParameter: 'labelSizeScale',
  minimum: 0.5,
  maximum: 2,
  step: 0.1,
  default: 1,
} as const;

function withQueryParameter(template: string, name: string, value: number): string {
  const hashIndex = template.indexOf('#');
  const beforeHash = hashIndex >= 0 ? template.slice(0, hashIndex) : template;
  const hash = hashIndex >= 0 ? template.slice(hashIndex) : '';
  const queryIndex = beforeHash.indexOf('?');
  const path = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const params = new URLSearchParams(queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '');
  params.set(name, String(value));
  return `${path}?${params.toString()}${hash}`;
}

function withQueryStringParameter(template: string, name: string, value: string): string {
  const hashIndex = template.indexOf('#');
  const beforeHash = hashIndex >= 0 ? template.slice(0, hashIndex) : template;
  const hash = hashIndex >= 0 ? template.slice(hashIndex) : '';
  const queryIndex = beforeHash.indexOf('?');
  const path = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const params = new URLSearchParams(queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '');
  params.set(name, value);
  return `${path}?${params.toString()}${hash}`;
}

function scaledSource(
  source: SourceSpecification,
  chart: SignalKChart,
  scale: number,
  displayDepth?: DepthDisplayMode,
): SourceSpecification {
  if (!('tiles' in source) || !Array.isArray(source.tiles)) return source;
  const control = chart.cellSizeControl;
  const displayDepthControl = chart.featureInfo === 'bathymetry-cell' && displayDepth;
  if (!control && !displayDepthControl) return source;
  return {
    ...source,
    tiles: source.tiles.map((url) => {
      let next = control ? withQueryParameter(url, control.queryParameter, scale) : url;
      if (displayDepthControl) next = withQueryStringParameter(next, 'displayDepth', displayDepth);
      return next;
    }),
  };
}

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
      cellSizeControl: chart.cellSizeControl,
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
  options: {
    source?: ChartLayerInfo['source'];
    s57Style?: S57StyleOptions;
    onFeatureSelect?: (selection: ChartFeatureSelection) => void;
    interactionsAllowed?: () => boolean;
  } = {},
): OverlayModule {
  const source = options.source ?? 'server';
  if (chart.type === 'mapstyleJSON') {
    return createUnsupportedStyleChartOverlay(chart, band, source);
  }
  // Interactive local soundings are an overlay on the navigation chart, not a competing base
  // chart. Keep them in the bathymetry band so their translucent cells remain visible over ENC.
  const overlayBand =
    chart.featureInfo === 'bathymetry-cell' || chart.featureInfo === 'noaa-csb-sounding'
      ? 'bathymetry'
      : chart.featureInfo === 'boat-friend'
        ? 'traffic'
        : band;
  const specs = chartToSpecs(chart, serverBase, { s57Style: options.s57Style });
  const labelSizeControl =
    chart.featureInfo === 'bathymetry-cell' ? BATHYMETRY_LABEL_SIZE_CONTROL : undefined;
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
      bathymetryThemePaint: metadata?.[BATHYMETRY_THEME_PAINT_KEY] as
        | BathymetryThemePaintMap
        | undefined,
      opacity: opacityProperties(layer.type).map((property) => ({
        property,
        base: typeof paint?.[property] === 'number' ? paint[property] : 1,
      })),
      bathymetryLabel: chart.featureInfo === 'bathymetry-cell' && layer.type === 'symbol',
    };
  });
  const layerIds = layers.map((layer) => layer.id);
  const inspectableLayerIds = specs.layers.flatMap((layer) => {
    const sourceLayer = (layer as { 'source-layer'?: string })['source-layer'];
    return sourceLayer === 'DEPARE' || sourceLayer === 'SOUNDG' ? [layer.id] : [];
  });
  const chartId = chartSourceId(chart.identifier);
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
  let cellSizeScale = chart.cellSizeControl?.default ?? 1;
  let labelSizeScale: number = labelSizeControl?.default ?? 1;
  // Portrayal choices for interactive bathymetry cells; only meaningful when the chart carries
  // bathymetry-cell feature info. displayDepth rides the tile URL; cellPortrayal repaints.
  const depthDisplayControl = chart.featureInfo === 'bathymetry-cell';
  let displayDepth: DepthDisplayMode = 'predicted';
  // Both portrayals keep the depth-shaded fill and the cell outline; the choice is about the
  // depth labels: 'shaded' keeps the bright halo for contrast, 'text' drops it so the numbers
  // render as plain theme text (near-black in day, red in night-red) over the shading.
  let cellPortrayal: CellPortrayalMode = 'text';
  let bathymetryColorScheme: BathymetryColorScheme = 'noaa-chart';
  let theme: Theme = 'day';
  // The halo width the shaded portrayal shows; the text portrayal hides it entirely.
  const BATHYMETRY_LABEL_HALO_WIDTH = 2.25;
  let parentVisible = true;
  let parentOpacity = 1;
  const visibilityByFacet = new Map<string, boolean>();
  const opacityByFacet = new Map<string, number>();
  const facetIdByLayer = new Map<string, string>();
  const layerById = new Map(layers.map((layer) => [layer.id, layer]));
  const applyLayerVisibility = (
    ctx: Parameters<OverlayModule['setVisible']>[0],
    layerId: string,
  ) => {
    const facetId = facetIdByLayer.get(layerId);
    const facetVisible = facetId ? (visibilityByFacet.get(facetId) ?? true) : true;
    setLayersVisibility(ctx.map, [layerId], parentVisible && facetVisible);
  };
  // Apply the label halo width the current portrayal calls for. Kept separate from the opacity
  // pass because text-halo-width is a width, not an opacity, and because applyTheme's bathymetry
  // repaint must not resurrect the halo a plain-text portrayal removed.
  const applyLabelHalo = (ctx: Parameters<OverlayModule['setVisible']>[0], layerId: string) => {
    const layer = layerById.get(layerId);
    if (!layer?.bathymetryLabel || !ctx.map.getLayer(layerId)) return;
    setPaintProp(
      ctx.map,
      layerId,
      'text-halo-width',
      cellPortrayal === 'text' ? 0 : BATHYMETRY_LABEL_HALO_WIDTH,
    );
  };
  const applyBathymetryColors = (ctx: Parameters<OverlayModule['setVisible']>[0]) => {
    for (const layer of layers) {
      if (!layer.bathymetryThemePaint || !ctx.map.getLayer(layer.id)) continue;
      for (const [property, role] of Object.entries(layer.bathymetryThemePaint)) {
        setPaintProp(
          ctx.map,
          layer.id,
          property,
          bathymetryThemePaint(theme, role, options.s57Style?.safetyDepth, bathymetryColorScheme),
        );
      }
      applyLabelHalo(ctx, layer.id);
    }
  };
  const applyLayerOpacity = (ctx: Parameters<OverlayModule['setVisible']>[0], layerId: string) => {
    const layer = layerById.get(layerId);
    if (!layer || !ctx.map.getLayer(layer.id)) return;
    const facetId = facetIdByLayer.get(layer.id);
    const facetOpacity = facetId ? (opacityByFacet.get(facetId) ?? 1) : 1;
    for (const property of layer.opacity) {
      setPaintProp(
        ctx.map,
        layer.id,
        property.property,
        property.base * parentOpacity * facetOpacity,
      );
    }
  };
  const facetGroups =
    chart.featureInfo === 'noaa-csb-sounding' && chart.coverageTilemapUrl
      ? [
          {
            key: 'coverage',
            title: 'Coverage',
            description:
              'Red haze shows indexed NOAA surveys at wide zoom. Coverage is not a depth measurement.',
            layerIds: [`${chartId}-coverage-haze`],
          },
          {
            key: 'tracks',
            title: 'Tracks',
            description:
              'Indexed paths at regional zoom; fine dots mark downloaded observations at close zoom. Gaps mean missing data, not safe water.',
            layerIds: [`${chartId}-coverage-tracks`, `${chartId}-coverage-observations`],
          },
          {
            key: 'depths',
            title: 'Depths',
            description:
              'Downloads and caches visible-area depth observations from zoom 12. Unknown datum and vessel offsets; not for navigation.',
            layerIds: specs.layers
              .filter((layer) => layer.type === 'symbol')
              .map((layer) => layer.id),
          },
        ]
      : isS57
        ? s57FacetLayerGroups(specs.layers)
        : [];
  // A sole facet that owns every draw layer duplicates the parent visibility control. Persisting
  // that child as hidden can otherwise leave the parent visibly enabled while rendering nothing.
  const configurableFacetGroups =
    facetGroups.length === 1 && facetGroups[0]?.layerIds.length === layerIds.length
      ? []
      : facetGroups;
  const facets: OverlayFacet[] = configurableFacetGroups.map((group) => {
    const id = `${chartId}:facet:${group.key}`;
    visibilityByFacet.set(id, true);
    opacityByFacet.set(id, 1);
    for (const layerId of group.layerIds) facetIdByLayer.set(layerId, id);
    return {
      id,
      title: group.title,
      description: group.description,
      supportsOpacity: true,
      defaultVisible: true,
      defaultOpacity: 1,
      layerIds: group.layerIds,
      setVisible(ctx, visible) {
        visibilityByFacet.set(id, visible);
        for (const layerId of group.layerIds) applyLayerVisibility(ctx, layerId);
      },
      setOpacity(ctx, opacity) {
        opacityByFacet.set(id, opacity);
        for (const layerId of group.layerIds) applyLayerOpacity(ctx, layerId);
      },
    };
  });
  let symbolGeneration = 0;
  const hitHandlers =
    isS57 &&
    chart.featureInfo === 'bathymetry-cell' &&
    options.onFeatureSelect &&
    inspectableLayerIds.length > 0
      ? createLayerHitHandlers(
          inspectableLayerIds,
          (event: LayerHitEvent): boolean => {
            const feature = event.features?.[0];
            const sourceLayer = feature?.sourceLayer;
            if (!feature || !sourceLayer) return false;
            options.onFeatureSelect?.({
              chartIdentifier: chart.identifier,
              chartTitle: chart.name,
              sourceLayer,
              properties: { ...(feature.properties ?? {}) },
              x: event.point.x,
              y: event.point.y,
              width: event.target.getCanvas().clientWidth,
              height: event.target.getCanvas().clientHeight,
              longitude: event.lngLat.lng,
              latitude: event.lngLat.lat,
            });
            return true;
          },
          { band: overlayBand, interactionsAllowed: options.interactionsAllowed },
        )
      : undefined;

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
        map.setLayerZoomRange(
          layer.id,
          layer.minzoom,
          nativeMax + NAVIGATION_CHART_OVERZOOM_LEVELS,
        );
      }
    }
    return true;
  };

  return {
    id: chartId,
    title: chart.name,
    description,
    band: overlayBand,
    defaultVisible: chart.defaultVisible,
    supportsOpacity: true,
    cellSizeControl: chart.cellSizeControl,
    ...(depthDisplayControl ? { depthDisplayControl: true as const } : {}),
    labelSizeControl,
    layerIds,
    facets,
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
      cellSizeControl: chart.cellSizeControl,
      labelSizeControl,
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
          ctx.map.addSource(
            sourceId,
            scaledSource(specs.sources[sourceId], chart, cellSizeScale, displayDepth),
          );
        }
      }
      for (const layer of specs.layers) {
        if (!ctx.map.getLayer(layer.id)) {
          ctx.map.addLayer(layer, ctx.beforeIdFor(overlayBand));
        }
      }
      for (const layer of layers) {
        if (layer.bathymetryLabel && ctx.map.getLayer(layer.id)) {
          ctx.map.setLayoutProperty(layer.id, 'text-size', bathymetryLabelTextSize(labelSizeScale));
          applyLabelHalo(ctx, layer.id);
        }
      }
      applyBathymetryColors(ctx);
      hitHandlers?.attach(ctx);
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
      hitHandlers?.detach(ctx);
      stopCapWait(ctx.map);
      removeLayersAndSources(ctx.map, layerIds, sourceIds);
      for (const url of pmtilesUrls) {
        unregisterPmtilesArchive(url);
      }
    },
    setVisible(ctx, visible) {
      parentVisible = visible;
      for (const layerId of layerIds) applyLayerVisibility(ctx, layerId);
    },
    setOpacity(ctx, opacity) {
      parentOpacity = opacity;
      for (const layer of layers) applyLayerOpacity(ctx, layer.id);
    },
    setCellSizeScale(ctx, scale) {
      cellSizeScale = scale;
      if (!chart.cellSizeControl) return;
      for (const sourceId of sourceIds) {
        const baseSource = specs.sources[sourceId];
        const nextSource = scaledSource(baseSource, chart, scale, displayDepth);
        if (!('tiles' in nextSource) || !Array.isArray(nextSource.tiles)) continue;
        const source = ctx.map.getSource(sourceId) as
          | { setTiles?: (tiles: string[]) => void }
          | undefined;
        source?.setTiles?.([...nextSource.tiles]);
      }
    },
    setLabelSizeScale(ctx, scale) {
      labelSizeScale = scale;
      if (!labelSizeControl) return;
      for (const layer of layers) {
        if (layer.bathymetryLabel && ctx.map.getLayer(layer.id)) {
          ctx.map.setLayoutProperty(layer.id, 'text-size', bathymetryLabelTextSize(labelSizeScale));
        }
      }
    },
    setDisplayDepth(ctx, mode) {
      displayDepth = mode;
      if (!depthDisplayControl) return;
      // The estimate rides the tile URL, so the source must re-request its tiles.
      for (const sourceId of sourceIds) {
        const baseSource = specs.sources[sourceId];
        const nextSource = scaledSource(baseSource, chart, cellSizeScale, displayDepth);
        if (!('tiles' in nextSource) || !Array.isArray(nextSource.tiles)) continue;
        const source = ctx.map.getSource(sourceId) as
          | { setTiles?: (tiles: string[]) => void }
          | undefined;
        source?.setTiles?.([...nextSource.tiles]);
      }
    },
    setCellPortrayal(ctx, mode) {
      cellPortrayal = mode;
      if (!depthDisplayControl) return;
      // Shading and outline are identical in both portrayals; only the label halo flips.
      for (const layer of layers) applyLabelHalo(ctx, layer.id);
    },
    setBathymetryColorScheme(ctx, scheme) {
      bathymetryColorScheme = scheme;
      if (!depthDisplayControl) return;
      applyBathymetryColors(ctx);
    },
    applyTheme(ctx, paint) {
      theme = paint.theme;
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
        if (layer.bathymetryThemePaint) {
          for (const [property, role] of Object.entries(layer.bathymetryThemePaint)) {
            setPaintProp(
              ctx.map,
              layer.id,
              property,
              bathymetryThemePaint(
                paint.theme,
                role,
                options.s57Style?.safetyDepth,
                bathymetryColorScheme,
              ),
            );
          }
          // A theme repaint must not resurrect the halo a plain-text portrayal removed.
          applyLabelHalo(ctx, layer.id);
        }
      }
    },
  };
}
