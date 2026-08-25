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

interface OpacityProperty {
  property: string;
  base: unknown;
  channel: OpacityChannel;
}

interface BaseMapLayerSnapshot {
  id: string;
  visibility: 'visible' | 'none' | undefined;
  opacity: OpacityProperty[];
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

function capture(map: MapLibreMap): BaseMapLayerSnapshot[] {
  return themableBaseLayers(map).map((layer) => ({
    id: layer.id,
    visibility: map.getLayoutProperty(layer.id, 'visibility') as 'visible' | 'none' | undefined,
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
export function createBaseMapOverlay(): OverlayModule {
  let snapshot: BaseMapLayerSnapshot[] = [];
  let visible = true;
  let opacity = 1;
  let paint = DAY_PAINT;

  const applyVisibility = (map: MapLibreMap): void => {
    for (const layer of snapshot) {
      if (!map.getLayer(layer.id)) continue;
      map.setLayoutProperty(layer.id, 'visibility', visible ? layer.visibility : 'none');
    }
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
