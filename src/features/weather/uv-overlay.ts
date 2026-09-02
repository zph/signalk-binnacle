import type { WeatherStore } from '$entities/weather';
import { type CanvasFactory, createFieldOverlay, type FieldOverlay } from './field-overlay';
import { WEATHER_LAYER_IDS } from './fills';
import { uvFieldRgba } from './uv-field';

export function createUvOverlay(store: WeatherStore, makeCanvas?: CanvasFactory): FieldOverlay {
  return createFieldOverlay(
    store,
    {
      id: WEATHER_LAYER_IDS.uv,
      title: 'UV index',
      description: 'Forecast ultraviolet exposure risk across the chart.',
      sourceId: 'binnacle-weather-uv-field',
      layerId: 'binnacle-weather-uv-field-layer',
      defaultOpacity: 0.68,
      fieldRgba: uvFieldRgba,
    },
    makeCanvas,
  );
}
