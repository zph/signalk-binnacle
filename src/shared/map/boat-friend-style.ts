import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  LayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { S57_THEME_PAINT_KEY, type S57ThemePaintMap, s57ThemeColor } from './s57-chart-style';

const SOURCE_LAYER = 'BOAT_FRIEND';
const STALE_OPACITY: ExpressionSpecification = [
  'case',
  ['boolean', ['get', 'BOAT_FRIEND_STALE'], false],
  0.3,
  1,
];

function metadata(paint: S57ThemePaintMap): Record<string, S57ThemePaintMap> {
  return { [S57_THEME_PAINT_KEY]: paint };
}

export function boatFriendLayers(sourceId: string): LayerSpecification[] {
  const positions: CircleLayerSpecification = {
    id: `${sourceId}-boat-friend-position`,
    type: 'circle',
    source: sourceId,
    'source-layer': SOURCE_LAYER,
    paint: {
      'circle-color': s57ThemeColor('day', 'anchorage'),
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 4, 8, 7, 14, 9],
      'circle-stroke-color': s57ThemeColor('day', 'label'),
      'circle-stroke-width': 1.5,
      'circle-opacity': STALE_OPACITY,
      'circle-stroke-opacity': STALE_OPACITY,
    },
    metadata: metadata({ 'circle-color': 'anchorage', 'circle-stroke-color': 'label' }),
  };
  const labels: SymbolLayerSpecification = {
    id: `${sourceId}-boat-friend-label`,
    type: 'symbol',
    source: sourceId,
    'source-layer': SOURCE_LAYER,
    minzoom: 2,
    layout: {
      'text-field': [
        'to-string',
        ['coalesce', ['get', 'BOAT_FRIEND_NAME'], ['get', 'MMSI'], 'Boat friend'],
      ],
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 10, 13],
      'text-offset': [0, 1.15],
      'text-padding': 4,
      'text-optional': true,
    },
    paint: {
      'text-color': s57ThemeColor('day', 'label'),
      'text-halo-color': s57ThemeColor('day', 'depthDeep'),
      'text-halo-width': 1.2,
      'text-opacity': STALE_OPACITY,
    },
    metadata: metadata({ 'text-color': 'label', 'text-halo-color': 'depthDeep' }),
  };
  return [positions, labels];
}
