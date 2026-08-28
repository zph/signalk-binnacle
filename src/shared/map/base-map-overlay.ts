import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  type BaseLayer,
  baseCircleThemeOpacity,
  baseIconThemeOpacity,
  baseRasterThemeOpacity,
  themableBaseLayers,
} from './base-theme';
import { DAY_PAINT, type MapThemePaint } from './map-theme';
import { getPaintProp, setPaintProp } from './overlay-helpers';
import type { OverlayModule } from './types';

const BASE_MAP_OVERLAY_ID = 'basemap';

const BASE_MAP_FACET_DEFINITIONS = [
  {
    key: 'geography',
    title: 'Land and coastline',
    description: 'The basic land, coast, waterway, and map background shapes',
    defaultVisible: true,
  },
  {
    key: 'places',
    title: 'Place names',
    description: 'Country, city, town, village, and water names',
    defaultVisible: true,
  },
  {
    key: 'roads',
    title: 'Roads and rail',
    description: 'Road, path, bridge, tunnel, and rail line work',
    defaultVisible: false,
  },
  {
    key: 'road-labels',
    title: 'Road labels and shields',
    description: 'Road names, route shields, and direction arrows',
    defaultVisible: false,
  },
  {
    key: 'buildings',
    title: 'Buildings',
    description: 'Building footprints and three-dimensional buildings',
    defaultVisible: false,
  },
  {
    key: 'land-detail',
    title: 'Land use and vegetation',
    description: 'Parks, woods, wetlands, residential areas, and other land detail',
    defaultVisible: false,
  },
  {
    key: 'boundaries',
    title: 'Boundaries',
    description: 'Administrative and disputed boundary lines',
    defaultVisible: false,
  },
  {
    key: 'points-of-interest',
    title: 'Points of interest and airports',
    description: 'Shops, services, transit stops, facilities, and airports',
    defaultVisible: false,
  },
  {
    key: 'relief',
    title: 'Shaded relief',
    description: 'Low-zoom terrain shading behind the vector map',
    defaultVisible: false,
  },
] as const;

type BaseMapFacetKey = (typeof BASE_MAP_FACET_DEFINITIONS)[number]['key'];

function facetId(key: BaseMapFacetKey): string {
  return `${BASE_MAP_OVERLAY_ID}:facet:${key}`;
}

const FACET_IDS = Object.fromEntries(
  BASE_MAP_FACET_DEFINITIONS.map((facet) => [facet.key, facetId(facet.key)]),
) as Record<BaseMapFacetKey, string>;

const LEAN_VISIBLE = new Set<BaseMapFacetKey>(['geography', 'places']);
const STANDARD_VISIBLE = new Set<BaseMapFacetKey>([
  'geography',
  'places',
  'roads',
  'road-labels',
  'land-detail',
  'boundaries',
  'relief',
]);

function presetVisibility(visible: ReadonlySet<BaseMapFacetKey>): Record<string, boolean> {
  return Object.fromEntries(
    BASE_MAP_FACET_DEFINITIONS.map((facet) => [FACET_IDS[facet.key], visible.has(facet.key)]),
  );
}

export const BASE_MAP_FACET_PRESETS = [
  {
    id: 'lean',
    title: 'Lean',
    description: 'Keep only basic geography and place names for the fastest marine reference map.',
    visibility: presetVisibility(LEAN_VISIBLE),
  },
  {
    id: 'standard',
    title: 'Standard',
    description: 'Add roads, land detail, boundaries, and shaded relief without buildings or POIs.',
    visibility: presetVisibility(STANDARD_VISIBLE),
  },
  {
    id: 'full',
    title: 'Full',
    description: 'Show every OpenFreeMap detail layer.',
    visibility: presetVisibility(new Set(BASE_MAP_FACET_DEFINITIONS.map((facet) => facet.key))),
  },
] as const;

interface OpacityProperty {
  property: string;
  base: unknown;
  channel: OpacityChannel;
}

interface BaseMapLayerSnapshot {
  id: string;
  visibility: 'visible' | 'none' | undefined;
  opacity: OpacityProperty[];
  facet: BaseMapFacetKey;
}

type OpacityChannel = 'base' | 'icon' | 'circle' | 'raster';

interface BaseOpacityState {
  base: number;
  icon: number;
  circle: number;
  raster: number;
}

// Every base-style opacity expression refers to one global-state object. A slider tick changes that
// object once, so MapLibre batches the affected GPU paint evaluation into one style update instead
// of receiving more than one hundred independent setPaintProperty calls.
const BASE_OPACITY_STATE_KEY = 'binnacle-custom-basemap-opacity';

function opacityProperties(layer: BaseLayer): Array<{
  property: string;
  channel: OpacityChannel;
}> {
  switch (layer.type) {
    case 'background':
      return [{ property: 'background-opacity', channel: 'base' }];
    case 'fill':
      // The layer-wide form composites overlapping features once and leaves any data-driven
      // fill-opacity expression intact. MapLibre 6 supports the same primitive for lines.
      return [{ property: 'fill-layer-opacity', channel: 'base' }];
    case 'line':
      return [{ property: 'line-layer-opacity', channel: 'base' }];
    case 'fill-extrusion':
      return [{ property: 'fill-extrusion-opacity', channel: 'base' }];
    case 'circle':
      return [
        { property: 'circle-opacity', channel: 'circle' },
        { property: 'circle-stroke-opacity', channel: 'circle' },
      ];
    case 'symbol': {
      const properties: Array<{ property: string; channel: OpacityChannel }> = [
        { property: 'text-opacity', channel: 'base' },
      ];
      if (layer.layout?.['icon-image']) {
        properties.push({ property: 'icon-opacity', channel: 'icon' });
      }
      return properties;
    }
    case 'raster':
      return [{ property: 'raster-opacity', channel: 'raster' }];
    case 'heatmap':
      return [{ property: 'heatmap-opacity', channel: 'base' }];
    default:
      return [];
  }
}

function facetForLayer(layer: BaseLayer): BaseMapFacetKey {
  const sourceLayer = layer['source-layer'];
  if (layer.type === 'raster') return 'relief';
  if (sourceLayer === 'building') return 'buildings';
  if (sourceLayer === 'boundary') return 'boundaries';
  if (sourceLayer === 'landuse' || sourceLayer === 'landcover' || sourceLayer === 'park') {
    return 'land-detail';
  }
  if (
    sourceLayer === 'transportation_name' ||
    (sourceLayer === 'transportation' && layer.type === 'symbol')
  ) {
    return 'road-labels';
  }
  if (sourceLayer === 'transportation') return 'roads';
  if (sourceLayer === 'poi' || sourceLayer === 'aerodrome_label' || sourceLayer === 'aeroway') {
    return 'points-of-interest';
  }
  if (
    sourceLayer === 'place' ||
    sourceLayer === 'water_name' ||
    (sourceLayer === 'waterway' && layer.type === 'symbol')
  ) {
    return 'places';
  }
  return 'geography';
}

function capture(map: MapLibreMap): BaseMapLayerSnapshot[] {
  return themableBaseLayers(map).map((layer) => ({
    id: layer.id,
    visibility: map.getLayoutProperty(layer.id, 'visibility') as 'visible' | 'none' | undefined,
    facet: facetForLayer(layer),
    opacity: opacityProperties(layer).flatMap(({ property, channel }) => {
      try {
        return [{ property, base: getPaintProp(map, layer.id, property), channel }];
      } catch {
        return [];
      }
    }),
  }));
}

function controlledOpacity(base: unknown, channel: OpacityChannel): unknown {
  const factor = ['number', ['get', channel, ['global-state', BASE_OPACITY_STATE_KEY]]] as const;
  if (base === undefined || base === 1) return factor;
  if (typeof base === 'number' || Array.isArray(base)) return ['*', base, factor];
  // Legacy function objects are not valid expression operands. They are absent from the current
  // OpenFreeMap style; preserving one unchanged is safer than replacing its data-driven behavior.
  return base;
}

function opacityState(opacity: number, paint: MapThemePaint): BaseOpacityState {
  return {
    base: opacity,
    icon: opacity * baseIconThemeOpacity(paint),
    circle: opacity * baseCircleThemeOpacity(paint),
    raster: opacity * baseRasterThemeOpacity(paint),
  };
}

/** A listed control for the existing OpenFreeMap style. It owns no sources or draw layers. */
export function createBaseMapOverlay(map: MapLibreMap): OverlayModule {
  let snapshot = capture(map);
  let visible = true;
  let opacity = 1;
  let paint = DAY_PAINT;
  const facetVisibility = new Map<BaseMapFacetKey, boolean>(
    BASE_MAP_FACET_DEFINITIONS.map((facet) => [facet.key, facet.defaultVisible]),
  );

  const applySnapshotVisibility = (map: MapLibreMap, layer: BaseMapLayerSnapshot): void => {
    if (!map.getLayer(layer.id)) return;
    const facetVisible = facetVisibility.get(layer.facet) ?? true;
    map.setLayoutProperty(
      layer.id,
      'visibility',
      visible && facetVisible ? layer.visibility : 'none',
    );
  };

  const applyVisibility = (map: MapLibreMap): void => {
    for (const layer of snapshot) applySnapshotVisibility(map, layer);
  };

  const installOpacityControl = (map: MapLibreMap): void => {
    map.setGlobalStateProperty(BASE_OPACITY_STATE_KEY, opacityState(opacity, paint));
    for (const layer of snapshot) {
      if (!map.getLayer(layer.id)) continue;
      for (const property of layer.opacity) {
        setPaintProp(
          map,
          layer.id,
          property.property,
          controlledOpacity(property.base, property.channel),
        );
      }
    }
  };

  const applyOpacity = (map: MapLibreMap): void => {
    map.setGlobalStateProperty(BASE_OPACITY_STATE_KEY, opacityState(opacity, paint));
  };

  const restore = (map: MapLibreMap): void => {
    for (const layer of snapshot) {
      if (!map.getLayer(layer.id)) continue;
      map.setLayoutProperty(layer.id, 'visibility', layer.visibility);
      for (const property of layer.opacity) {
        setPaintProp(map, layer.id, property.property, property.base);
      }
    }
    map.setGlobalStateProperty(BASE_OPACITY_STATE_KEY, null);
  };

  return {
    id: BASE_MAP_OVERLAY_ID,
    title: 'OpenFreeMap base',
    description:
      'The underlying reference map: land, water, roads, buildings, and place names; not a nautical chart',
    category: 'charts',
    region: 'Global',
    band: 'basemap',
    supportsOpacity: true,
    defaultVisible: true,
    defaultOpacity: 1,
    // These layers belong to the loaded style, not this module. An empty list keeps manager
    // restacking from moving dozens of base layers across its z-band sentinels.
    layerIds: [],
    facets: BASE_MAP_FACET_DEFINITIONS.map((definition) => ({
      id: FACET_IDS[definition.key],
      title: definition.title,
      description: definition.description,
      supportsOpacity: false,
      defaultVisible: definition.defaultVisible,
      layerIds: [],
      setVisible(ctx, nextVisible) {
        facetVisibility.set(definition.key, nextVisible);
        for (const layer of snapshot) {
          if (layer.facet === definition.key) applySnapshotVisibility(ctx.map, layer);
        }
      },
    })),
    facetPresets: BASE_MAP_FACET_PRESETS,
    add(ctx) {
      snapshot = capture(ctx.map);
      installOpacityControl(ctx.map);
    },
    remove(ctx) {
      restore(ctx.map);
      snapshot = [];
    },
    setVisible(ctx, nextVisible) {
      visible = nextVisible;
      applyVisibility(ctx.map);
    },
    setOpacity(ctx, nextOpacity) {
      opacity = nextOpacity;
      applyOpacity(ctx.map);
    },
    reattach(ctx) {
      // A style swap creates an entirely new layer set with clean source paint. Capture that new
      // baseline, then restore the persisted control state onto it.
      snapshot = capture(ctx.map);
      applyVisibility(ctx.map);
      installOpacityControl(ctx.map);
    },
    applyTheme(ctx, nextPaint) {
      paint = nextPaint;
      // createThemedMap applies the theme's icon, circle, and raster visibility first. Those passes
      // write numeric paint values, so reinstall the expressions they replace, using the unchanged
      // source snapshot as the baseline.
      installOpacityControl(ctx.map);
    },
  };
}
