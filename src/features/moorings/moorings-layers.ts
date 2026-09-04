import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import {
  ensureGeoJsonSource,
  type MapThemePaint,
  removeLayersAndSources,
  rgbaCss,
} from '$shared/map';

export const MOORINGS_SOURCE_ID = 'binnacle-moorings';
export const MOORINGS_LAYER_ID = 'binnacle-moorings-points';
export const MOORINGS_LABEL_LAYER_ID = 'binnacle-moorings-labels';
export const MOORINGS_SELECTED_SOURCE_ID = 'binnacle-moorings-selected-source';
export const MOORINGS_SELECTED_LAYER_ID = 'binnacle-moorings-selected';
export const MOORINGS_LAYERS = [
  MOORINGS_SELECTED_LAYER_ID,
  MOORINGS_LAYER_ID,
  MOORINGS_LABEL_LAYER_ID,
];
export const MOORINGS_MIN_ZOOM = 9;

function occupancyColor(paint: MapThemePaint): ExpressionSpecification {
  return [
    'match',
    ['get', 'occupancy'],
    'likely-occupied',
    rgbaCss(paint.aisTarget),
    'possible',
    paint.warning,
    paint.note,
  ];
}

export function addMooringLayers(
  map: import('maplibre-gl').Map,
  paint: MapThemePaint,
  before: string | undefined,
): void {
  ensureGeoJsonSource(map, MOORINGS_SOURCE_ID);
  ensureGeoJsonSource(map, MOORINGS_SELECTED_SOURCE_ID);
  if (!map.getLayer(MOORINGS_SELECTED_LAYER_ID)) {
    const selected: CircleLayerSpecification = {
      id: MOORINGS_SELECTED_LAYER_ID,
      type: 'circle',
      source: MOORINGS_SELECTED_SOURCE_ID,
      minzoom: MOORINGS_MIN_ZOOM,
      paint: {
        'circle-radius': 13,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': paint.select,
        'circle-stroke-width': 3,
      },
    };
    map.addLayer(selected, before);
  }
  if (!map.getLayer(MOORINGS_LAYER_ID)) {
    const points: CircleLayerSpecification = {
      id: MOORINGS_LAYER_ID,
      type: 'circle',
      source: MOORINGS_SOURCE_ID,
      minzoom: MOORINGS_MIN_ZOOM,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 15, 8],
        'circle-color': occupancyColor(paint),
        'circle-stroke-color': paint.markerGlyph,
        'circle-stroke-width': 1.5,
        'circle-opacity': 0.9,
      },
    };
    map.addLayer(points, before);
  }
  if (!map.getLayer(MOORINGS_LABEL_LAYER_ID)) {
    const labels: SymbolLayerSpecification = {
      id: MOORINGS_LABEL_LAYER_ID,
      type: 'symbol',
      source: MOORINGS_SOURCE_ID,
      minzoom: 13,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-optional': true,
        'text-max-width': 9,
      },
      paint: {
        'text-color': paint.label,
        'text-halo-color': paint.background,
        'text-halo-width': 1.2,
      },
    };
    map.addLayer(labels, before);
  }
}

export function applyMooringTheme(map: import('maplibre-gl').Map, paint: MapThemePaint): void {
  if (map.getLayer(MOORINGS_SELECTED_LAYER_ID)) {
    map.setPaintProperty(MOORINGS_SELECTED_LAYER_ID, 'circle-stroke-color', paint.select);
  }
  if (map.getLayer(MOORINGS_LAYER_ID)) {
    map.setPaintProperty(MOORINGS_LAYER_ID, 'circle-color', occupancyColor(paint));
    map.setPaintProperty(MOORINGS_LAYER_ID, 'circle-stroke-color', paint.markerGlyph);
  }
  if (map.getLayer(MOORINGS_LABEL_LAYER_ID)) {
    map.setPaintProperty(MOORINGS_LABEL_LAYER_ID, 'text-color', paint.label);
    map.setPaintProperty(MOORINGS_LABEL_LAYER_ID, 'text-halo-color', paint.background);
  }
}

export function removeMooringLayers(map: import('maplibre-gl').Map): void {
  removeLayersAndSources(map, MOORINGS_LAYERS, [MOORINGS_SOURCE_ID, MOORINGS_SELECTED_SOURCE_ID]);
}
