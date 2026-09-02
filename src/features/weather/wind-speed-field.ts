import type { TimeBracket, WeatherGrid } from '$entities/weather';
import { lerp } from '$shared/lib';
import type { Theme } from '$shared/ui';
import type { FieldBitmap } from './field-rgba';
import { windColor } from './wind-colormap';

// Build the combined wind view's color surface from forecast gust speed, falling back to sustained
// u/v speed for cached grids created before gusts joined the chart request. Barbs carry sustained
// direction and speed above this field, so the two encodings answer both steering and reefing needs.
export function windSpeedFieldRgba(
  grid: WeatherGrid,
  bracket: TimeBracket,
  theme: Theme,
): FieldBitmap | undefined {
  const uLo = grid.windU[bracket.lo];
  const vLo = grid.windV[bracket.lo];
  if (!uLo || !vLo || uLo.length === 0 || vLo.length === 0) return undefined;
  const uHi = grid.windU[bracket.hi] ?? uLo;
  const vHi = grid.windV[bracket.hi] ?? vLo;
  const gustLo = grid.windGust?.[bracket.lo];
  const gustHi = grid.windGust?.[bracket.hi] ?? gustLo;
  const cols = grid.lons.length;
  const rows = grid.lats.length;
  const data = new Uint8ClampedArray(cols * rows * 4);

  for (let py = 0; py < rows; py += 1) {
    const gridRow = rows - 1 - py;
    for (let px = 0; px < cols; px += 1) {
      const i = gridRow * cols + px;
      const u = lerp(uLo[i], uHi[i] ?? uLo[i], bracket.frac);
      const v = lerp(vLo[i], vHi[i] ?? vLo[i], bracket.frac);
      const offset = (py * cols + px) * 4;
      if (!Number.isFinite(u) || !Number.isFinite(v)) {
        data[offset + 3] = 0;
        continue;
      }
      const gust = gustLo ? lerp(gustLo[i], gustHi?.[i] ?? gustLo[i], bracket.frac) : Number.NaN;
      const [r, g, b, rampAlpha] = windColor(
        Number.isFinite(gust) ? gust : Math.hypot(u, v),
        theme,
      );
      data[offset] = Math.round(r * 255);
      data[offset + 1] = Math.round(g * 255);
      data[offset + 2] = Math.round(b * 255);
      data[offset + 3] = Math.round(
        Math.max(theme === 'night-red' ? 0.38 : 0.5, rampAlpha * 0.72) * 255,
      );
    }
  }
  return { data, width: cols, height: rows };
}
