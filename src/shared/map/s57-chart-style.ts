import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  FillLayerSpecification,
  FilterSpecification,
  LayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import type { Theme } from '$shared/ui';

export const S57_THEME_PAINT_KEY = 'binnacle:s57ThemePaint';
export const DEFAULT_S57_SAFETY_DEPTH_METERS = 3;

type S57DepthUnit = 'm' | 'ft' | 'fm';

export type S57ThemeColorKey =
  | 'anchorage'
  | 'coastline'
  | 'contour'
  | 'danger'
  | 'depthDeep'
  | 'depthSafe'
  | 'depthShallow'
  | 'dredged'
  | 'drying'
  | 'label'
  | 'land'
  | 'navLight'
  | 'navPort'
  | 'navStarboard'
  | 'navaid'
  | 'restricted'
  | 'safetyContour';

type S57ThemePaintProperty =
  | 'circle-color'
  | 'circle-stroke-color'
  | 'fill-color'
  | 'line-color'
  | 'text-color'
  | 'text-halo-color';

export type S57ThemePaintMap = Partial<Record<S57ThemePaintProperty, S57ThemeColorKey>>;

export interface S57StyleOptions {
  safetyDepth?: number;
  depthUnit?: S57DepthUnit;
}

const THEME_COLORS: Record<Theme, Record<S57ThemeColorKey, string>> = {
  day: {
    anchorage: '#2563a6',
    coastline: '#3d4b50',
    contour: '#567a89',
    danger: '#c7271e',
    depthDeep: '#ecf5f7',
    depthSafe: '#c7e3ed',
    depthShallow: '#9bcddd',
    dredged: '#d5e9ec',
    drying: '#d9d4aa',
    label: '#17242c',
    land: '#e7dfc5',
    navLight: '#c026d3',
    navPort: '#1f9e54',
    navStarboard: '#d8392f',
    navaid: '#263238',
    restricted: '#a82bb8',
    safetyContour: '#b02f24',
  },
  dusk: {
    anchorage: '#4f8fc0',
    coastline: '#9ba5a5',
    contour: '#637a80',
    danger: '#e0703a',
    depthDeep: '#17242a',
    depthSafe: '#17313b',
    depthShallow: '#194451',
    dredged: '#183740',
    drying: '#3a3523',
    label: '#d8dde0',
    land: '#2a2721',
    navLight: '#cf5bd9',
    navPort: '#3fae6a',
    navStarboard: '#e0573f',
    navaid: '#b4b7b8',
    restricted: '#d45bdf',
    safetyContour: '#e0703a',
  },
  'night-red': {
    anchorage: '#9a3100',
    coastline: '#7a2500',
    contour: '#5a1800',
    danger: '#ff6e00',
    depthDeep: '#080100',
    depthSafe: '#120300',
    depthShallow: '#220600',
    dredged: '#180400',
    drying: '#2d0a00',
    label: '#c85a00',
    land: '#140400',
    navLight: '#c05200',
    navPort: '#8e2c00',
    navStarboard: '#ff6e00',
    navaid: '#b03b00',
    restricted: '#c24c00',
    safetyContour: '#ff6e00',
  },
};

const LABEL_TEXT_FONT = ['Noto Sans Regular'];
const LABEL_TEXT_SIZE: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  10,
  9,
  15,
  13,
];
const POINT_FILTER: FilterSpecification = ['==', ['geometry-type'], 'Point'];
const AREA_FILTER: FilterSpecification = ['==', ['geometry-type'], 'Polygon'];
const LINE_OR_AREA_FILTER: FilterSpecification = [
  'in',
  ['geometry-type'],
  ['literal', ['LineString', 'Polygon']],
];

const RESTRICTED_AREAS = ['RESARE', 'MIPARE', 'CTNARE'] as const;
const ANCHORAGE_AREAS = ['ACHARE'] as const;
const HAZARDS = [
  ['WRECKS', 'Wk'],
  ['UWTROC', 'Rk'],
  ['OBSTRN', 'Ob'],
  ['FOULGND', 'Foul'],
] as const;
const LATERAL_MARKS = ['BOYLAT', 'BCNLAT'] as const;
const GENERAL_MARKS = [
  'BOYCAR',
  'BOYISD',
  'BOYSAW',
  'BOYSPP',
  'BCNCAR',
  'BCNISD',
  'BCNSAW',
  'BCNSPP',
  'DAYMAR',
  'LNDMRK',
] as const;
const SYMBOLIZED_POINT_LAYERS = new Set([
  'WRECKS',
  'UWTROC',
  'OBSTRN',
  'BOYSPP',
  'BCNSPP',
  'BOYSAW',
  'BCNSAW',
  'BOYLAT',
  'BCNLAT',
  'LIGHTS',
]);

export const S57_SUPPORTED_SOURCE_LAYERS = [
  'DEPARE',
  'DRGARE',
  ...ANCHORAGE_AREAS,
  ...RESTRICTED_AREAS,
  'FAIRWY',
  'CANALS',
  'TSSLPT',
  'TSSBND',
  'TSEZNE',
  'UNSARE',
  'LNDARE',
  'COALNE',
  'SLCONS',
  'NAVLNE',
  'CBLSUB',
  'PIPSOL',
  'BRIDGE',
  'DEPCNT',
  'SOUNDG',
  ...HAZARDS.map(([sourceLayer]) => sourceLayer),
  ...LATERAL_MARKS,
  ...GENERAL_MARKS,
  'LIGHTS',
] as const;

export function s57ThemeColor(theme: Theme, key: S57ThemeColorKey): string {
  return THEME_COLORS[theme][key];
}

function metadata(paint: S57ThemePaintMap): Record<string, S57ThemePaintMap> {
  return { [S57_THEME_PAINT_KEY]: paint };
}

function depthValue(attribute: 'DRVAL1' | 'DRVAL2' | 'VALDCO' | 'VALSOU'): ExpressionSpecification {
  return ['to-number', ['get', attribute], -9999];
}

function soundingValue(): ExpressionSpecification {
  return ['to-number', ['coalesce', ['get', 'DEPTH'], ['get', 'VALSOU']], -9999];
}

function depthLabel(unit: S57DepthUnit): ExpressionSpecification {
  const value = soundingValue();
  const converted: ExpressionSpecification =
    unit === 'ft' ? ['*', value, 3.28084] : unit === 'fm' ? ['/', value, 1.8288] : value;
  return [
    'concat',
    ['number-format', converted, { 'max-fraction-digits': 1, 'min-fraction-digits': 0 }],
    unit,
  ];
}

function fillLayer(
  sourceId: string,
  sourceLayer: string,
  suffix: string,
  color: S57ThemeColorKey,
  filter?: FilterSpecification,
  opacity = 1,
): FillLayerSpecification {
  return {
    id: `${sourceId}-${sourceLayer.toLowerCase()}-${suffix}`,
    type: 'fill',
    source: sourceId,
    'source-layer': sourceLayer,
    ...(filter ? { filter } : {}),
    paint: {
      'fill-color': s57ThemeColor('day', color),
      'fill-opacity': opacity,
    },
    metadata: metadata({ 'fill-color': color }),
  };
}

function lineLayer(
  sourceId: string,
  sourceLayer: string,
  suffix: string,
  color: S57ThemeColorKey,
  width: number,
  filter?: FilterSpecification,
  dasharray?: [number, number],
  opacity = 1,
): LineLayerSpecification {
  return {
    id: `${sourceId}-${sourceLayer.toLowerCase()}-${suffix}`,
    type: 'line',
    source: sourceId,
    'source-layer': sourceLayer,
    ...(filter ? { filter } : {}),
    paint: {
      'line-color': s57ThemeColor('day', color),
      'line-width': width,
      ...(dasharray ? { 'line-dasharray': dasharray } : {}),
      ...(opacity < 1 ? { 'line-opacity': opacity } : {}),
    },
    metadata: metadata({ 'line-color': color }),
  };
}

function circleLayer(
  sourceId: string,
  sourceLayer: string,
  suffix: string,
  color: S57ThemeColorKey,
  radius: number,
  filter: FilterSpecification = POINT_FILTER,
): CircleLayerSpecification {
  return {
    id: `${sourceId}-${sourceLayer.toLowerCase()}-${suffix}`,
    type: 'circle',
    source: sourceId,
    'source-layer': sourceLayer,
    filter,
    minzoom: 10,
    paint: {
      'circle-color': s57ThemeColor('day', color),
      'circle-radius': radius,
      'circle-stroke-color': s57ThemeColor('day', 'label'),
      'circle-stroke-width': 1.2,
    },
    metadata: metadata({ 'circle-color': color, 'circle-stroke-color': 'label' }),
  };
}

function labelLayer(
  sourceId: string,
  sourceLayer: string,
  suffix: string,
  color: S57ThemeColorKey,
  text: string | ExpressionSpecification,
  filter?: FilterSpecification,
  minzoom = 12,
): SymbolLayerSpecification {
  return {
    id: `${sourceId}-${sourceLayer.toLowerCase()}-${suffix}`,
    type: 'symbol',
    source: sourceId,
    'source-layer': sourceLayer,
    ...(filter ? { filter } : {}),
    minzoom,
    layout: {
      'text-field': text,
      'text-font': LABEL_TEXT_FONT,
      'text-size': LABEL_TEXT_SIZE,
      'text-offset': [0, 1.1],
      'text-padding': 3,
    },
    paint: {
      'text-color': s57ThemeColor('day', color),
      'text-halo-color': s57ThemeColor('day', 'depthDeep'),
      'text-halo-width': 1,
    },
    metadata: metadata({ 'text-color': color, 'text-halo-color': 'depthDeep' }),
  };
}

function lineLabelLayer(
  sourceId: string,
  sourceLayer: string,
  color: S57ThemeColorKey,
  fallback: string,
): SymbolLayerSpecification {
  return {
    id: `${sourceId}-${sourceLayer.toLowerCase()}-label`,
    type: 'symbol',
    source: sourceId,
    'source-layer': sourceLayer,
    minzoom: 12,
    layout: {
      'symbol-placement': 'line',
      'text-field': ['to-string', ['coalesce', ['get', 'OBJNAM'], fallback]],
      'text-font': LABEL_TEXT_FONT,
      'text-size': LABEL_TEXT_SIZE,
      'text-max-angle': 30,
      'text-padding': 80,
    },
    paint: {
      'text-color': s57ThemeColor('day', color),
      'text-halo-color': s57ThemeColor('day', 'depthDeep'),
      'text-halo-width': 1,
    },
    metadata: metadata({ 'text-color': color, 'text-halo-color': 'depthDeep' }),
  };
}

function areaLayers(
  layers: LayerSpecification[],
  sourceId: string,
  available: Set<string>,
  sourceLayers: readonly string[],
  color: 'anchorage' | 'restricted',
  fillOpacity = 0.14,
): void {
  for (const sourceLayer of sourceLayers) {
    if (!available.has(sourceLayer)) continue;
    // Regulated-area polygons frequently overlap (and some ENC cells repeat them at several
    // compilation scales). Omitting a zero-opacity fill, rather than merely making it transparent,
    // prevents those polygons from stacking into a solid wash and avoids needless fill work.
    if (fillOpacity > 0) {
      layers.push(fillLayer(sourceId, sourceLayer, 'fill', color, AREA_FILTER, fillOpacity));
    } else if (color === 'restricted') {
      // A soft boundary halo conveys that the polygon has an interior without washing the entire
      // chart in magenta. It is deliberately theme-colored vector linework rather than a bitmap
      // dot pattern, so it stays sharp and rethemes cleanly at every zoom.
      layers.push(
        lineLayer(sourceId, sourceLayer, 'edge-shade', color, 8, undefined, undefined, 0.09),
      );
    }
    layers.push(lineLayer(sourceId, sourceLayer, 'outline', color, 1.3, undefined, [4, 3]));
    layers.push(
      labelLayer(
        sourceId,
        sourceLayer,
        'label',
        color,
        ['to-string', ['coalesce', ['get', 'OBJNAM'], '']],
        undefined,
        11,
      ),
    );
  }
}

function hazardLayers(
  layers: LayerSpecification[],
  sourceId: string,
  available: Set<string>,
): void {
  for (const [sourceLayer, abbreviation] of HAZARDS) {
    if (!available.has(sourceLayer)) continue;
    layers.push(fillLayer(sourceId, sourceLayer, 'area', 'danger', AREA_FILTER, 0.18));
    layers.push(
      lineLayer(sourceId, sourceLayer, 'outline', 'danger', 1.6, LINE_OR_AREA_FILTER, [2, 2]),
    );
    if (SYMBOLIZED_POINT_LAYERS.has(sourceLayer)) {
      layers.push(
        labelLayer(
          sourceId,
          sourceLayer,
          'label',
          'danger',
          ['to-string', ['coalesce', ['get', 'OBJNAM'], '']],
          POINT_FILTER,
          11,
        ),
      );
    } else {
      layers.push(circleLayer(sourceId, sourceLayer, 'point', 'danger', 5.5));
      layers.push(
        labelLayer(sourceId, sourceLayer, 'mark', 'danger', abbreviation, POINT_FILTER, 11),
      );
    }
  }
}

function lateralMarkLayers(
  layers: LayerSpecification[],
  sourceId: string,
  available: Set<string>,
): void {
  for (const sourceLayer of LATERAL_MARKS) {
    if (!available.has(sourceLayer)) continue;
    layers.push(
      labelLayer(
        sourceId,
        sourceLayer,
        'label',
        'label',
        ['to-string', ['coalesce', ['get', 'OBJNAM'], '']],
        POINT_FILTER,
      ),
    );
  }
}

function generalMarkLayers(
  layers: LayerSpecification[],
  sourceId: string,
  available: Set<string>,
): void {
  for (const sourceLayer of GENERAL_MARKS) {
    if (!available.has(sourceLayer)) continue;
    if (!SYMBOLIZED_POINT_LAYERS.has(sourceLayer)) {
      layers.push(circleLayer(sourceId, sourceLayer, 'mark', 'navaid', 4.5));
    }
    layers.push(
      labelLayer(
        sourceId,
        sourceLayer,
        'label',
        'label',
        ['to-string', ['coalesce', ['get', 'OBJNAM'], '']],
        POINT_FILTER,
      ),
    );
  }

  if (available.has('LIGHTS')) {
    layers.push(
      labelLayer(
        sourceId,
        'LIGHTS',
        'label',
        'navLight',
        ['to-string', ['coalesce', ['get', 'OBJNAM'], ['get', 'SIGGRP'], '']],
        POINT_FILTER,
      ),
    );
  }
}

function routeAndInfrastructureLayers(
  layers: LayerSpecification[],
  sourceId: string,
  available: Set<string>,
): void {
  areaLayers(layers, sourceId, available, ['FAIRWY', 'TSSLPT'], 'anchorage');
  areaLayers(layers, sourceId, available, ['TSEZNE'], 'restricted', 0);

  if (available.has('CANALS')) {
    layers.push(fillLayer(sourceId, 'CANALS', 'fill', 'depthSafe', AREA_FILTER, 0.7));
    layers.push(lineLayer(sourceId, 'CANALS', 'outline', 'anchorage', 1.4));
    layers.push(
      labelLayer(
        sourceId,
        'CANALS',
        'label',
        'anchorage',
        ['to-string', ['coalesce', ['get', 'OBJNAM'], 'Canal']],
        undefined,
        11,
      ),
    );
  }

  if (available.has('UNSARE')) {
    layers.push(fillLayer(sourceId, 'UNSARE', 'fill', 'danger', AREA_FILTER, 0.16));
    layers.push(lineLayer(sourceId, 'UNSARE', 'outline', 'danger', 1.5, undefined, [3, 2]));
    layers.push(labelLayer(sourceId, 'UNSARE', 'label', 'danger', 'Unsurveyed', undefined, 10));
  }

  const lineFeatures = [
    ['NAVLNE', 'anchorage', 1.6, undefined, 'Navigation line'],
    ['TSSBND', 'restricted', 1.4, [5, 3], 'Traffic separation boundary'],
    ['CBLSUB', 'restricted', 1, [3, 3], 'Submarine cable'],
    ['PIPSOL', 'restricted', 1, [3, 3], 'Submarine pipeline'],
    ['BRIDGE', 'coastline', 2, undefined, 'Bridge'],
  ] as const;
  for (const [sourceLayer, color, width, dasharray, fallback] of lineFeatures) {
    if (!available.has(sourceLayer)) continue;
    layers.push(
      lineLayer(
        sourceId,
        sourceLayer,
        'line',
        color,
        width,
        undefined,
        dasharray ? [dasharray[0], dasharray[1]] : undefined,
      ),
    );
    layers.push(lineLabelLayer(sourceId, sourceLayer, color, fallback));
  }
}

export function s57ChartLayers(
  sourceId: string,
  availableLayers: readonly string[],
  options: S57StyleOptions = {},
): LayerSpecification[] {
  const available = new Set(
    availableLayers.length === 0 ? S57_SUPPORTED_SOURCE_LAYERS : availableLayers,
  );
  const safetyDepth =
    Number.isFinite(options.safetyDepth) && (options.safetyDepth ?? 0) >= 0
      ? (options.safetyDepth ?? DEFAULT_S57_SAFETY_DEPTH_METERS)
      : DEFAULT_S57_SAFETY_DEPTH_METERS;
  const depthUnit = options.depthUnit ?? 'm';
  const deepDepth = Math.max(10, safetyDepth * 2);
  const layers: LayerSpecification[] = [];

  if (available.has('DEPARE')) {
    const minimum = depthValue('DRVAL1');
    const maximum = depthValue('DRVAL2');
    layers.push(
      fillLayer(sourceId, 'DEPARE', 'deep', 'depthDeep', ['>=', minimum, deepDepth]),
      fillLayer(sourceId, 'DEPARE', 'safe', 'depthSafe', [
        'all',
        ['>=', minimum, safetyDepth],
        ['<', minimum, deepDepth],
      ]),
      fillLayer(sourceId, 'DEPARE', 'shallow', 'depthShallow', [
        'all',
        ['<', minimum, safetyDepth],
        ['>', maximum, 0],
      ]),
      fillLayer(sourceId, 'DEPARE', 'drying', 'drying', [
        'all',
        ['has', 'DRVAL2'],
        ['<=', maximum, 0],
      ]),
    );
  }

  if (available.has('DRGARE')) {
    layers.push(fillLayer(sourceId, 'DRGARE', 'fill', 'dredged', AREA_FILTER, 0.9));
    layers.push(lineLayer(sourceId, 'DRGARE', 'outline', 'contour', 1.2, undefined, [3, 2]));
  }

  areaLayers(layers, sourceId, available, ANCHORAGE_AREAS, 'anchorage');
  areaLayers(layers, sourceId, available, RESTRICTED_AREAS, 'restricted', 0);
  routeAndInfrastructureLayers(layers, sourceId, available);

  if (available.has('LNDARE')) {
    // Keep ENC land transparent so the richer OpenMap land style (roads, buildings, and labels)
    // remains visible. The ENC boundary stays authoritative through LNDARE/COALNE/SLCONS linework.
    // Regulated areas above are outline-only, so removing this former land mask cannot tint inland
    // portions of a broad restricted polygon.
    layers.push(lineLayer(sourceId, 'LNDARE', 'outline', 'coastline', 1));
  }
  if (available.has('COALNE')) {
    layers.push(lineLayer(sourceId, 'COALNE', 'line', 'coastline', 1.4));
  }
  if (available.has('SLCONS')) {
    layers.push(lineLayer(sourceId, 'SLCONS', 'line', 'coastline', 1.1));
  }

  if (available.has('DEPCNT')) {
    const contour = depthValue('VALDCO');
    layers.push(lineLayer(sourceId, 'DEPCNT', 'line', 'contour', 0.8));
    layers.push(
      lineLayer(sourceId, 'DEPCNT', 'safety', 'safetyContour', 2.4, [
        'all',
        ['>=', contour, safetyDepth],
        ['<', contour, safetyDepth + 3],
      ]),
    );
  }

  if (available.has('SOUNDG')) {
    const sounding = soundingValue();
    layers.push(
      labelLayer(
        sourceId,
        'SOUNDG',
        'safe',
        'label',
        depthLabel(depthUnit),
        ['all', ['any', ['has', 'DEPTH'], ['has', 'VALSOU']], ['>=', sounding, safetyDepth]],
        12,
      ),
      labelLayer(
        sourceId,
        'SOUNDG',
        'shallow',
        'danger',
        depthLabel(depthUnit),
        ['all', ['any', ['has', 'DEPTH'], ['has', 'VALSOU']], ['<', sounding, safetyDepth]],
        12,
      ),
    );
  }

  hazardLayers(layers, sourceId, available);
  lateralMarkLayers(layers, sourceId, available);
  generalMarkLayers(layers, sourceId, available);
  return layers;
}
