import {
  formatLengthOr,
  formatPercent,
  formatPrecipRateOr,
  formatSpeedOr,
  formatTemperatureOr,
  knotsToMetersPerSecond,
  lengthUnit,
  precipRateUnit,
  type SpeedUnit,
  temperatureUnit,
  type UnitsMode,
} from '$shared/lib';
import { mapThemePaint } from '$shared/map';
import type { Theme } from '$shared/ui';
import { cloudColor } from './cloud-colormap';
import { type Rgba, tupleCss } from './color-ramp';
import { currentColor } from './current-colormap';
import { WEATHER_LAYER_IDS } from './fills';
import { precipColor } from './precip-colormap';
import { isobarColors } from './pressure-colors';
import { DEFAULT_INTERVAL_HPA } from './pressure-isobars';
import { temperatureColor } from './temperature-colormap';
import { uvColor } from './uv-colormap';
import { waveColor } from './wave-colormap';
import { windColor } from './wind-colormap';

interface LegendSwatch {
  color: string;
  label: string;
}

export interface WeatherLegend {
  id: string;
  title: string;
  // A continuous ramp: a CSS gradient with low and high end labels.
  gradient?: string;
  lowLabel?: string;
  highLabel?: string;
  // Or discrete swatches, for the isobar line and the fixed radar palette.
  swatches?: LegendSwatch[];
  // An optional short footnote, for example the radar's resolution limit.
  note?: string;
}

// Whole-knot stops (in m/s): sailors think in 10-knot bands, and the old m/s stops rendered as
// "0.0" and "50.5" kn, false precision on model wind.
const WIND_STOPS = [0, 10, 20, 30, 40, 50].map(knotsToMetersPerSecond);
const CURRENT_STOPS = [0, 0.5, 1, 2, 3, 4].map(knotsToMetersPerSecond);
const WAVE_STOPS = [0.5, 1, 2, 4, 6, 9]; // m
const PRECIP_STOPS = [0.2, 1, 2.5, 10, 25, 40]; // mm/h, tops out where the precip colormap does
const CLOUD_STOPS = [0.25, 0.5, 0.75, 1]; // fraction
const TEMPERATURE_STOPS = [263.15, 273.15, 283.15, 293.15, 303.15, 313.15]; // K
const UV_STOPS = [0, 3, 6, 8, 11];

// Render a colormap stop opaque so the legend ramp is visible even where the field itself is
// translucent or fully transparent at the low end.
function opaque([r, g, b]: Rgba): string {
  return tupleCss([r, g, b, 1]);
}

// A continuous-ramp legend: a left-to-right CSS gradient across the stops, plus the value at each
// end at the display unit.
function rampLegend(
  id: string,
  title: string,
  stops: number[],
  color: (value: number) => Rgba,
  label: (value: number) => string,
): WeatherLegend {
  const min = stops[0];
  const max = stops[stops.length - 1];
  const span = max - min || 1;
  const parts = stops.map((v) => `${opaque(color(v))} ${Math.round(((v - min) / span) * 100)}%`);
  return {
    id,
    title,
    gradient: `linear-gradient(to right, ${parts.join(', ')})`,
    lowLabel: label(min),
    highLabel: label(max),
  };
}

// The legend for a weather layer: a continuous ramp for the field and arrow layers, or discrete
// swatches for the isobars and the radar. Wind stays in knots regardless of the unit preference
// (nautical units are unconditional at sea); the wave and rain legends follow the mode. Returns
// undefined for an unknown layer id.
export function weatherLegend(
  layerId: string,
  theme: Theme,
  mode: UnitsMode,
  speedUnit: SpeedUnit = 'kn',
): WeatherLegend | undefined {
  switch (layerId) {
    case WEATHER_LAYER_IDS.conditions: {
      const paint = mapThemePaint(theme);
      return {
        id: layerId,
        title: 'Combined conditions',
        swatches: [
          { color: paint.danger, label: 'hazard' },
          { color: paint.warning, label: 'caution' },
          { color: paint.tide, label: 'context' },
        ],
        note: 'one icon shows the highest-priority condition at each point; no icon is not a safety statement',
      };
    }
    case WEATHER_LAYER_IDS.wind:
      return {
        ...rampLegend(
          layerId,
          `Sustained wind (${speedUnit})`,
          WIND_STOPS,
          (s) => windColor(s, theme),
          (s) => formatSpeedOr(s, speedUnit, 0),
        ),
        note: `color shows sustained wind; barbs show direction; labels show gust speed in ${speedUnit}`,
      };
    case WEATHER_LAYER_IDS.current:
      return {
        ...rampLegend(
          layerId,
          `Ocean currents (${speedUnit})`,
          CURRENT_STOPS,
          (speed) => currentColor(speed, theme),
          (speed) => formatSpeedOr(speed, speedUnit, 1),
        ),
        note: 'modeled surface current; arrows point toward the set',
      };
    case WEATHER_LAYER_IDS.temperature:
      return rampLegend(
        layerId,
        `Air temperature (${temperatureUnit(mode)})`,
        TEMPERATURE_STOPS,
        (value) => temperatureColor(value, theme),
        (value) => formatTemperatureOr(value, mode, 0),
      );
    case WEATHER_LAYER_IDS.uv:
      return rampLegend(
        layerId,
        'UV index',
        UV_STOPS,
        (value) => uvColor(value, theme),
        (value) => String(value),
      );
    case WEATHER_LAYER_IDS.pressure:
      // Isobars are conventionally hectopascals on every chart, so the isobar legend and the
      // on-map labels stay hPa in either mode; only the pressure readouts convert.
      return {
        id: layerId,
        title: 'Pressure',
        swatches: [
          { color: isobarColors(theme).line, label: `isobars, ${DEFAULT_INTERVAL_HPA} hPa` },
        ],
      };
    case WEATHER_LAYER_IDS.waves:
      return rampLegend(
        layerId,
        `Waves (${lengthUnit(mode)})`,
        WAVE_STOPS,
        (h) => waveColor(h, theme),
        // Whole feet: a tenth of a foot on model waves is false precision.
        (h) => formatLengthOr(h, mode, mode === 'imperial' ? 0 : 1),
      );
    case WEATHER_LAYER_IDS.precip:
      return rampLegend(
        layerId,
        `Rain (${precipRateUnit(mode)})`,
        PRECIP_STOPS,
        (p) => precipColor(p, theme),
        (p) => formatPrecipRateOr(p, mode),
      );
    case WEATHER_LAYER_IDS.cloud:
      return rampLegend(
        layerId,
        'Cloud (%)',
        CLOUD_STOPS,
        (c) => cloudColor(c, theme),
        // Whole percent: model cloud fraction has no tenth-percent meaning.
        (c) => formatPercent(c),
      );
    case WEATHER_LAYER_IDS.radar:
      // RainViewer's raster palette is a fixed light-to-intense scale. At night the tiles are
      // desaturated to red (applyRasterTheme), so the legend uses a red-band ramp there to honor the
      // night-red contract rather than showing literal blue and green chips.
      // PINNED to applyRasterTheme in shared/map/map-theme.ts: these night chips hand-approximate
      // that treatment's raster-saturation and raster-brightness-max output, so a change to those
      // paint values must re-tune these literals or the legend lies about the tiles.
      return {
        id: layerId,
        title: 'Rain radar',
        swatches:
          theme === 'night-red'
            ? [
                { color: 'rgb(90, 26, 20)', label: 'light' },
                { color: 'rgb(140, 36, 26)', label: 'moderate' },
                { color: 'rgb(190, 50, 36)', label: 'heavy' },
                { color: 'rgb(240, 80, 60)', label: 'intense' },
              ]
            : [
                { color: 'rgb(120, 160, 230)', label: 'light' },
                { color: 'rgb(60, 170, 90)', label: 'moderate' },
                { color: 'rgb(230, 200, 60)', label: 'heavy' },
                { color: 'rgb(220, 70, 60)', label: 'intense' },
              ],
        // The newest RainViewer frames are model extrapolation, not observation; "live radar"
        // would overstate them.
        note: 'radar with short-term nowcast, regional resolution',
      };
    default:
      return undefined;
  }
}
