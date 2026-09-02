import type { CurrentEvent, TideEvent, TidesStore } from '$entities/tides';
import type { TimeBracket, WeatherGrid } from '$entities/weather';
import {
  formatBearingOr,
  formatDayClock,
  formatLengthOr,
  formatSpeedOr,
  HOUR_MS,
  lengthUnit,
  MINUTE_MS,
  type SpeedUnit,
  speedUnitLabel,
  type UnitsMode,
} from '$shared/lib';
import { featureCollection } from '$shared/map';
import {
  assessMarineConditions,
  type MarineCondition,
  type MarineConditionSeverity,
} from './conditions';
import { readoutAtBracket, type WeatherReadout } from './weather-readout';

export interface ConditionsView {
  west: number;
  south: number;
  east: number;
  north: number;
  width?: number;
  height?: number;
}

export interface ConditionFeatureProperties {
  key: string;
  glyph: string;
  severity: MarineConditionSeverity;
  title: string;
  summary: string;
  related: string;
  scope: string;
  valid: string;
  wind: string;
  gust: string;
  waves: string;
  current: string;
  tide: string;
  source: string;
}

const TARGET_SPACING_PX = 140;
const DEFAULT_COLUMNS = 6;
const DEFAULT_ROWS = 4;
const MAX_COLUMNS = 10;
const MAX_ROWS = 7;
const CURRENT_EVENT_WINDOW_MS = 75 * MINUTE_MS;
const SLACK_EVENT_WINDOW_MS = 45 * MINUTE_MS;
const TIDE_EVENT_WINDOW_MS = HOUR_MS;

function targetCount(pixels: number | undefined, fallback: number, maximum: number): number {
  if (!(pixels && pixels > 0)) return fallback;
  return Math.max(2, Math.min(maximum, Math.round(pixels / TARGET_SPACING_PX)));
}

function sampleAxis(low: number, high: number, count: number): number[] {
  if (!(high > low)) return [];
  const step = (high - low) / count;
  return Array.from({ length: count }, (_, index) => low + (index + 0.5) * step);
}

function visibleSamples(grid: WeatherGrid, view: ConditionsView): Array<[number, number]> {
  const west = Math.max(view.west, grid.lons[0] ?? Number.POSITIVE_INFINITY);
  const east = Math.min(view.east, grid.lons.at(-1) ?? Number.NEGATIVE_INFINITY);
  const south = Math.max(view.south, grid.lats[0] ?? Number.POSITIVE_INFINITY);
  const north = Math.min(view.north, grid.lats.at(-1) ?? Number.NEGATIVE_INFINITY);
  const lons = sampleAxis(west, east, targetCount(view.width, DEFAULT_COLUMNS, MAX_COLUMNS));
  const lats = sampleAxis(south, north, targetCount(view.height, DEFAULT_ROWS, MAX_ROWS));
  return lats.flatMap((latitude) =>
    lons.map((longitude) => [longitude, latitude] as [number, number]),
  );
}

function direction(value: number | undefined, convention: 'from' | 'toward'): string {
  return value === undefined ? '' : `${formatBearingOr(value)}°T ${convention}`;
}

function formatWind(readout: WeatherReadout, unit: SpeedUnit): string {
  return `${formatSpeedOr(readout.speedMs, unit, 0)} ${speedUnitLabel(unit)} ${direction(readout.fromRad, 'from')}`;
}

function formatGust(readout: WeatherReadout, unit: SpeedUnit): string {
  return readout.gustMs === undefined
    ? ''
    : `${formatSpeedOr(readout.gustMs, unit, 0)} ${speedUnitLabel(unit)}`;
}

function formatWaves(readout: WeatherReadout, mode: UnitsMode): string {
  if (readout.waveHeightM === undefined) return '';
  const period =
    readout.wavePeriodS === undefined ? '' : ` at ${Math.round(readout.wavePeriodS)} s`;
  const bearing =
    readout.waveFromRad === undefined ? '' : `, ${direction(readout.waveFromRad, 'from')}`;
  return `${formatLengthOr(readout.waveHeightM, mode, mode === 'imperial' ? 0 : 1)} ${lengthUnit(mode)}${period}${bearing}`;
}

function formatCurrent(readout: WeatherReadout, unit: SpeedUnit): string {
  if (readout.currentSpeedMs === undefined) return '';
  const bearing =
    readout.currentDirectionRad === undefined
      ? ''
      : `, ${direction(readout.currentDirectionRad, 'toward')}`;
  return `${formatSpeedOr(readout.currentSpeedMs, unit, 1)} ${speedUnitLabel(unit)}${bearing}`;
}

function relatedConditions(conditions: MarineCondition[]): string {
  return conditions
    .slice(1)
    .map((condition) => condition.title)
    .join(', ');
}

function gridFeature(
  longitude: number,
  latitude: number,
  readout: WeatherReadout,
  selectedTime: number,
  speedUnit: SpeedUnit,
  mode: UnitsMode,
): GeoJSON.Feature<GeoJSON.Point, ConditionFeatureProperties> | undefined {
  const conditions = assessMarineConditions(readout);
  const primary = conditions[0];
  if (!primary) return undefined;
  const key = `grid:${longitude.toFixed(4)}:${latitude.toFixed(4)}`;
  return {
    type: 'Feature',
    id: key,
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    properties: {
      key,
      glyph: primary.glyph,
      severity: primary.severity,
      title: primary.title,
      summary: primary.summary,
      related: relatedConditions(conditions),
      scope: 'Forecast grid point',
      valid: formatDayClock(selectedTime, { zone: true }),
      wind: formatWind(readout, speedUnit),
      gust: formatGust(readout, speedUnit),
      waves: formatWaves(readout, mode),
      current: formatCurrent(readout, speedUnit),
      tide: '',
      source: 'Atmospheric forecast and Open-Meteo Marine',
    },
  };
}

function nearestEvent<T extends { timeMs: number }>(
  events: T[],
  selectedTime: number,
): T | undefined {
  let nearest: T | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const event of events) {
    const candidateDistance = Math.abs(event.timeMs - selectedTime);
    if (candidateDistance < distance) {
      nearest = event;
      distance = candidateDistance;
    }
  }
  return nearest;
}

function currentStationCondition(event: CurrentEvent): MarineCondition {
  if (event.kind === 'slack') {
    return {
      kind: 'following-current',
      severity: 'context',
      glyph: '○',
      title: 'Slack-current window',
      summary: 'The selected NOAA current station predicts slack water near this forecast time.',
    };
  }
  const tag = event.kind === 'flood' ? 'flood' : 'ebb';
  return {
    kind: 'opposing-current',
    severity: event.velocityMps >= 0.5 ? 'caution' : 'context',
    glyph: event.kind === 'flood' ? 'F' : 'E',
    title: `Maximum ${tag} current`,
    summary: `The selected NOAA current station predicts maximum ${tag} near this forecast time.`,
  };
}

function tideStationCondition(event: TideEvent): MarineCondition {
  const tag = event.kind === 'high' ? 'High' : 'Low';
  return {
    kind: 'following-current',
    severity: 'context',
    glyph: event.kind === 'high' ? 'H' : 'L',
    title: `${tag} tide window`,
    summary: `The selected NOAA tide station predicts ${event.kind} water near this forecast time.`,
  };
}

function stationFeature(
  key: string,
  longitude: number,
  latitude: number,
  stationName: string,
  condition: MarineCondition,
  selectedTime: number,
  current: string,
  tide: string,
): GeoJSON.Feature<GeoJSON.Point, ConditionFeatureProperties> {
  return {
    type: 'Feature',
    id: key,
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    properties: {
      key,
      glyph: condition.glyph,
      severity: condition.severity,
      title: condition.title,
      summary: condition.summary,
      related: '',
      scope: stationName,
      valid: formatDayClock(selectedTime, { zone: true }),
      wind: '',
      gust: '',
      waves: '',
      current,
      tide,
      source: 'NOAA CO-OPS station prediction',
    },
  };
}

function stationFeatures(
  tides: TidesStore,
  selectedTime: number,
  speedUnit: SpeedUnit,
  mode: UnitsMode,
): Array<GeoJSON.Feature<GeoJSON.Point, ConditionFeatureProperties>> {
  const features: Array<GeoJSON.Feature<GeoJSON.Point, ConditionFeatureProperties>> = [];
  const currentReading = tides.current;
  if (currentReading) {
    const event = nearestEvent(currentReading.events, selectedTime);
    const window = event?.kind === 'slack' ? SLACK_EVENT_WINDOW_MS : CURRENT_EVENT_WINDOW_MS;
    if (event && Math.abs(event.timeMs - selectedTime) <= window) {
      const bearing =
        event.directionRad === undefined ? '' : `, ${direction(event.directionRad, 'toward')}`;
      features.push(
        stationFeature(
          `current:${currentReading.station.id}`,
          currentReading.station.longitude,
          currentReading.station.latitude,
          currentReading.station.name,
          currentStationCondition(event),
          selectedTime,
          `${formatSpeedOr(event.velocityMps, speedUnit, 1)} ${speedUnitLabel(speedUnit)}${bearing} at ${formatDayClock(event.timeMs, { zone: true })}`,
          '',
        ),
      );
    }
  }
  const tideReading = tides.tide;
  if (tideReading) {
    const event = nearestEvent(tideReading.events, selectedTime);
    if (event && Math.abs(event.timeMs - selectedTime) <= TIDE_EVENT_WINDOW_MS) {
      features.push(
        stationFeature(
          `tide:${tideReading.station.id}`,
          tideReading.station.longitude,
          tideReading.station.latitude,
          tideReading.station.name,
          tideStationCondition(event),
          selectedTime,
          '',
          `${formatLengthOr(event.heightMeters, mode, mode === 'imperial' ? 1 : 2)} ${lengthUnit(mode)} at ${formatDayClock(event.timeMs, { zone: true })}`,
        ),
      );
    }
  }
  return features;
}

export function conditionFeatures(
  grid: WeatherGrid | undefined,
  bracket: TimeBracket,
  view: ConditionsView,
  tides: TidesStore,
  selectedTime: number,
  speedUnit: SpeedUnit,
  mode: UnitsMode,
): GeoJSON.FeatureCollection<GeoJSON.Point, ConditionFeatureProperties> {
  const features: Array<GeoJSON.Feature<GeoJSON.Point, ConditionFeatureProperties>> = [];
  if (grid) {
    for (const [longitude, latitude] of visibleSamples(grid, view)) {
      const readout = readoutAtBracket(grid, longitude, latitude, bracket);
      if (!readout) continue;
      const feature = gridFeature(longitude, latitude, readout, selectedTime, speedUnit, mode);
      if (feature) features.push(feature);
    }
  }
  features.push(...stationFeatures(tides, selectedTime, speedUnit, mode));
  return featureCollection(features) as GeoJSON.FeatureCollection<
    GeoJSON.Point,
    ConditionFeatureProperties
  >;
}
