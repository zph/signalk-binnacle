import type { TimeBracket, WeatherGrid } from '$entities/weather';
import type { Theme } from '$shared/ui';
import { type FieldBitmap, fieldRgba } from './field-rgba';
import { temperatureColor } from './temperature-colormap';

export function temperatureFieldRgba(
  grid: WeatherGrid,
  bracket: TimeBracket,
  theme: Theme,
): FieldBitmap | undefined {
  return fieldRgba(grid, grid.airTemperature, bracket, (value) => temperatureColor(value, theme));
}
