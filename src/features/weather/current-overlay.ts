import type { ExpressionSpecification, SymbolLayerSpecification } from 'maplibre-gl';
import type { TidesStore } from '$entities/tides';
import type { WeatherStore } from '$entities/weather';
import type { SpeedUnit } from '$shared/lib';
import {
  emptyFeatureCollection,
  ensureGeoJsonSource,
  featureCollection,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import { currentVectorFeatures, noaaCurrentVectorFeatures } from './current-arrows';
import { currentArrowColorExpression, currentArrowOpacityExpression } from './current-colormap';
import { WEATHER_LAYER_IDS } from './fills';
import { gridTimeGate } from './grid-time-gate';
import { becameVisible } from './overlay-visibility';

const ARROW_SOURCE = 'binnacle-weather-current-arrows';
const ARROW_LAYER = 'binnacle-weather-current-arrow-layer';
const LABEL_SOURCE = 'binnacle-weather-current-labels';
const LABEL_LAYER = 'binnacle-weather-current-label-layer';

interface CurrentOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
  reset(): void;
}

export function createCurrentOverlay(
  store: WeatherStore,
  tides: TidesStore,
  getSpeedUnit: () => SpeedUnit = () => 'kn',
): CurrentOverlay {
  let mapPaint = mapThemePaint('day');
  let opacity = 1;
  let visible = false;
  let lastSpeedUnit: SpeedUnit | undefined;
  let lastCurrent: unknown;
  const gate = gridTimeGate(store);

  return {
    id: WEATHER_LAYER_IDS.current,
    title: 'Ocean currents',
    description:
      'Arrows point toward the modeled current set, with opacity increasing through 2 kn. The larger NOAA station arrow and label are blue for ebb and red for flood.',
    band: 'weather',
    supportsOpacity: true,
    defaultVisible: true,
    defaultOpacity: 1,
    layerIds: [ARROW_LAYER, LABEL_LAYER],
    add(ctx) {
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
            'text-size': ['case', ['has', 'station'], 36, 23],
            'text-rotate': ['get', 'bearing'],
            'text-rotation-alignment': 'map',
            'text-pitch-alignment': 'map',
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: {
            'text-color': currentArrowColorExpression(mapPaint.theme) as ExpressionSpecification,
            'text-opacity': currentArrowOpacityExpression(
              mapPaint.theme,
              opacity,
            ) as ExpressionSpecification,
            'text-halo-color': mapPaint.background,
            'text-halo-width': 1.5,
          },
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
            'text-size': 13,
            'text-line-height': 1.15,
            'text-offset': [0, 1.65],
            'text-anchor': 'top',
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: {
            'text-color': currentArrowColorExpression(mapPaint.theme) as ExpressionSpecification,
            'text-opacity': opacity,
            'text-halo-color': mapPaint.background,
            'text-halo-width': 2,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor('weather'));
      }
    },
    reset() {
      gate.reset();
      lastSpeedUnit = undefined;
      lastCurrent = undefined;
    },
    sync(ctx) {
      if (!visible) return;
      const speedUnit = getSpeedUnit();
      const current = tides.current;
      if (!gate.changed() && speedUnit === lastSpeedUnit && current === lastCurrent) return;
      const modeled = store.grid
        ? currentVectorFeatures(store.grid, store.bracket, speedUnit, false)
        : { arrows: emptyFeatureCollection(), markers: emptyFeatureCollection() };
      const local = noaaCurrentVectorFeatures(current, store.selectedTime, speedUnit);
      setSourceData(
        ctx.map,
        ARROW_SOURCE,
        featureCollection([...modeled.arrows.features, ...local.arrows.features]),
      );
      setSourceData(ctx.map, LABEL_SOURCE, local.markers);
      lastSpeedUnit = speedUnit;
      lastCurrent = current;
    },
    remove(ctx) {
      visible = false;
      removeLayersAndSources(ctx.map, [ARROW_LAYER, LABEL_LAYER], [ARROW_SOURCE, LABEL_SOURCE]);
    },
    setVisible(ctx, value) {
      const justBecameVisible = becameVisible(visible, value);
      visible = value;
      setLayersVisibility(ctx.map, [ARROW_LAYER, LABEL_LAYER], value);
      if (justBecameVisible) {
        gate.reset();
        this.sync(ctx);
      }
    },
    setOpacity(ctx, value) {
      opacity = value;
      if (ctx.map.getLayer(ARROW_LAYER)) {
        ctx.map.setPaintProperty(
          ARROW_LAYER,
          'text-opacity',
          currentArrowOpacityExpression(mapPaint.theme, opacity) as ExpressionSpecification,
        );
      }
      if (ctx.map.getLayer(LABEL_LAYER)) {
        ctx.map.setPaintProperty(LABEL_LAYER, 'text-opacity', opacity);
      }
    },
    applyTheme(ctx, paint) {
      mapPaint = paint;
      if (ctx.map.getLayer(ARROW_LAYER)) {
        ctx.map.setPaintProperty(
          ARROW_LAYER,
          'text-color',
          currentArrowColorExpression(mapPaint.theme) as ExpressionSpecification,
        );
        ctx.map.setPaintProperty(
          ARROW_LAYER,
          'text-opacity',
          currentArrowOpacityExpression(mapPaint.theme, opacity) as ExpressionSpecification,
        );
        ctx.map.setPaintProperty(ARROW_LAYER, 'text-halo-color', mapPaint.background);
      }
      if (ctx.map.getLayer(LABEL_LAYER)) {
        ctx.map.setPaintProperty(
          LABEL_LAYER,
          'text-color',
          currentArrowColorExpression(mapPaint.theme) as ExpressionSpecification,
        );
        ctx.map.setPaintProperty(LABEL_LAYER, 'text-halo-color', mapPaint.background);
      }
    },
  };
}
