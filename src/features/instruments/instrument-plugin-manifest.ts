import type {
  InstrumentTrendAggregate,
  InstrumentTrendDisplayKind,
} from '$entities/instrument-trend';
import { asNumber } from '$shared/geo';
import {
  CUBIC_METERS_TO_US_GALLONS,
  cleanBoundedText,
  formatBearingOr,
  formatDuration,
  formatFixed,
  formatKnotsOr,
  formatLengthOr,
  formatPercent,
  formatPressureOr,
  formatTemperatureOr,
  isRecord,
  lengthUnit,
  PLACEHOLDER,
  pressureUnit,
  RAD_TO_DEG,
  temperatureUnit,
} from '$shared/lib';
import { asKeyedObject, fetchAuthedJsonOutcome, fetchProviderIdList } from '$shared/signalk';
import { INSTRUMENT_PLUGIN_API_VERSION, type InstrumentPlugin } from './instrument-registry.svelte';
import {
  minPeriodFor,
  TILE_STALE_MS,
  type TileCategory,
  type TileDef,
  type TileDeps,
  type TileReading,
  type TileValueState,
} from './tile-catalog';

export const SIGNALK_INSTRUMENT_PLUGINS_PATH = '/signalk/v2/api/resources/binnacleInstruments';

export type InstrumentPluginLoadState = 'ready' | 'absent' | 'partial' | 'failed';

export interface InstrumentPluginLoadResult {
  state: InstrumentPluginLoadState;
  plugins: InstrumentPlugin[];
  rejected: number;
}

type ExternalFormat =
  | 'number'
  | 'speed'
  | 'bearing'
  | 'angle'
  | 'depth'
  | 'temperature'
  | 'pressure'
  | 'ratio'
  | 'duration'
  | 'rpm'
  | 'rate-of-turn'
  | 'voltage'
  | 'current'
  | 'volume'
  | 'power';

type ExternalPresentation = 'numeric' | 'compass' | 'heel' | 'wind';

interface ParsedInstrument {
  id: string;
  label: string;
  abbr?: string;
  description: string;
  sensorGloss: string;
  category: TileCategory;
  path: string;
  zonesPath: string;
  anglePath?: string;
  referenceLabel?: string;
  presentation: ExternalPresentation;
  format: ExternalFormat;
  precision: number;
  unit?: string;
  viz?: TileDef['viz'];
  trend: boolean;
  aggregate: InstrumentTrendAggregate;
}

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const INSTRUMENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SIGNALK_PATH_RE = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_-]+)+$/;
const CATEGORIES = new Set<TileCategory>([
  'navigation',
  'wind',
  'depth',
  'weather',
  'electrical',
  'propulsion',
  'tanks',
  'cabin',
]);
const FORMATS = new Set<ExternalFormat>([
  'number',
  'speed',
  'bearing',
  'angle',
  'depth',
  'temperature',
  'pressure',
  'ratio',
  'duration',
  'rpm',
  'rate-of-turn',
  'voltage',
  'current',
  'volume',
  'power',
]);
const PRESENTATIONS = new Set<ExternalPresentation>(['numeric', 'compass', 'heel', 'wind']);
const VISUALIZATIONS = new Set<NonNullable<TileDef['viz']>>(['spark', 'battery', 'rot']);
const MAX_PLUGINS = 50;
const MAX_INSTRUMENTS_PER_PLUGIN = 100;
const MAX_TOTAL_INSTRUMENTS = 500;

function cleanId(value: unknown, pattern: RegExp): string | undefined {
  const text = cleanBoundedText(value, 64);
  return text && pattern.test(text) ? text : undefined;
}

function cleanPath(value: unknown): string | undefined {
  const text = cleanBoundedText(value, 256);
  return text && SIGNALK_PATH_RE.test(text) ? text : undefined;
}

function enumValue<T extends string>(value: unknown, values: ReadonlySet<T>): T | undefined {
  return typeof value === 'string' && values.has(value as T) ? (value as T) : undefined;
}

function precision(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3
    ? value
    : 1;
}

function parseInstrument(value: unknown): ParsedInstrument | undefined {
  if (!isRecord(value)) return undefined;
  const id = cleanId(value.id, INSTRUMENT_ID_RE);
  const label = cleanBoundedText(value.label, 80);
  const description = cleanBoundedText(value.description, 240);
  const category = enumValue(value.category, CATEGORIES);
  const path = cleanPath(value.path);
  const format = enumValue(value.format, FORMATS);
  const presentation = enumValue(value.presentation ?? 'numeric', PRESENTATIONS);
  if (!id || !label || !description || !category || !path || !format || !presentation) {
    return undefined;
  }

  const anglePath = value.anglePath === undefined ? undefined : cleanPath(value.anglePath);
  if (presentation === 'wind' && (!anglePath || format !== 'speed')) return undefined;
  if (presentation === 'compass' && format !== 'bearing') return undefined;
  if (presentation === 'heel' && format !== 'angle') return undefined;
  if (value.unit !== undefined && format !== 'number') return undefined;

  const viz =
    value.visualization === undefined ? undefined : enumValue(value.visualization, VISUALIZATIONS);
  const aggregate = enumValue(
    value.aggregate ?? 'average',
    new Set<InstrumentTrendAggregate>(['average', 'max', 'last']),
  );
  if (!aggregate) return undefined;

  return {
    id,
    label,
    abbr: value.abbr === undefined ? undefined : cleanBoundedText(value.abbr, 12),
    description,
    sensorGloss: cleanBoundedText(value.sensorGloss, 80) ?? `No ${label.toLowerCase()} data`,
    category,
    path,
    zonesPath: cleanPath(value.zonesPath) ?? path,
    anglePath,
    referenceLabel:
      value.referenceLabel === undefined ? undefined : cleanBoundedText(value.referenceLabel, 24),
    presentation,
    format,
    precision: precision(value.precision),
    unit: value.unit === undefined ? undefined : cleanBoundedText(value.unit, 12),
    viz,
    trend: value.trend === true,
    aggregate,
  };
}

function stateFor(deps: TileDeps, path: string): TileValueState {
  const cell = deps.store.cell(path);
  if (cell.serverStale !== undefined) return 'stale';
  if (cell.epoch === 0) return 'never';
  if (deps.clock.now - cell.epoch > (cell.staleWindowMs ?? TILE_STALE_MS)) return 'stale';
  return cell.value === undefined ? 'placeholder' : 'live';
}

function formattedValue(
  format: ExternalFormat,
  value: number | undefined,
  deps: TileDeps,
  digits: number,
  unitOverride?: string,
): { value: string; unit: string } {
  switch (format) {
    case 'speed':
      return { value: formatKnotsOr(value, digits), unit: 'kn' };
    case 'bearing':
      return {
        value: value === undefined ? PLACEHOLDER : `${formatBearingOr(value, digits)}°`,
        unit: '',
      };
    case 'angle':
      return {
        value: formatFixed(value === undefined ? undefined : Math.abs(value) * RAD_TO_DEG, digits),
        unit: '°',
      };
    case 'depth':
      return {
        value: formatLengthOr(value, deps.units.mode, digits),
        unit: lengthUnit(deps.units.mode),
      };
    case 'temperature':
      return {
        value: formatTemperatureOr(value, deps.units.mode, digits),
        unit: temperatureUnit(deps.units.mode),
      };
    case 'pressure':
      return {
        value: formatPressureOr(value, deps.units.mode),
        unit: pressureUnit(deps.units.mode),
      };
    case 'ratio':
      return { value: formatPercent(value, digits), unit: '%' };
    case 'duration':
      return { value: value === undefined ? PLACEHOLDER : formatDuration(value), unit: '' };
    case 'rpm':
      return {
        value: formatFixed(value === undefined ? undefined : value * 60, digits),
        unit: 'rpm',
      };
    case 'rate-of-turn':
      return {
        value: formatFixed(value === undefined ? undefined : value * RAD_TO_DEG * 60, digits),
        unit: '°/min',
      };
    case 'volume':
      return deps.units.mode === 'imperial'
        ? {
            value: formatFixed(
              value === undefined ? undefined : value * CUBIC_METERS_TO_US_GALLONS,
              digits,
            ),
            unit: 'gal',
          }
        : { value: formatFixed(value === undefined ? undefined : value * 1000, digits), unit: 'L' };
    case 'power': {
      const scaled = value !== undefined && Math.abs(value) >= 1000 ? value / 1000 : value;
      return {
        value: formatFixed(scaled, digits),
        unit: value !== undefined && Math.abs(value) >= 1000 ? 'kW' : 'W',
      };
    }
    case 'number':
    case 'voltage':
    case 'current':
      return {
        value: formatFixed(value, digits),
        unit: unitOverride ?? (format === 'voltage' ? 'V' : format === 'current' ? 'A' : ''),
      };
  }
}

function trendDisplay(format: ExternalFormat): InstrumentTrendDisplayKind | undefined {
  const displays: Partial<Record<ExternalFormat, InstrumentTrendDisplayKind>> = {
    speed: 'speed',
    depth: 'depth',
    temperature: 'temperature',
    pressure: 'pressure',
    ratio: 'ratio',
    duration: 'duration',
    rpm: 'rpm',
    'rate-of-turn': 'rate-of-turn',
    voltage: 'voltage',
    current: 'current',
    volume: 'volume',
    power: 'power',
  };
  return displays[format];
}

function compileInstrument(pluginId: string, parsed: ParsedInstrument): TileDef {
  const paths = parsed.anglePath ? [parsed.path, parsed.anglePath] : [parsed.path];
  const display = trendDisplay(parsed.format);
  const read = (deps: TileDeps): TileReading => {
    const raw = asNumber(deps.store.cell(parsed.path).value);
    const formatted = formattedValue(parsed.format, raw, deps, parsed.precision, parsed.unit);
    const angleState = parsed.anglePath ? stateFor(deps, parsed.anglePath) : undefined;
    const angleRad = parsed.anglePath
      ? asNumber(deps.store.cell(parsed.anglePath).value)
      : parsed.presentation === 'compass' || parsed.presentation === 'heel'
        ? raw
        : undefined;
    return {
      state: stateFor(deps, parsed.path),
      ...formatted,
      siValue: raw,
      angleRad,
      angleState:
        parsed.anglePath && angleRad === undefined
          ? angleState === 'stale'
            ? 'stale'
            : 'unavailable'
          : undefined,
      referenceLabel: parsed.referenceLabel,
      rollRad: parsed.presentation === 'heel' ? raw : undefined,
      secondary:
        parsed.presentation === 'heel' && raw !== undefined
          ? raw > 0
            ? 'Starboard'
            : raw < 0
              ? 'Port'
              : 'Level'
          : undefined,
    };
  };
  return {
    id: `plugin:${pluginId}:${parsed.id}`,
    label: parsed.label,
    abbr: parsed.abbr,
    description: parsed.description,
    sensorGloss: parsed.sensorGloss,
    paths,
    zonesPath: parsed.zonesPath,
    useMetaDisplayName: false,
    category: parsed.category,
    kind: parsed.presentation,
    viz: parsed.presentation === 'numeric' ? parsed.viz : undefined,
    trend:
      parsed.trend && display
        ? {
            candidates: [
              {
                path: parsed.path,
                minPeriodMs: minPeriodFor(parsed.path),
                staleAfterMs: TILE_STALE_MS,
              },
            ],
            aggregate: parsed.aggregate,
            display,
            metricPrecision: parsed.precision,
            imperialPrecision: parsed.precision,
          }
        : undefined,
    read,
    formatSample(value, deps) {
      const formatted = formattedValue(
        parsed.format,
        asNumber(value),
        deps,
        parsed.precision,
        parsed.unit,
      );
      return `${formatted.value} ${formatted.unit}`.trim();
    },
  };
}

export function parseInstrumentPluginManifest(value: unknown): InstrumentPlugin | undefined {
  if (!isRecord(value) || value.apiVersion !== INSTRUMENT_PLUGIN_API_VERSION) return undefined;
  const id = cleanId(value.id, PLUGIN_ID_RE);
  const name = cleanBoundedText(value.name, 80);
  if (
    !id ||
    id.startsWith('binnacle.') ||
    !name ||
    !Array.isArray(value.instruments) ||
    value.instruments.length > MAX_INSTRUMENTS_PER_PLUGIN
  ) {
    return undefined;
  }
  const parsed = value.instruments.map(parseInstrument);
  if (parsed.some((instrument) => instrument === undefined)) return undefined;
  const complete = parsed as ParsedInstrument[];
  if (new Set(complete.map((instrument) => instrument.id)).size !== complete.length)
    return undefined;
  return {
    apiVersion: INSTRUMENT_PLUGIN_API_VERSION,
    id,
    name,
    instruments: complete.map((instrument) => compileInstrument(id, instrument)),
  };
}

export async function discoverInstrumentPlugins(
  origin: string,
  token: string | undefined,
): Promise<InstrumentPluginLoadResult> {
  const providers = await fetchProviderIdList(
    `${origin}${SIGNALK_INSTRUMENT_PLUGINS_PATH}/_providers`,
    token,
    MAX_PLUGINS,
  );
  if (!providers) return { state: 'failed', plugins: [], rejected: 0 };
  if (providers.ids.length === 0) return { state: 'absent', plugins: [], rejected: 0 };

  const outcome = await fetchAuthedJsonOutcome<unknown>(
    `${origin}${SIGNALK_INSTRUMENT_PLUGINS_PATH}`,
    token,
  );
  if (outcome.state !== 'ok') return { state: 'failed', plugins: [], rejected: 0 };
  const records = asKeyedObject(outcome.value);
  if (!records) return { state: 'failed', plugins: [], rejected: 0 };

  const plugins: InstrumentPlugin[] = [];
  let rejected = 0;
  let instrumentCount = 0;
  for (const value of Object.values(records).slice(0, MAX_PLUGINS)) {
    const plugin = parseInstrumentPluginManifest(value);
    if (!plugin || instrumentCount + plugin.instruments.length > MAX_TOTAL_INSTRUMENTS) {
      rejected += 1;
      continue;
    }
    instrumentCount += plugin.instruments.length;
    plugins.push(plugin);
  }
  return { state: rejected > 0 ? 'partial' : 'ready', plugins, rejected };
}
