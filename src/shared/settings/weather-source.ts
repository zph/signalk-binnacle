export type WeatherSourceId = 'automatic' | 'noaa' | 'dwd' | 'ecmwf';

export interface WeatherSourceOption {
  id: WeatherSourceId;
  title: string;
  coverage: 'Global' | 'Global + U.S.' | 'Global + Europe';
  endpoint: string;
  description: string;
}

// Open-Meteo provides one stable, bounded point API over these public model families. Binnacle
// keeps the model choice explicit and retains U/V in SI after parsing, so display preferences never
// change the cached forecast data.
export const WEATHER_SOURCE_OPTIONS: readonly WeatherSourceOption[] = [
  {
    id: 'automatic',
    title: 'Automatic',
    coverage: 'Global',
    endpoint: 'https://api.open-meteo.com/v1/forecast',
    description: 'The best available global or regional model for each location.',
  },
  {
    id: 'noaa',
    title: 'NOAA GFS + HRRR',
    coverage: 'Global + U.S.',
    endpoint: 'https://api.open-meteo.com/v1/gfs',
    description: 'Global GFS with higher-resolution HRRR where it covers the United States.',
  },
  {
    id: 'dwd',
    title: 'DWD ICON',
    coverage: 'Global + Europe',
    endpoint: 'https://api.open-meteo.com/v1/dwd-icon',
    description: 'Global ICON with higher-resolution ICON-EU and ICON-D2 regional forecasts.',
  },
  {
    id: 'ecmwf',
    title: 'ECMWF IFS',
    coverage: 'Global',
    endpoint: 'https://api.open-meteo.com/v1/ecmwf',
    description: 'Global ECMWF IFS forecast fields.',
  },
] as const;

export function isWeatherSourceId(value: unknown): value is WeatherSourceId {
  return WEATHER_SOURCE_OPTIONS.some((option) => option.id === value);
}

export function weatherSourceOption(id: WeatherSourceId | undefined): WeatherSourceOption {
  return (
    WEATHER_SOURCE_OPTIONS.find((option) => option.id === (id ?? 'automatic')) ??
    WEATHER_SOURCE_OPTIONS[0]
  );
}
