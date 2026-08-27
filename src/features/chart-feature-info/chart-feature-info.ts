import type { DepthUnit } from '$entities/units';
import type { UnitsMode } from '$shared/lib';
import { formatFixed, formatLengthOr, lengthUnit, metersToFeet } from '$shared/lib';
import type { ChartFeatureSelection } from '$shared/map';

export interface ChartFeatureDetails {
  title: string;
  isLocalBathymetry: boolean;
  depth?: string;
  depthUnit: DepthUnit;
  quality?: string;
  confidenceReasons: string[];
  uncertainty?: string;
  robustDepth?: string;
  observations?: number;
  soundings?: number;
  passes?: number;
  sources?: number;
  cellSize?: string;
  cellSizeUnit: 'm' | 'ft';
  newestAtMs?: number;
  datum?: string;
  mode?: 'datum' | 'water';
  changeState?: string;
}

export function chartFeatureDetails(
  selection: ChartFeatureSelection,
  mode: UnitsMode,
  depthUnit: DepthUnit = lengthUnit(mode),
): ChartFeatureDetails {
  const properties = selection.properties;
  const depthM = numberProperty(properties, 'BATHY_DEPTH_M', 'DEPTH', 'DRVAL1', 'VALSOU');
  const confidence = numberProperty(properties, 'BATHY_CONFIDENCE');
  const reasons =
    stringProperty(properties, 'BATHY_CONFIDENCE_REASONS')
      ?.split('|')
      .filter(Boolean)
      .map(humanizeReason) ?? [];
  const result: ChartFeatureDetails = {
    isLocalBathymetry: stringProperty(properties, 'BATHYMETRY_PROVIDER') === 'signalk-bathymetry',
    title:
      stringProperty(properties, 'BATHYMETRY_PROVIDER') === 'signalk-bathymetry'
        ? 'Local bathymetry cell'
        : selection.sourceLayer === 'SOUNDG'
          ? 'Chart sounding'
          : 'Chart depth area',
    depthUnit,
    cellSizeUnit: lengthUnit(mode),
    confidenceReasons: reasons,
  };
  if (depthM !== undefined) result.depth = formatDepth(depthM, depthUnit);
  if (confidence !== undefined) {
    result.quality = `${qualityBand(confidence)} (${Math.round(clamp01(confidence) * 100)}%)`;
  }
  const uncertaintyM = numberProperty(properties, 'BATHY_VERTICAL_SIGMA_M');
  if (uncertaintyM !== undefined) result.uncertainty = formatDepth(uncertaintyM, depthUnit);
  const robustDepthM = numberProperty(properties, 'BATHY_ROBUST_DEPTH_M');
  if (robustDepthM !== undefined) result.robustDepth = formatDepth(robustDepthM, depthUnit);
  result.observations = integerProperty(properties, 'BATHY_OBSERVATION_COUNT');
  result.soundings = integerProperty(properties, 'BATHY_SOUNDING_COUNT');
  result.passes = integerProperty(properties, 'BATHY_PASS_COUNT');
  result.sources = integerProperty(properties, 'BATHY_SOURCE_COUNT');
  const cellMeters = numberProperty(properties, 'BATHY_CELL_METERS');
  if (cellMeters !== undefined) result.cellSize = formatLengthOr(cellMeters, mode, 0);
  result.newestAtMs = numberProperty(properties, 'BATHY_NEWEST_AT_MS');
  result.datum = stringProperty(properties, 'BATHY_DATUM');
  const bathyMode = stringProperty(properties, 'BATHY_MODE');
  if (bathyMode === 'datum' || bathyMode === 'water') result.mode = bathyMode;
  result.changeState = stringProperty(properties, 'BATHY_CHANGE_STATE');
  return result;
}

function formatDepth(meters: number, unit: DepthUnit): string {
  // The inspection card is the detail view, so retain one decimal instead of throwing away
  // measured precision. The selected unit comes from Signal K's depth category.
  const value = unit === 'ft' ? metersToFeet(meters) : unit === 'fm' ? meters / 1.8288 : meters;
  return formatFixed(value, 1);
}

function qualityBand(confidence: number): string {
  if (confidence >= 0.8) return 'Strong evidence';
  if (confidence >= 0.6) return 'Moderate evidence';
  if (confidence >= 0.4) return 'Limited evidence';
  return 'Weak evidence';
}

function humanizeReason(reason: string): string {
  return reason
    .split('_')
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

function numberProperty(
  properties: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = properties[key];
    const parsed =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function integerProperty(properties: Record<string, unknown>, key: string): number | undefined {
  const value = numberProperty(properties, key);
  return value === undefined ? undefined : Math.max(0, Math.round(value));
}

function stringProperty(properties: Record<string, unknown>, key: string): string | undefined {
  const value = properties[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
