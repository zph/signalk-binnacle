import type { SymbolLayerSpecification } from 'maplibre-gl';
import type { TidesStore } from '$entities/tides';
import type { WeatherStore } from '$entities/weather';
import type { SpeedUnit } from '$shared/lib';
import {
  ensureGeoJsonSource,
  removeLayersAndSources,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import type { Theme } from '$shared/ui';
import { noaaCurrentVectorFeatures } from './current-arrows';
import { currentArrowColor } from './current-colormap';
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
  tides: TidesStore,
  makeCanvas?: CanvasFactory,
  getSpeedUnit: () => SpeedUnit = () => 'kn',
): CurrentOverlay {
  const field = createFieldOverlay(
    store,
    {
      id: WEATHER_LAYER_IDS.current,
      title: 'Ocean currents',
      description:
        'Nearest local NOAA CO-OPS tidal-current prediction, estimated between published maximum and slack events.',
      sourceId: FIELD_SOURCE,
      layerId: FIELD_LAYER,
      defaultOpacity: 0.72,
      fieldRgba: () => undefined,
    },
    makeCanvas,
  );
  let theme: Theme = 'day';
  let visible = false;
  let lastSpeedUnit: SpeedUnit | undefined;
  let lastCurrent: unknown;
  const gate = gridTimeGate(store);

  return {
    ...field,
    layerIds: [FIELD_LAYER, ARROW_LAYER, LABEL_LAYER],
    add(ctx) {
      void field.add(ctx);
      ensureGeoJsonSource(ctx.map, ARROW_SOURCE);
      ensureGeoJsonSource(ctx.map, LABEL_SOURCE);
      if (!ctx.map.getLayer(ARROW_LAYER)) {
        const layer: SymbolLayerSpecification = {
          id: ARROW_LAYER,
          type: 'symbol',
          source: ARROW_SOURCE,
          layout: {
            'text-field': '↑',
            'text-font': ['Noto Sans Regular'],
            'text-size': 28,
            'text-rotate': ['get', 'bearing'],
            'text-allow-overlap': true,
          },
          paint: { 'text-color': currentArrowColor(theme) },
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
      lastCurrent = undefined;
    },
    sync(ctx) {
      if (!visible) return;
      field.sync(ctx);
      const speedUnit = getSpeedUnit();
      const current = tides.current;
      if (!gate.changed() && speedUnit === lastSpeedUnit && current === lastCurrent) return;
      const vectors = noaaCurrentVectorFeatures(current, store.selectedTime, speedUnit);
      setSourceData(ctx.map, ARROW_SOURCE, vectors.arrows);
      setSourceData(ctx.map, LABEL_SOURCE, vectors.markers);
      lastSpeedUnit = speedUnit;
      lastCurrent = current;
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
        ctx.map.setPaintProperty(ARROW_LAYER, 'text-opacity', opacity);
      }
      if (ctx.map.getLayer(LABEL_LAYER)) {
        ctx.map.setPaintProperty(LABEL_LAYER, 'text-opacity', opacity);
      }
    },
    applyTheme(ctx, paint) {
      theme = paint.theme;
      field.applyTheme?.(ctx, paint);
      if (ctx.map.getLayer(ARROW_LAYER)) {
        ctx.map.setPaintProperty(ARROW_LAYER, 'text-color', currentArrowColor(theme));
      }
      if (ctx.map.getLayer(LABEL_LAYER)) {
        ctx.map.setPaintProperty(LABEL_LAYER, 'text-color', currentArrowColor(theme));
      }
    },
  };
}
