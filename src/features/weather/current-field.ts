import type { TimeBracket, WeatherGrid } from '$entities/weather';
import type { Theme } from '$shared/ui';
import { currentColor } from './current-colormap';
import { type FieldBitmap, fieldRgba } from './field-rgba';

export function currentFieldRgba(
  grid: WeatherGrid,
  bracket: TimeBracket,
  theme: Theme,
): FieldBitmap | undefined {
  return fieldRgba(grid, grid.oceanCurrentSpeed, bracket, (value) => currentColor(value, theme));
}
