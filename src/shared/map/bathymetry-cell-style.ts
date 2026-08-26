import type {
  ExpressionSpecification,
  FillLayerSpecification,
  LayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import type { Theme } from '$shared/ui';
import type { S57StyleOptions } from './s57-chart-style';

export const BATHYMETRY_THEME_PAINT_KEY = 'binnacle:bathymetryThemePaint';

export type BathymetryThemePaintRole = 'depth' | 'outline' | 'label' | 'labelHalo';
export type BathymetryThemePaintMap = Partial<
  Record<'fill-color' | 'line-color' | 'text-color' | 'text-halo-color', BathymetryThemePaintRole>
>;

type DepthStop = readonly [number, string];

const DEPTH_COLORS: Record<Theme, readonly string[]> = {
  day: ['#872d23', '#d22d23', '#f57823', '#f5d741', '#d8f3ff', '#84cbf4', '#3a8fe0', '#1246ab'],
  dusk: ['#5d201a', '#8f2d24', '#a94f20', '#9a7a24', '#294652', '#245b76', '#214f86', '#172f68'],
  'night-red': [
    '#ff6e00',
    '#dc4800',
    '#b93600',
    '#842400',
    '#561700',
    '#381000',
    '#260900',
    '#160400',
  ],
};

const SOLID_COLORS: Record<Theme, Record<Exclude<BathymetryThemePaintRole, 'depth'>, string>> = {
  day: { outline: '#183846', label: '#101820', labelHalo: '#ffffff' },
  dusk: { outline: '#bdd2dc', label: '#f1f4f5', labelHalo: '#081014' },
  'night-red': { outline: '#8a2900', label: '#ff6e00', labelHalo: '#080100' },
};

function safeDepth(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? (value ?? 3) : 3;
}

function depthStops(theme: Theme, safetyDepth: number | undefined): DepthStop[] {
  const safe = safeDepth(safetyDepth);
  const colors = DEPTH_COLORS[theme];
  return [
    [-1, colors[0]],
    [0, colors[1]],
    [safe * 0.5, colors[2]],
    [safe, colors[3]],
    [safe * 2, colors[4]],
    [safe * 4, colors[5]],
    [safe * 8, colors[6]],
    [Math.max(30, safe * 16), colors[7]],
  ];
}

function depthExpression(theme: Theme, safetyDepth: number | undefined): ExpressionSpecification {
  return [
    'interpolate',
    ['linear'],
    ['to-number', ['coalesce', ['get', 'BATHY_DEPTH_M'], ['get', 'DRVAL1']], -1],
    ...depthStops(theme, safetyDepth).flat(),
  ] as ExpressionSpecification;
}

export function bathymetryThemePaint(
  theme: Theme,
  role: BathymetryThemePaintRole,
  safetyDepth?: number,
): string | ExpressionSpecification {
  return role === 'depth' ? depthExpression(theme, safetyDepth) : SOLID_COLORS[theme][role];
}

function metadata(paint: BathymetryThemePaintMap): Record<string, BathymetryThemePaintMap> {
  return { [BATHYMETRY_THEME_PAINT_KEY]: paint };
}

function soundingValue(): ExpressionSpecification {
  return ['to-number', ['coalesce', ['get', 'BATHY_DEPTH_M'], ['get', 'DEPTH']], -9999];
}

function formattedDepth(unit: 'm' | 'ft' | 'fm'): ExpressionSpecification {
  const value = soundingValue();
  const converted: ExpressionSpecification =
    unit === 'ft' ? ['*', value, 3.28084] : unit === 'fm' ? ['/', value, 1.8288] : value;
  return ['number-format', converted, { 'max-fraction-digits': 1, 'min-fraction-digits': 0 }];
}

function depthLabel(fallback: 'm' | 'ft' | 'fm'): ExpressionSpecification {
  const meters = formattedDepth('m');
  const feet = formattedDepth('ft');
  const fathoms = formattedDepth('fm');
  const fallbackLabel = fallback === 'ft' ? feet : fallback === 'fm' ? fathoms : meters;
  return ['match', ['global-state', 'unit'], 'ft', feet, 'fm', fathoms, 'm', meters, fallbackLabel];
}

export function bathymetryCellLayers(
  sourceId: string,
  availableLayers: readonly string[],
  options: S57StyleOptions = {},
): LayerSpecification[] {
  const available = new Set(availableLayers.length > 0 ? availableLayers : ['DEPARE', 'SOUNDG']);
  const layers: LayerSpecification[] = [];

  if (available.has('DEPARE')) {
    const fill: FillLayerSpecification = {
      id: `${sourceId}-depare-bathymetry-fill`,
      type: 'fill',
      source: sourceId,
      'source-layer': 'DEPARE',
      paint: {
        'fill-color': bathymetryThemePaint('day', 'depth', options.safetyDepth),
        // Let chart detail remain visible beneath the measured cells while retaining clear depth color.
        'fill-opacity': 0.78,
      },
      metadata: metadata({ 'fill-color': 'depth' }),
    };
    const outline: LineLayerSpecification = {
      id: `${sourceId}-depare-bathymetry-outline`,
      type: 'line',
      source: sourceId,
      'source-layer': 'DEPARE',
      paint: {
        'line-color': bathymetryThemePaint('day', 'outline', options.safetyDepth),
        'line-opacity': 0.9,
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 20, 1.4],
      },
      metadata: metadata({ 'line-color': 'outline' }),
    };
    layers.push(fill, outline);
  }

  if (available.has('SOUNDG')) {
    const fallbackUnit = options.depthUnit ?? 'm';
    const labels: SymbolLayerSpecification = {
      id: `${sourceId}-soundg-bathymetry-label`,
      type: 'symbol',
      source: sourceId,
      'source-layer': 'SOUNDG',
      filter: ['any', ['has', 'BATHY_DEPTH_M'], ['has', 'DEPTH']],
      minzoom: 13,
      layout: {
        'text-field': depthLabel(fallbackUnit),
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 20, 12],
        'text-padding': 3,
      },
      paint: {
        'text-color': bathymetryThemePaint('day', 'label', options.safetyDepth),
        'text-halo-color': bathymetryThemePaint('day', 'labelHalo', options.safetyDepth),
        'text-halo-width': 1.25,
      },
      metadata: metadata({ 'text-color': 'label', 'text-halo-color': 'labelHalo' }),
    };
    layers.push(labels);
  }

  return layers;
}
