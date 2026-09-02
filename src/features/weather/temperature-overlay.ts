import type { WeatherStore } from '$entities/weather';
import { type CanvasFactory, createFieldOverlay, type FieldOverlay } from './field-overlay';
import { WEATHER_LAYER_IDS } from './fills';
import { temperatureFieldRgba } from './temperature-field';

export function createTemperatureOverlay(
  store: WeatherStore,
  makeCanvas?: CanvasFactory,
): FieldOverlay {
  return createFieldOverlay(
    store,
    {
      id: WEATHER_LAYER_IDS.temperature,
      title: 'Temperature',
      description: 'Forecast air temperature across the chart.',
      sourceId: 'binnacle-weather-temperature-field',
      layerId: 'binnacle-weather-temperature-field-layer',
      defaultOpacity: 0.68,
      fieldRgba: temperatureFieldRgba,
    },
    makeCanvas,
  );
}
