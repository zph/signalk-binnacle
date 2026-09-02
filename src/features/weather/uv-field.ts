import type { TimeBracket, WeatherGrid } from '$entities/weather';
import type { Theme } from '$shared/ui';
import { type FieldBitmap, fieldRgba } from './field-rgba';
import { uvColor } from './uv-colormap';

export function uvFieldRgba(
  grid: WeatherGrid,
  bracket: TimeBracket,
  theme: Theme,
): FieldBitmap | undefined {
  return fieldRgba(grid, grid.uvIndex, bracket, (value) => uvColor(value, theme));
}
