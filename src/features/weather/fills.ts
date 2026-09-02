// The canonical weather layer ids, one source of truth so the overlays, the legend, the panel
// grouping, and the mutually-exclusive fill set never drift. These strings are persisted in the
// saved layer settings, so they must stay stable.
export const WEATHER_LAYER_IDS = {
  conditions: 'weather-conditions',
  wind: 'weather-wind',
  current: 'weather-current',
  temperature: 'weather-temperature',
  uv: 'weather-uv',
  observedWind: 'weather-observed-wind',
  pressure: 'weather-pressure',
  waves: 'weather-waves',
  precip: 'weather-precip',
  cloud: 'weather-cloud',
  radar: 'weather-radar',
} as const;

// The primary chart's forecast button cycles these mutually exclusive visual modes. Keeping the
// ordered cycle beside the stable ids makes the button, Layers panel, and map manager agree.
export const CHART_FORECAST_LAYER_IDS = [
  WEATHER_LAYER_IDS.conditions,
  WEATHER_LAYER_IDS.wind,
  WEATHER_LAYER_IDS.current,
  WEATHER_LAYER_IDS.temperature,
  WEATHER_LAYER_IDS.uv,
] as const;

// The weather area-fill layer ids. These are mutually exclusive (one fill at a time): the
// LayerManager enforces it and the Weather panel groups them. Wind and pressure are combinable
// overlays, not fills.
export const WEATHER_FILL_IDS: string[] = [
  WEATHER_LAYER_IDS.current,
  WEATHER_LAYER_IDS.waves,
  WEATHER_LAYER_IDS.precip,
  WEATHER_LAYER_IDS.cloud,
  WEATHER_LAYER_IDS.radar,
];

// The same fill ids as a Set, for the O(1) membership tests the mini-map runs on every derived
// recompute. The array form stays the source of truth and feeds the LayerManager's exclusive option.
export const WEATHER_FILL_ID_SET = new Set(WEATHER_FILL_IDS);

// The free fallback source's display name (Open-Meteo). Shared so the conditions panel's "Here"
// label and the mini-map's readout-source gating name it once and cannot drift.
export const GRID_SOURCE_LABEL = 'Open-Meteo';
