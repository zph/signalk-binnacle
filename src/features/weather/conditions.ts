import { knotsToMetersPerSecond } from '$shared/lib';
import type { WeatherReadout } from './weather-readout';

export type MarineConditionSeverity = 'context' | 'caution' | 'hazard';
export type MarineConditionKind =
  | 'very-steep-seas'
  | 'steep-seas'
  | 'opposing-current'
  | 'crossing-seas'
  | 'gusty-wind'
  | 'reinforcing-seas'
  | 'following-current';

export interface MarineCondition {
  kind: MarineConditionKind;
  severity: MarineConditionSeverity;
  glyph: string;
  title: string;
  summary: string;
}

const GRAVITY_MPS2 = 9.80665;
const MIN_WAVE_HEIGHT_M = 0.5;
const MIN_COMPONENT_HEIGHT_M = 0.4;
const MIN_CURRENT_MPS = knotsToMetersPerSecond(0.5);
const GUST_SPREAD_MPS = knotsToMetersPerSecond(5);
const SEVERITY_ORDER: Record<MarineConditionSeverity, number> = {
  context: 0,
  caution: 1,
  hazard: 2,
};

function angleDifference(a: number, b: number): number {
  const difference = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(difference, 2 * Math.PI - difference);
}

// Wave directions are meteorological "from" bearings, while a current direction is the set it
// flows toward. Add pi before comparing them so opposing and following refer to wave travel.
function waveTravelDirection(waveFromRad: number): number {
  return (waveFromRad + Math.PI) % (2 * Math.PI);
}

export function deepWaterWaveSteepness(heightM: number, periodS: number): number | undefined {
  if (!(heightM > 0) || !(periodS > 0)) return undefined;
  const wavelengthM = (GRAVITY_MPS2 * periodS * periodS) / (2 * Math.PI);
  return heightM / wavelengthM;
}

function add(conditions: MarineCondition[], condition: MarineCondition, present: boolean): void {
  if (present) conditions.push(condition);
}

// This is an advisory classifier over model output, not a vessel-specific go or no-go decision.
// It intentionally reports only notable combinations so the chart remains sparse enough to read.
export function assessMarineConditions(readout: WeatherReadout): MarineCondition[] {
  const conditions: MarineCondition[] = [];
  const waveHeight = readout.waveHeightM;
  const wavePeriod = readout.wavePeriodS;
  const steepness =
    waveHeight !== undefined && wavePeriod !== undefined
      ? deepWaterWaveSteepness(waveHeight, wavePeriod)
      : undefined;

  add(
    conditions,
    {
      kind: 'very-steep-seas',
      severity: 'hazard',
      glyph: '≋',
      title: 'Very steep seas',
      summary:
        'Wave height is large for the modeled period, which can produce abrupt, breaking seas.',
    },
    waveHeight !== undefined && waveHeight >= MIN_WAVE_HEIGHT_M && (steepness ?? 0) >= 1 / 20,
  );
  add(
    conditions,
    {
      kind: 'steep-seas',
      severity: 'caution',
      glyph: '≈',
      title: 'Steep short-period seas',
      summary: 'Wave height is elevated for the modeled period, suggesting a sharper sea state.',
    },
    waveHeight !== undefined &&
      waveHeight >= MIN_WAVE_HEIGHT_M &&
      (steepness ?? 0) >= 1 / 30 &&
      (steepness ?? 0) < 1 / 20,
  );

  const currentSpeed = readout.currentSpeedMs;
  const currentDirection = readout.currentDirectionRad;
  const waveFrom = readout.waveFromRad;
  const waveCurrentAngle =
    waveFrom !== undefined && currentDirection !== undefined
      ? angleDifference(waveTravelDirection(waveFrom), currentDirection)
      : undefined;
  add(
    conditions,
    {
      kind: 'opposing-current',
      severity:
        (currentSpeed ?? 0) >= knotsToMetersPerSecond(1) || (steepness ?? 0) >= 1 / 30
          ? 'hazard'
          : 'caution',
      glyph: '⇆',
      title: 'Waves opposing current',
      summary: 'Modeled waves travel against the current, which can shorten and steepen the seas.',
    },
    waveHeight !== undefined &&
      waveHeight >= MIN_WAVE_HEIGHT_M &&
      (currentSpeed ?? 0) >= MIN_CURRENT_MPS &&
      (waveCurrentAngle ?? 0) >= (135 * Math.PI) / 180,
  );
  add(
    conditions,
    {
      kind: 'following-current',
      severity: 'context',
      glyph: '⇉',
      title: 'Waves following current',
      summary: 'Modeled waves and current travel together, which may lengthen the sea pattern.',
    },
    waveHeight !== undefined &&
      waveHeight >= MIN_WAVE_HEIGHT_M &&
      (currentSpeed ?? 0) >= MIN_CURRENT_MPS &&
      waveCurrentAngle !== undefined &&
      waveCurrentAngle <= Math.PI / 6,
  );

  const windWaveHeight = readout.windWaveHeightM;
  const swellHeight = readout.swellHeightM;
  const componentAngle =
    readout.windWaveFromRad !== undefined && readout.swellFromRad !== undefined
      ? angleDifference(readout.windWaveFromRad, readout.swellFromRad)
      : undefined;
  const componentWavesPresent =
    (windWaveHeight ?? 0) >= MIN_COMPONENT_HEIGHT_M && (swellHeight ?? 0) >= MIN_COMPONENT_HEIGHT_M;
  add(
    conditions,
    {
      kind: 'crossing-seas',
      severity: 'caution',
      glyph: '✕',
      title: 'Crossing seas',
      summary: 'Wind waves and swell cross at a broad angle, which can create confused motion.',
    },
    componentWavesPresent &&
      (componentAngle ?? 0) >= Math.PI / 4 &&
      (componentAngle ?? Math.PI) <= (3 * Math.PI) / 4,
  );
  add(
    conditions,
    {
      kind: 'reinforcing-seas',
      severity: 'context',
      glyph: '≫',
      title: 'Aligned wave trains',
      summary:
        'Wind waves and swell travel in a similar direction and can reinforce larger crests.',
    },
    componentWavesPresent && componentAngle !== undefined && componentAngle <= Math.PI / 6,
  );

  const gustSpread =
    readout.gustMs !== undefined ? readout.gustMs - readout.speedMs : Number.NEGATIVE_INFINITY;
  add(
    conditions,
    {
      kind: 'gusty-wind',
      severity: gustSpread >= knotsToMetersPerSecond(10) ? 'hazard' : 'caution',
      glyph: '↯',
      title: 'Gusty wind',
      summary: 'Forecast gusts are substantially stronger than sustained wind.',
    },
    readout.speedMs >= knotsToMetersPerSecond(5) &&
      gustSpread >= GUST_SPREAD_MPS &&
      (readout.gustMs ?? 0) >= readout.speedMs * 1.25,
  );

  return conditions.sort(
    (left, right) => SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity],
  );
}
