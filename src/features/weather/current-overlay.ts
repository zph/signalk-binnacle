import type { LineLayerSpecification, SymbolLayerSpecification } from 'maplibre-gl';
import type { WeatherStore } from '$entities/weather';
import type { SpeedUnit } from '$shared/lib';
import {
  emptyFeatureCollection,
  ensureGeoJsonSource,
  removeLayersAndSources,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import type { Theme } from '$shared/ui';
import { currentVectorFeatures } from './current-arrows';
import { currentArrowColor } from './current-colormap';
import { currentFieldRgba } from './current-field';
import { type CanvasFactory, createFieldOverlay, type FieldOverlay } from './field-overlay';
import { WEATHER_LAYER_IDS } from './fills';
import { gridTimeGate } from './grid-time-gate';
import { becameVisible } from './overlay-visibility';

const FIELD_SOURCE = 'binnacle-weather-current-field';
const FIELD_LAYER = 'binnacle-weather-current-field-layer';
const ARROW_SOURCE = 'binnacle-weather-current-arrows';
const ARROW_LAYER = 'binnacle-weather-current-arrow-layer';
const LABEL_SOURCE = 'binnacle-weather-current-labels';
const LABEL_LAYER = 'binnacle-weather-current-label-layer';

type CurrentOverlay = FieldOverlay;

export function createCurrentOverlay(
  store: WeatherStore,
  makeCanvas?: CanvasFactory,
  getSpeedUnit: () => SpeedUnit = () => 'kn',
): CurrentOverlay {
  const field = createFieldOverlay(
    store,
    {
      id: WEATHER_LAYER_IDS.current,
      title: 'Ocean currents',
      description:
        'Modeled surface-current speed and direction. Coastal accuracy is limited, so do not use it as a substitute for local tide and current information.',
      sourceId: FIELD_SOURCE,
      layerId: FIELD_LAYER,
      defaultOpacity: 0.72,
      fieldRgba: currentFieldRgba,
    },
    makeCanvas,
  );
  let theme: Theme = 'day';
  let visible = false;
  let lastSpeedUnit: SpeedUnit | undefined;
  const gate = gridTimeGate(store);

  return {
    ...field,
    layerIds: [FIELD_LAYER, ARROW_LAYER, LABEL_LAYER],
    add(ctx) {
      void field.add(ctx);
      ensureGeoJsonSource(ctx.map, ARROW_SOURCE);
      ensureGeoJsonSource(ctx.map, LABEL_SOURCE);
      if (!ctx.map.getLayer(ARROW_LAYER)) {
        const layer: LineLayerSpecification = {
          id: ARROW_LAYER,
          type: 'line',
          source: ARROW_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': currentArrowColor(theme), 'line-width': 1.7 },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor('weather'));
      }
      if (!ctx.map.getLayer(LABEL_LAYER)) {
        const layer: SymbolLayerSpecification = {
          id: LABEL_LAYER,
          type: 'symbol',
          source: LABEL_SOURCE,
          layout: {
            'text-field': ['get', 'label'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 10,
            'text-offset': [0, 1.2],
            'text-allow-overlap': false,
          },
          paint: { 'text-color': currentArrowColor(theme) },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor('weather'));
      }
    },
    reset() {
      field.reset?.();
      gate.reset();
      lastSpeedUnit = undefined;
    },
    sync(ctx) {
      if (!visible) return;
      field.sync(ctx);
      const speedUnit = getSpeedUnit();
      if (!gate.changed() && speedUnit === lastSpeedUnit) return;
      const grid = store.grid;
      const vectors = grid
        ? currentVectorFeatures(grid, store.bracket, speedUnit)
        : { arrows: emptyFeatureCollection(), markers: emptyFeatureCollection() };
      setSourceData(ctx.map, ARROW_SOURCE, vectors.arrows);
      setSourceData(ctx.map, LABEL_SOURCE, vectors.markers);
      lastSpeedUnit = speedUnit;
    },
    remove(ctx) {
      visible = false;
      removeLayersAndSources(ctx.map, [ARROW_LAYER, LABEL_LAYER], [ARROW_SOURCE, LABEL_SOURCE]);
      field.remove(ctx);
    },
    setVisible(ctx, value) {
      const justBecameVisible = becameVisible(visible, value);
      visible = value;
      field.setVisible(ctx, value);
      setLayersVisibility(ctx.map, [ARROW_LAYER, LABEL_LAYER], value);
      if (justBecameVisible) {
        gate.reset();
        this.sync(ctx);
      }
    },
    setOpacity(ctx, opacity) {
      field.setOpacity?.(ctx, opacity);
      if (ctx.map.getLayer(ARROW_LAYER)) {
        ctx.map.setPaintProperty(ARROW_LAYER, 'line-opacity', opacity);
      }
      if (ctx.map.getLayer(LABEL_LAYER)) {
        ctx.map.setPaintProperty(LABEL_LAYER, 'text-opacity', opacity);
      }
    },
    applyTheme(ctx, paint) {
      theme = paint.theme;
      field.applyTheme?.(ctx, paint);
      if (ctx.map.getLayer(ARROW_LAYER)) {
        ctx.map.setPaintProperty(ARROW_LAYER, 'line-color', currentArrowColor(theme));
      }
      if (ctx.map.getLayer(LABEL_LAYER)) {
        ctx.map.setPaintProperty(LABEL_LAYER, 'text-color', currentArrowColor(theme));
      }
    },
  };
}
