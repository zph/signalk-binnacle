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
  themeFactor: (paint: MapThemePaint) => number;
}

interface BaseMapLayerSnapshot {
  id: string;
  visibility: 'visible' | 'none' | undefined;
  opacity: OpacityProperty[];
}

const FULL_OPACITY = (_paint: MapThemePaint) => 1;

function opacityProperties(layer: BaseLayer): Array<{
  property: string;
  themeFactor: (paint: MapThemePaint) => number;
}> {
  switch (layer.type) {
    case 'background':
      return [{ property: 'background-opacity', themeFactor: FULL_OPACITY }];
    case 'fill':
      // The layer-wide form composites overlapping features once and leaves any data-driven
      // fill-opacity expression intact. MapLibre 6 supports the same primitive for lines.
      return [{ property: 'fill-layer-opacity', themeFactor: FULL_OPACITY }];
    case 'line':
      return [{ property: 'line-layer-opacity', themeFactor: FULL_OPACITY }];
    case 'fill-extrusion':
      return [{ property: 'fill-extrusion-opacity', themeFactor: FULL_OPACITY }];
    case 'circle':
      return [
        { property: 'circle-opacity', themeFactor: baseCircleThemeOpacity },
        { property: 'circle-stroke-opacity', themeFactor: baseCircleThemeOpacity },
      ];
    case 'symbol': {
      const properties = [{ property: 'text-opacity', themeFactor: FULL_OPACITY }];
      if (layer.layout?.['icon-image']) {
        properties.push({ property: 'icon-opacity', themeFactor: baseIconThemeOpacity });
      }
      return properties;
    }
    case 'raster':
      return [{ property: 'raster-opacity', themeFactor: baseRasterThemeOpacity }];
    case 'heatmap':
      return [{ property: 'heatmap-opacity', themeFactor: FULL_OPACITY }];
    default:
      return [];
  }
}

function capture(map: MapLibreMap): BaseMapLayerSnapshot[] {
  return themableBaseLayers(map).map((layer) => ({
    id: layer.id,
    visibility: map.getLayoutProperty(layer.id, 'visibility') as 'visible' | 'none' | undefined,
    opacity: opacityProperties(layer).flatMap(({ property, themeFactor }) => {
      try {
        return [{ property, base: getPaintProp(map, layer.id, property), themeFactor }];
      } catch {
        return [];
      }
    }),
  }));
}

function scaledOpacity(base: unknown, factor: number): unknown {
  if (factor === 1) return base;
  if (factor === 0 || base === undefined) return factor;
  if (typeof base === 'number') return base * factor;
  // MapLibre expressions remain on the GPU: wrapping one in multiplication preserves its
  // feature/zoom behavior while applying the user's single scalar without rebuilding tile data.
  if (Array.isArray(base)) return ['*', base, factor];
  // Legacy function objects are not valid expression operands. They are absent from the current
  // OpenFreeMap style; preserving one unchanged is safer than replacing its data-driven behavior.
  return base;
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

  const applyOpacity = (map: MapLibreMap): void => {
    for (const layer of snapshot) {
      if (!map.getLayer(layer.id)) continue;
      for (const property of layer.opacity) {
        const factor = opacity * property.themeFactor(paint);
        setPaintProp(map, layer.id, property.property, scaledOpacity(property.base, factor));
      }
    }
  };

  const restore = (map: MapLibreMap): void => {
    for (const layer of snapshot) {
      if (!map.getLayer(layer.id)) continue;
      map.setLayoutProperty(layer.id, 'visibility', layer.visibility);
      for (const property of layer.opacity) {
        setPaintProp(map, layer.id, property.property, property.base);
      }
    }
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
      applyOpacity(ctx.map);
    },
    applyTheme(ctx, nextPaint) {
      paint = nextPaint;
      // createThemedMap applies the theme's own icon/raster visibility first; this final pass
      // composes the user's opacity with the same factors from the unmodified source snapshot.
      applyOpacity(ctx.map);
    },
  };
}
