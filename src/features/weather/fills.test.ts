import { describe, expect, it } from 'vitest';
import {
  CHART_FORECAST_LAYER_IDS,
  CHART_GRID_LAYER_IDS,
  WEATHER_FILL_ID_SET,
  WEATHER_LAYER_IDS,
} from './fills';

describe('weather layer roles', () => {
  it('keeps ocean currents independent from mutually exclusive fills and forecast modes', () => {
    expect(WEATHER_FILL_ID_SET.has(WEATHER_LAYER_IDS.current)).toBe(false);
    expect(CHART_FORECAST_LAYER_IDS).not.toContain(WEATHER_LAYER_IDS.current);
    expect(CHART_GRID_LAYER_IDS).toContain(WEATHER_LAYER_IDS.current);
  });
});
