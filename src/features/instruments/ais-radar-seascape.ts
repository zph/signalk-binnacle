import type { Map as MapLibreMap } from 'maplibre-gl';
import type { LatLon } from '$shared/geo';
import { mapThemePaint } from '$shared/map';
import { geodesicDestination } from '$shared/nav';
import type { Theme } from '$shared/ui';
import type { AisRadarRangeNm } from './ais-radar-model';

const METERS_PER_NAUTICAL_MILE = 1852;
// The map element itself is inset to the radar's 176 px outer ring, so the range bounds belong at
// the map edge with no second padding inset.
export const AIS_RADAR_MAP_PADDING_PX = 0;

interface SeascapeLayer {
  id: string;
  type: string;
  'source-layer'?: string;
}

function styleLayers(map: MapLibreMap): SeascapeLayer[] {
  try {
    return (map.getStyle().layers ?? []) as SeascapeLayer[];
  } catch {
    return [];
  }
}

function setPaint(map: MapLibreMap, layerId: string, property: string, value: unknown): void {
  try {
    (map.setPaintProperty as unknown as (id: string, property: string, value: unknown) => void)(
      layerId,
      property,
      value,
    );
  } catch {
    // Published base styles can omit optional paint properties. The remaining flat geometry is
    // still useful, so one unsupported property must not remove the underlay.
  }
}

/**
 * Reduce the OpenFreeMap base to two flat surfaces: land and water. The water polygon's outline is
 * the coastline. Roads, buildings, labels, terrain, water names, and all other detail stay hidden.
 */
export function applyAisRadarSeascape(map: MapLibreMap, theme: Theme): void {
  const layers = styleLayers(map);
  const paint = mapThemePaint(theme);
  const hasWaterFill = layers.some(
    (layer) => layer.type === 'fill' && layer['source-layer'] === 'water',
  );

  for (const layer of layers) {
    const isBackground = layer.type === 'background';
    const isWater =
      layer['source-layer'] === 'water' && (layer.type === 'fill' || layer.type === 'line');
    try {
      map.setLayoutProperty(layer.id, 'visibility', isBackground || isWater ? 'visible' : 'none');
    } catch {
      // A style layer without visibility support is harmless and remains covered by the radar face.
    }

    if (isBackground) {
      // A real vector style draws water over a land-colored background. The offline fallback has
      // no geometry, so its single background reads as open water instead of falsely implying land.
      setPaint(map, layer.id, 'background-color', hasWaterFill ? paint.background : paint.water);
    } else if (layer.type === 'fill' && layer['source-layer'] === 'water') {
      setPaint(map, layer.id, 'fill-color', paint.water);
      setPaint(map, layer.id, 'fill-opacity', 1);
      setPaint(map, layer.id, 'fill-pattern', undefined);
      setPaint(map, layer.id, 'fill-outline-color', paint.boundary);
    } else if (layer.type === 'line' && layer['source-layer'] === 'water') {
      setPaint(map, layer.id, 'line-color', paint.boundary);
      setPaint(map, layer.id, 'line-opacity', 1);
      setPaint(map, layer.id, 'line-width', 1);
    }
  }
}

/** Geographic square surrounding the boat, unwrapped across the antimeridian for MapLibre. */
export function aisRadarBounds(
  position: LatLon,
  rangeNm: AisRadarRangeNm,
): [[number, number], [number, number]] {
  const radiusMeters = rangeNm * METERS_PER_NAUTICAL_MILE;
  const [, north] = geodesicDestination(position.latitude, position.longitude, 0, radiusMeters);
  const [east] = geodesicDestination(
    position.latitude,
    position.longitude,
    Math.PI / 2,
    radiusMeters,
  );
  const [, south] = geodesicDestination(
    position.latitude,
    position.longitude,
    Math.PI,
    radiusMeters,
  );
  const [west] = geodesicDestination(
    position.latitude,
    position.longitude,
    (3 * Math.PI) / 2,
    radiusMeters,
  );
  const unwrappedEast = east < west ? east + 360 : east;
  return [
    [west, south],
    [unwrappedEast, north],
  ];
}

/** Keep the radar's existing north-up geometry and fit the selected range inside its outer ring. */
export function fitAisRadarSeascape(
  map: MapLibreMap,
  position: LatLon,
  rangeNm: AisRadarRangeNm,
): void {
  map.setBearing(0);
  map.setPitch(0);
  map.fitBounds(aisRadarBounds(position, rangeNm), {
    padding: AIS_RADAR_MAP_PADDING_PX,
    duration: 0,
  });
}
