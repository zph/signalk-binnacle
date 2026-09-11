import type { GeoJSONSourceSpecification, SymbolLayerSpecification } from 'maplibre-gl';
import type { Rgba } from './icon-raster';
import { setMapImage } from './map-image';
import type { MapThemePaint } from './map-theme';
import { removeLayersAndSources, setLayersVisibility, setSourceData } from './overlay-helpers';
import type { OverlayContext, OverlayModule, ZBand } from './types';

export interface SymbolOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

// Shared scaffolding for a rotated-icon point overlay (own vessel, AIS targets, and
// any future symbol layer). The two original overlays were byte-identical apart from
// the ids, the icon, the band, the theme paint field, and their sync change-detection,
// so those are the config; everything else lives here once.
export interface SymbolOverlayConfig {
  id: string;
  title: string;
  // Plain-language gloss for the Layers-panel row tooltip, passed straight to the OverlayModule.
  description?: string;
  band: ZBand;
  sourceId: string;
  layerId: string;
  iconId: string;
  iconImage: (color: Rgba) => ImageData;
  // Pixel ratio the icon image is rendered at (default 1). Icons drawn at 2x pass 2 here
  // so the on-screen size is half the image, kept crisp on retina displays.
  pixelRatio?: number;
  defaultColor: Rgba;
  paintColor: (paint: MapThemePaint) => Rgba;
  // Builds the current feature set.
  features: () => GeoJSON.FeatureCollection;
  // Returns true and records new state when the features changed since the last sync,
  // so a static map does not rebuild the GeoJSON every frame.
  shouldRefresh: () => boolean;
  // Optional per-sync side effect that runs before the change check (AIS pruning).
  beforeSync?: () => void;
}

export function createSymbolOverlay(config: SymbolOverlayConfig): SymbolOverlay {
  const pixelRatio = config.pixelRatio ?? 1;
  let lastFeatureKey: string | undefined;

  function refresh(ctx: OverlayContext): void {
    const data = config.features();
    const key = JSON.stringify(data);
    if (key === lastFeatureKey) return;
    setSourceData(ctx.map, config.sourceId, data);
    lastFeatureKey = key;
  }

  return {
    id: config.id,
    title: config.title,
    description: config.description,
    band: config.band,
    supportsOpacity: true,
    layerIds: [config.layerId],
    add(ctx) {
      setMapImage(ctx.map, config.iconId, config.iconImage(config.defaultColor), pixelRatio);
      if (!ctx.map.getSource(config.sourceId)) {
        const data = config.features();
        const source: GeoJSONSourceSpecification = { type: 'geojson', data };
        ctx.map.addSource(config.sourceId, source);
        lastFeatureKey = JSON.stringify(data);
      } else {
        // The caller may have reattached to a source whose current contents are not observable.
        // Force the next requested refresh to establish the cache from authoritative feature data.
        lastFeatureKey = undefined;
      }
      if (!ctx.map.getLayer(config.layerId)) {
        const layer: SymbolLayerSpecification = {
          id: config.layerId,
          type: 'symbol',
          source: config.sourceId,
          layout: {
            'icon-image': config.iconId,
            'icon-rotate': ['get', 'heading'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor(config.band));
      }
    },
    sync(ctx) {
      config.beforeSync?.();
      if (config.shouldRefresh()) refresh(ctx);
    },
    reset() {
      lastFeatureKey = undefined;
    },
    applyTheme(ctx, paint) {
      const image = config.iconImage(config.paintColor(paint));
      setMapImage(ctx.map, config.iconId, image, pixelRatio);
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, [config.layerId], visible);
    },
    setOpacity(ctx, opacity) {
      // Guard on getLayer, matching setLayersVisibility: setPaintProperty throws on an absent layer.
      if (ctx.map.getLayer(config.layerId))
        ctx.map.setPaintProperty(config.layerId, 'icon-opacity', opacity);
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, [config.layerId], [config.sourceId]);
      if (ctx.map.hasImage(config.iconId)) ctx.map.removeImage(config.iconId);
    },
  };
}
