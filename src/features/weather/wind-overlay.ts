import type { SymbolLayerSpecification } from 'maplibre-gl';
import type { WeatherStore } from '$entities/weather';
import type { SpeedUnit } from '$shared/lib';
import {
  emptyFeatureCollection,
  ensureGeoJsonSource,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import { type CanvasFactory, createFieldOverlay } from './field-overlay';
import { WEATHER_LAYER_IDS } from './fills';
import { gridTimeGate } from './grid-time-gate';
import { becameVisible } from './overlay-visibility';
import { type WindVectorView, windVectorFeatures } from './wind-arrows';
import { windSpeedFieldRgba } from './wind-speed-field';

const MARKER_SOURCE_ID = 'binnacle-weather-wind-markers';
const MARKER_LAYER_ID = 'binnacle-weather-wind-marker-label';
const FIELD_SOURCE_ID = 'binnacle-weather-wind-field';
const FIELD_LAYER_ID = 'binnacle-weather-wind-field-layer';

interface WindOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

// The wind layer draws gust speed as color beneath plain sustained | gust labels. Avoiding barbs,
// label boxes, and halos keeps the dense screen-space samples readable over the field.
export function createWindOverlay(
  store: WeatherStore,
  makeCanvas?: CanvasFactory,
  getSpeedUnit: () => SpeedUnit = () => 'kn',
): WindOverlay {
  const field = createFieldOverlay(
    store,
    {
      id: WEATHER_LAYER_IDS.wind,
      title: 'Wind',
      description: 'Sustained and gust speed labels over a gust-speed field.',
      sourceId: FIELD_SOURCE_ID,
      layerId: FIELD_LAYER_ID,
      fieldRgba: windSpeedFieldRgba,
    },
    makeCanvas,
  );
  let opacity = 1;
  let visible = false;
  let lastSpeedUnit: SpeedUnit | undefined;
  let lastViewKey: string | undefined;
  let zoomListener: (() => void) | undefined;
  const gate = gridTimeGate(store);

  function addLabelLayer(ctx: OverlayContext): void {
    ensureGeoJsonSource(ctx.map, MARKER_SOURCE_ID);
    if (!ctx.map.getLayer(MARKER_LAYER_ID)) {
      const layer: SymbolLayerSpecification = {
        id: MARKER_LAYER_ID,
        type: 'symbol',
        source: MARKER_SOURCE_ID,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          visibility: visible ? 'visible' : 'none',
        },
        paint: {
          'text-color': '#263640',
          'text-opacity': opacity,
        },
      };
      ctx.map.addLayer(layer, ctx.beforeIdFor('weather'));
    }
  }

  function viewFor(ctx: OverlayContext): WindVectorView {
    const bounds = ctx.map.getBounds();
    const canvasBounds = ctx.map.getCanvas().getBoundingClientRect();
    return {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
      width: canvasBounds.width,
      height: canvasBounds.height,
    };
  }

  function viewKey(view: WindVectorView): string {
    return `${view.west.toFixed(4)},${view.south.toFixed(4)},${view.east.toFixed(4)},${view.north.toFixed(4)},${view.width ?? 0},${view.height ?? 0}`;
  }

  function syncLabels(ctx: OverlayContext, speedUnit: SpeedUnit, view: WindVectorView): void {
    const grid = store.grid;
    const vectors = grid ? windVectorFeatures(grid, store.bracket, speedUnit, view) : undefined;
    setSourceData(ctx.map, MARKER_SOURCE_ID, vectors?.markers ?? emptyFeatureCollection());
  }

  return {
    id: WEATHER_LAYER_IDS.wind,
    title: 'Wind',
    description: 'Sustained and gust speed labels over a gust-speed field.',
    band: 'weather',
    supportsOpacity: true,
    defaultVisible: false,
    layerIds: [FIELD_LAYER_ID, MARKER_LAYER_ID],
    add(ctx) {
      void field.add(ctx);
      addLabelLayer(ctx);
      // Geometry is expressed in chart coordinates, so refresh it after every zoom rather than
      // waiting for the next weather frame or map move. This keeps the fixed visual density from
      // looking stale while a navigator zooms in or out.
      zoomListener = () => {
        if (!visible) return;
        const speedUnit = getSpeedUnit();
        const view = viewFor(ctx);
        syncLabels(ctx, speedUnit, view);
        lastSpeedUnit = speedUnit;
        lastViewKey = viewKey(view);
      };
      ctx.map.on('zoomend', zoomListener);
    },
    reset() {
      gate.reset();
      lastSpeedUnit = undefined;
      lastViewKey = undefined;
      field.reset?.();
    },
    sync(ctx) {
      if (!visible) return;
      field.sync(ctx);
      const changed = gate.changed();
      const speedUnit = getSpeedUnit();
      const view = viewFor(ctx);
      const nextViewKey = viewKey(view);
      if (!changed && speedUnit === lastSpeedUnit && nextViewKey === lastViewKey) return;
      syncLabels(ctx, speedUnit, view);
      lastSpeedUnit = speedUnit;
      lastViewKey = nextViewKey;
    },
    remove(ctx) {
      visible = false;
      if (zoomListener) ctx.map.off('zoomend', zoomListener);
      zoomListener = undefined;
      removeLayersAndSources(ctx.map, [MARKER_LAYER_ID], [MARKER_SOURCE_ID]);
      field.remove(ctx);
    },
    setVisible(ctx, value) {
      const justBecameVisible = becameVisible(visible, value);
      visible = value;
      field.setVisible(ctx, value);
      setLayersVisibility(ctx.map, [MARKER_LAYER_ID], value);
      if (justBecameVisible) {
        gate.reset();
        lastViewKey = undefined;
        this.sync(ctx);
      }
    },
    setOpacity(ctx, value) {
      opacity = value;
      field.setOpacity?.(ctx, value);
      if (ctx.map.getLayer(MARKER_LAYER_ID))
        ctx.map.setPaintProperty(MARKER_LAYER_ID, 'text-opacity', value);
    },
    applyTheme(ctx, paint) {
      field.applyTheme?.(ctx, paint);
      if (ctx.map.getLayer(MARKER_LAYER_ID)) {
        ctx.map.setPaintProperty(MARKER_LAYER_ID, 'text-color', paint.label);
      }
    },
  };
}
