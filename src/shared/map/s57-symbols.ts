import type {
  ExpressionSpecification,
  FilterSpecification,
  Map as MapLibreMap,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { setMapImage } from './map-image';
import type { MapThemePaint } from './map-theme';
import { decodeSvgToImageData } from './svg-raster';

export const S57_SYMBOL_KINDS = [
  'lateral-buoy-port-red',
  'lateral-buoy-port-green',
  'lateral-buoy-port-neutral',
  'lateral-buoy-starboard-red',
  'lateral-buoy-starboard-green',
  'lateral-buoy-starboard-neutral',
  'lateral-buoy-unknown-red',
  'lateral-buoy-unknown-green',
  'lateral-buoy-unknown-neutral',
  'lateral-beacon-port-red',
  'lateral-beacon-port-green',
  'lateral-beacon-port-neutral',
  'lateral-beacon-starboard-red',
  'lateral-beacon-starboard-green',
  'lateral-beacon-starboard-neutral',
  'lateral-beacon-unknown-red',
  'lateral-beacon-unknown-green',
  'lateral-beacon-unknown-neutral',
  'safe-water-buoy',
  'safe-water-beacon',
  'special-buoy',
  'special-beacon',
  'light',
  'wreck',
  'rock',
  'obstruction',
] as const;

export type S57SymbolKind = (typeof S57_SYMBOL_KINDS)[number];

type S57Properties = Readonly<Record<string, unknown>>;
type LateralSide = 'port' | 'starboard' | 'unknown';
type MarkColor = 'red' | 'green' | 'neutral';

const ICON_PIXEL_RATIO = 2;
const ICON_CSS_PX = 36;
const ICON_RASTER_PX = ICON_CSS_PX * ICON_PIXEL_RATIO;
const POINT_FILTER = ['==', ['geometry-type'], 'Point'] as FilterSpecification;

interface SymbolLayerStyle {
  sourceLayer: string;
  minzoom: number;
  anchor: 'bottom' | 'center';
}

const SYMBOL_LAYER_STYLES: readonly SymbolLayerStyle[] = [
  { sourceLayer: 'WRECKS', minzoom: 10, anchor: 'center' },
  { sourceLayer: 'UWTROC', minzoom: 10, anchor: 'center' },
  { sourceLayer: 'OBSTRN', minzoom: 10, anchor: 'center' },
  { sourceLayer: 'BOYSPP', minzoom: 11, anchor: 'bottom' },
  { sourceLayer: 'BCNSPP', minzoom: 11, anchor: 'bottom' },
  { sourceLayer: 'BOYSAW', minzoom: 11, anchor: 'bottom' },
  { sourceLayer: 'BCNSAW', minzoom: 11, anchor: 'bottom' },
  { sourceLayer: 'BOYLAT', minzoom: 11, anchor: 'bottom' },
  { sourceLayer: 'BCNLAT', minzoom: 11, anchor: 'bottom' },
  { sourceLayer: 'LIGHTS', minzoom: 12, anchor: 'bottom' },
];

function numericValues(value: unknown): number[] {
  if (typeof value === 'number') return Number.isFinite(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(numericValues);
  if (typeof value !== 'string') return [];
  return [...value.matchAll(/-?\d+(?:\.\d+)?/g)]
    .map((match) => Number(match[0]))
    .filter(Number.isFinite);
}

function lateralSide(properties: S57Properties): LateralSide {
  const category = numericValues(properties.CATLAM)[0];
  if (category === 1 || category === 3) return 'port';
  if (category === 2 || category === 4) return 'starboard';
  return 'unknown';
}

function markColor(properties: S57Properties): MarkColor {
  const primaryColor = numericValues(properties.COLOUR)[0];
  if (primaryColor === 3) return 'red';
  if (primaryColor === 4) return 'green';
  return 'neutral';
}

export function s57SymbolClass(
  objectClass: string,
  properties: S57Properties = {},
): S57SymbolKind | undefined {
  const layer = objectClass.trim().toUpperCase();
  if (layer === 'BOYLAT') {
    return `lateral-buoy-${lateralSide(properties)}-${markColor(properties)}`;
  }
  if (layer === 'BCNLAT') {
    return `lateral-beacon-${lateralSide(properties)}-${markColor(properties)}`;
  }
  if (layer === 'BOYSAW') return 'safe-water-buoy';
  if (layer === 'BCNSAW') return 'safe-water-beacon';
  if (layer === 'BOYSPP') return 'special-buoy';
  if (layer === 'BCNSPP') return 'special-beacon';
  if (layer === 'LIGHTS') return 'light';
  if (layer === 'WRECKS') return 'wreck';
  if (layer === 'UWTROC') return 'rock';
  if (layer === 'OBSTRN') return 'obstruction';
  return undefined;
}

export function s57SymbolIconId(kind: S57SymbolKind): string {
  return `binnacle-s57-${kind}`;
}

function primaryColorIs(code: number): ExpressionSpecification {
  const value = ['to-string', ['coalesce', ['get', 'COLOUR'], '']] as ExpressionSpecification;
  return [
    'any',
    ['==', value, `${code}`],
    ['==', ['slice', value, 0, 4], `["${code}"`],
    ['==', ['slice', value, 0, 2], `[${code}`],
  ] as ExpressionSpecification;
}

function lateralColorExpression(kind: 'buoy' | 'beacon', side: LateralSide) {
  return [
    'case',
    primaryColorIs(3),
    s57SymbolIconId(`lateral-${kind}-${side}-red`),
    primaryColorIs(4),
    s57SymbolIconId(`lateral-${kind}-${side}-green`),
    s57SymbolIconId(`lateral-${kind}-${side}-neutral`),
  ] as ExpressionSpecification;
}

function lateralIconExpression(kind: 'buoy' | 'beacon'): ExpressionSpecification {
  return [
    'match',
    ['to-string', ['coalesce', ['get', 'CATLAM'], '']],
    ['1', '3'],
    lateralColorExpression(kind, 'port'),
    ['2', '4'],
    lateralColorExpression(kind, 'starboard'),
    lateralColorExpression(kind, 'unknown'),
  ] as ExpressionSpecification;
}

export function s57SymbolIconExpression(
  objectClass: string,
): ExpressionSpecification | string | undefined {
  const layer = objectClass.trim().toUpperCase();
  if (layer === 'BOYLAT') return lateralIconExpression('buoy');
  if (layer === 'BCNLAT') return lateralIconExpression('beacon');
  const kind = s57SymbolClass(layer);
  return kind === undefined ? undefined : s57SymbolIconId(kind);
}

export function s57SymbolLayers(
  sourceId: string,
  available: readonly string[],
): SymbolLayerSpecification[] {
  const present =
    available.length === 0
      ? new Set(SYMBOL_LAYER_STYLES.map(({ sourceLayer }) => sourceLayer))
      : new Set(available.map((sourceLayer) => sourceLayer.toUpperCase()));

  return SYMBOL_LAYER_STYLES.flatMap(({ sourceLayer, minzoom, anchor }) => {
    if (!present.has(sourceLayer)) return [];
    const iconImage = s57SymbolIconExpression(sourceLayer);
    if (iconImage === undefined) return [];
    return [
      {
        id: `${sourceId}-s57-symbol-${sourceLayer.toLowerCase()}`,
        type: 'symbol',
        source: sourceId,
        'source-layer': sourceLayer,
        minzoom,
        filter: POINT_FILTER,
        layout: {
          'icon-image': iconImage,
          'icon-size': ['interpolate', ['linear'], ['zoom'], minzoom, 0.72, 15, 1],
          'icon-anchor': anchor,
          'icon-allow-overlap': false,
          'icon-ignore-placement': false,
          'icon-optional': false,
        },
      },
    ];
  });
}

function buoySvg(kind: S57SymbolKind, paint: MapThemePaint): string {
  const outline = paint.label;
  const stem = `<path d="M18 29v4M12 33h12" stroke="${outline}"/>`;
  if (kind.startsWith('lateral-buoy-')) {
    const fill = lateralFill(kind, paint);
    if (kind.includes('-port-')) {
      return `<path d="M12 13h12v16H12z" fill="${fill}" stroke="${outline}"/>${stem}`;
    }
    if (kind.includes('-starboard-')) {
      return `<path d="m18 10 7 19H11z" fill="${fill}" stroke="${outline}"/>${stem}`;
    }
    return `<circle cx="18" cy="20" r="8" fill="${fill}" stroke="${outline}"/>${stem}`;
  }
  if (kind === 'safe-water-buoy') {
    return [
      `<circle cx="18" cy="7" r="4" fill="${paint.navStarboard}" stroke="${outline}"/>`,
      `<path d="M11 13h14l-2 16H13z" fill="${paint.markerGlyph}" stroke="${outline}"/>`,
      `<path d="M15 13h6v16h-6z" fill="${paint.navStarboard}"/>`,
      stem,
    ].join('');
  }
  if (kind === 'special-buoy') {
    return [
      `<path d="m14 5 8 8m0-8-8 8" stroke="${outline}"/>`,
      `<path d="M11 14h14l-2 15H13z" fill="${paint.warning}" stroke="${outline}"/>`,
      stem,
    ].join('');
  }
  return `<circle cx="18" cy="20" r="8" fill="${paint.warning}" stroke="${outline}"/>${stem}`;
}

function beaconSvg(kind: S57SymbolKind, paint: MapThemePaint): string {
  const outline = paint.label;
  const post = `<path d="M18 14v19M12 33h12" stroke="${outline}"/>`;
  if (kind.startsWith('lateral-beacon-')) {
    const fill = lateralFill(kind, paint);
    if (kind.includes('-port-')) {
      return `<path d="M11 7h14v12H11z" fill="${fill}" stroke="${outline}"/>${post}`;
    }
    if (kind.includes('-starboard-')) {
      return `<path d="m18 5 8 14H10z" fill="${fill}" stroke="${outline}"/>${post}`;
    }
    return `<path d="m18 6 7 12H11z" fill="${fill}" stroke="${outline}"/>${post}`;
  }
  if (kind === 'safe-water-beacon') {
    return [
      `<circle cx="18" cy="6" r="4" fill="${paint.navStarboard}" stroke="${outline}"/>`,
      `<path d="M11 11h14v11H11z" fill="${paint.markerGlyph}" stroke="${outline}"/>`,
      `<path d="M15 11h6v11h-6z" fill="${paint.navStarboard}"/>`,
      post,
    ].join('');
  }
  if (kind === 'special-beacon') {
    return [
      `<path d="m14 4 8 8m0-8-8 8" stroke="${outline}"/>`,
      `<path d="M11 13h14v11H11z" fill="${paint.warning}" stroke="${outline}"/>`,
      post,
    ].join('');
  }
  return `<path d="m18 6 7 12H11z" fill="${paint.warning}" stroke="${outline}"/>${post}`;
}

function lateralFill(kind: S57SymbolKind, paint: MapThemePaint): string {
  if (kind.endsWith('-red')) return paint.navStarboard;
  if (kind.endsWith('-green')) return paint.navPort;
  return paint.markerGlyph;
}

function hazardSvg(kind: S57SymbolKind, paint: MapThemePaint): string {
  const outline = paint.label;
  if (kind === 'light') {
    return [
      `<circle cx="18" cy="20" r="3" fill="${paint.navLight}"/>`,
      `<path d="M18 15V3M23 16l8-8M25 21h9" stroke="${paint.navLight}"/>`,
      `<path d="M18 23v10" stroke="${outline}"/>`,
    ].join('');
  }
  if (kind === 'wreck') {
    return [
      `<path d="M8 13h20l-4 13H12zM10 29c3-2 5-2 8 0s5 2 8 0" stroke="${paint.danger}"/>`,
      `<path d="m12 9 12 14m0-14L12 23" stroke="${outline}"/>`,
    ].join('');
  }
  if (kind === 'rock') {
    return [
      `<circle cx="18" cy="18" r="9" fill="none" stroke="${paint.danger}" stroke-dasharray="2 2"/>`,
      `<path d="M18 6v24M6 18h24m-20-8 20 20m0-20L10 30" stroke="${paint.danger}"/>`,
    ].join('');
  }
  return [
    `<circle cx="18" cy="18" r="11" fill="none" stroke="${paint.danger}" stroke-dasharray="2 3"/>`,
    `<path d="m12 12 12 12m0-12L12 24" stroke="${paint.danger}"/>`,
    `<circle cx="18" cy="18" r="3" fill="${paint.danger}"/>`,
  ].join('');
}

export function s57SymbolSvg(kind: S57SymbolKind, paint: MapThemePaint): string {
  let body: string;
  if (kind.includes('buoy')) body = buoySvg(kind, paint);
  else if (kind.includes('beacon')) body = beaconSvg(kind, paint);
  else body = hazardSvg(kind, paint);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_CSS_PX}" height="${ICON_CSS_PX}" viewBox="0 0 36 36" fill="none">`,
    `<g stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</g>`,
    '</svg>',
  ].join('');
}

async function rasterizeS57Symbol(
  kind: S57SymbolKind,
  paint: MapThemePaint,
): Promise<ImageData | null> {
  return decodeSvgToImageData(s57SymbolSvg(kind, paint), (image, context) => {
    context.canvas.width = ICON_RASTER_PX;
    context.canvas.height = ICON_RASTER_PX;
    context.drawImage(image, 0, 0, ICON_RASTER_PX, ICON_RASTER_PX);
    return context.getImageData(0, 0, ICON_RASTER_PX, ICON_RASTER_PX);
  });
}

export async function registerS57Symbols(
  map: MapLibreMap,
  paint: MapThemePaint,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  await Promise.all(
    S57_SYMBOL_KINDS.map(async (kind) => {
      const image = await rasterizeS57Symbol(kind, paint);
      if (!image || !isCurrent()) return;
      setMapImage(map, s57SymbolIconId(kind), image, ICON_PIXEL_RATIO);
    }),
  );
}
