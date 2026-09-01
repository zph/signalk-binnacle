import type { LineLayerSpecification, SymbolLayerSpecification } from 'maplibre-gl';
import type { WeatherStore } from '$entities/weather';
import { type SpeedUnit } from '$shared/lib';
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

const SOURCE_ID = 'binnacle-weather-wind';
const MARKER_SOURCE_ID = 'binnacle-weather-wind-markers';
const CASING_LAYER_ID = 'binnacle-weather-wind-line-casing';
const LAYER_ID = 'binnacle-weather-wind-line';
const MARKER_LAYER_ID = 'binnacle-weather-wind-marker-label';
const FIELD_SOURCE_ID = 'binnacle-weather-wind-field';
const FIELD_LAYER_ID = 'binnacle-weather-wind-field-layer';

interface WindOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

// The wind layer draws a speed field beneath compact conventional wind barbs. The barbs are static
// by design: they remain legible at a glance and do not turn the chart into a moving particle field.
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
      description: 'Wind speed and direction across the area.',
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
  const gate = gridTimeGate(store);

  function addBarbLayer(ctx: OverlayContext): void {
    ensureGeoJsonSource(ctx.map, SOURCE_ID);
    ensureGeoJsonSource(ctx.map, MARKER_SOURCE_ID);
    if (!ctx.map.getLayer(CASING_LAYER_ID)) {
      const layer: LineLayerSpecification = {
        id: CASING_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          visibility: visible ? 'visible' : 'none',
        },
        paint: { 'line-color': '#263640', 'line-width': 3.5, 'line-opacity': opacity * 0.9 },
      };
      ctx.map.addLayer(layer, ctx.beforeIdFor('weather'));
    }
    if (!ctx.map.getLayer(LAYER_ID)) {
      const layer: LineLayerSpecification = {
        id: LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          visibility: visible ? 'visible' : 'none',
        },
        paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-opacity': opacity },
      };
      ctx.map.addLayer(layer, ctx.beforeIdFor('weather'));
    }
    if (!ctx.map.getLayer(MARKER_LAYER_ID)) {
      const layer: SymbolLayerSpecification = {
        id: MARKER_LAYER_ID,
        type: 'symbol',
        source: MARKER_SOURCE_ID,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 1.1],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          visibility: visible ? 'visible' : 'none',
        },
        paint: {
          'text-color': '#263640',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
          'text-opacity': opacity,
        },
      };
      ctx.map.addLayer(layer, ctx.beforeIdFor('weather'));
    }
  }

  function viewFor(ctx: OverlayContext): WindVectorView {
    const bounds = ctx.map.getBounds();
    return {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    };
  }

  function syncBarbs(ctx: OverlayContext, speedUnit: SpeedUnit, view: WindVectorView): void {
    const grid = store.grid;
    const vectors = grid ? windVectorFeatures(grid, store.bracket, speedUnit, view) : undefined;
    setSourceData(ctx.map, SOURCE_ID, vectors?.arrows ?? emptyFeatureCollection());
    setSourceData(ctx.map, MARKER_SOURCE_ID, vectors?.markers ?? emptyFeatureCollection());
  }

  return {
    id: WEATHER_LAYER_IDS.wind,
    title: 'Wind',
    description: 'Wind speed and direction across the area.',
    band: 'weather',
    supportsOpacity: true,
    defaultVisible: false,
    layerIds: [FIELD_LAYER_ID, CASING_LAYER_ID, LAYER_ID, MARKER_LAYER_ID],
    add(ctx) {
      void field.add(ctx);
      addBarbLayer(ctx);
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
      const viewKey = `${view.west.toFixed(4)},${view.south.toFixed(4)},${view.east.toFixed(4)},${view.north.toFixed(4)}`;
      if (!changed && speedUnit === lastSpeedUnit && viewKey === lastViewKey) return;
      syncBarbs(ctx, speedUnit, view);
      lastSpeedUnit = speedUnit;
      lastViewKey = viewKey;
    },
    remove(ctx) {
      visible = false;
      removeLayersAndSources(
        ctx.map,
        [MARKER_LAYER_ID, LAYER_ID, CASING_LAYER_ID],
        [MARKER_SOURCE_ID, SOURCE_ID],
      );
      field.remove(ctx);
    },
    setVisible(ctx, value) {
      const justBecameVisible = becameVisible(visible, value);
      visible = value;
      field.setVisible(ctx, value);
      setLayersVisibility(ctx.map, [CASING_LAYER_ID, LAYER_ID, MARKER_LAYER_ID], value);
      if (justBecameVisible) {
        gate.reset();
        lastViewKey = undefined;
        this.sync(ctx);
      }
    },
    setOpacity(ctx, value) {
      opacity = value;
      field.setOpacity?.(ctx, value);
      if (ctx.map.getLayer(CASING_LAYER_ID))
        ctx.map.setPaintProperty(CASING_LAYER_ID, 'line-opacity', value * 0.9);
      if (ctx.map.getLayer(LAYER_ID)) ctx.map.setPaintProperty(LAYER_ID, 'line-opacity', value);
      if (ctx.map.getLayer(MARKER_LAYER_ID))
        ctx.map.setPaintProperty(MARKER_LAYER_ID, 'text-opacity', value);
    },
    applyTheme(ctx, paint) {
      field.applyTheme?.(ctx, paint);
      if (ctx.map.getLayer(CASING_LAYER_ID))
        ctx.map.setPaintProperty(CASING_LAYER_ID, 'line-color', paint.label);
      if (ctx.map.getLayer(LAYER_ID))
        ctx.map.setPaintProperty(LAYER_ID, 'line-color', paint.markerGlyph);
      if (ctx.map.getLayer(MARKER_LAYER_ID)) {
        ctx.map.setPaintProperty(MARKER_LAYER_ID, 'text-color', paint.label);
        ctx.map.setPaintProperty(MARKER_LAYER_ID, 'text-halo-color', paint.background);
      }
    },
  };
}
