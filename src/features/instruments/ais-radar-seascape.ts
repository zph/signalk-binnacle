import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import type { LatLon } from '$shared/geo';
import { mapThemePaint } from '$shared/map';
import {
  createPositionRenderGate,
  geodesicDestination,
  POSITION_RENDER_DEADBAND_METERS,
  type PositionRenderGate,
} from '$shared/nav';
import type { Theme } from '$shared/ui';
import type { AisRadarRangeNm } from './ais-radar-model';

const METERS_PER_NAUTICAL_MILE = 1852;
// The map element itself is inset to the radar's 176 px outer ring, so the range bounds belong at
// the map edge with no second padding inset.
export const AIS_RADAR_MAP_PADDING_PX = 0;
export const AIS_RADAR_POSITION_MAX_INTERVAL_MS = 5_000;
export const AIS_RADAR_LAYOUT_REFIT_DELAY_MS = 150;
const AIS_RADAR_FALLBACK_DIAMETER_PX = 400;
const AIS_RADAR_SCALE_REFIT_DRIFT_PX = 1;
const MAX_MERCATOR_LATITUDE = 85.051_129;

interface RefitScheduler {
  request(callback: () => void, delayMs: number): number | undefined;
  cancel(id: number): void;
}

interface AisRadarCameraController {
  sync(position: LatLon, rangeNm: AisRadarRangeNm, diameterPx: number): void;
  destroy(): void;
}

const defaultRefitScheduler: RefitScheduler = {
  request(callback, delayMs) {
    if (typeof window === 'undefined') return undefined;
    return window.setTimeout(callback, delayMs);
  },
  cancel(id) {
    if (typeof window !== 'undefined') window.clearTimeout(id);
  },
};

/**
 * Build the smallest useful Chart Locker style for the radar. Loading the complete basemap and
 * hiding its other layers after `load` leaves two expanded-radar map surfaces competing to rebuild
 * a style they do not use. Starting with only background and water also makes the coastline render
 * deterministic on the passive surface.
 */
export function aisRadarSeascapeStyle(
  companionBase: string | null | undefined,
  theme: Theme,
): StyleSpecification | undefined {
  if (!companionBase) return undefined;
  const base = companionBase.replace(/\/+$/, '');
  const paint = mapThemePaint(theme);
  return {
    version: 8,
    name: 'binnacle-ais-radar-seascape',
    sources: {
      openmaptiles: {
        type: 'vector',
        tiles: [`${base}/style/basemap/tiles/openmaptiles/{z}/{x}/{y}`],
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': paint.background },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: {
          'fill-color': paint.water,
          'fill-opacity': 1,
          'fill-outline-color': paint.boundary,
        },
      },
    ],
  };
}

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
    // The themed-map bootstrap installs hidden background sentinels above base geometry to mark
    // overlay bands. Making every background layer visible turns those sentinels into opaque land
    // sheets above the water, so only the style's real background participates in the seascape.
    const isBackground = layer.type === 'background' && !layer.id.startsWith('__z__');
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

// Moving the passive coastline by less than one rendered pixel cannot improve what the radar face
// communicates. The physical threshold grows with range and shrinks when the instrument expands.
export function aisRadarPositionRenderMeters(rangeNm: AisRadarRangeNm, diameterPx: number): number {
  const usableDiameter =
    Number.isFinite(diameterPx) && diameterPx > 0 ? diameterPx : AIS_RADAR_FALLBACK_DIAMETER_PX;
  return Math.max(
    POSITION_RENDER_DEADBAND_METERS,
    (rangeNm * METERS_PER_NAUTICAL_MILE) / usableDiameter,
  );
}

function normalizedRadarDiameter(diameterPx: number): number {
  return Math.max(1, Math.round(diameterPx > 0 ? diameterPx : AIS_RADAR_FALLBACK_DIAMETER_PX));
}

function mercatorScale(latitude: number): number {
  const boundedLatitude = Math.max(
    -MAX_MERCATOR_LATITUDE,
    Math.min(MAX_MERCATOR_LATITUDE, latitude),
  );
  return 1 / Math.cos((boundedLatitude * Math.PI) / 180);
}

function radarScaleDriftPx(fittedLatitude: number, latitude: number, diameterPx: number): number {
  return Math.abs(mercatorScale(latitude) / mercatorScale(fittedLatitude) - 1) * diameterPx;
}

export function shouldMoveAisRadarSeascape(
  gate: PositionRenderGate,
  position: LatLon,
  rangeNm: AisRadarRangeNm,
  diameterPx: number,
): boolean {
  const roundedDiameter = normalizedRadarDiameter(diameterPx);
  return gate.shouldRender(position, {
    minDistanceMeters: aisRadarPositionRenderMeters(rangeNm, roundedDiameter),
    maxIntervalMs: AIS_RADAR_POSITION_MAX_INTERVAL_MS,
    minTrailingDistanceMeters: POSITION_RENDER_DEADBAND_METERS,
  });
}

export function centerAisRadarSeascape(map: MapLibreMap, position: LatLon): void {
  map.setCenter([position.longitude, position.latitude]);
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

export function createAisRadarCameraController(
  map: MapLibreMap,
  options: { now?: () => number; scheduler?: RefitScheduler } = {},
): AisRadarCameraController {
  const positionGate = createPositionRenderGate(options.now);
  const scheduler = options.scheduler ?? defaultRefitScheduler;
  let fittedRangeNm: AisRadarRangeNm | undefined;
  let fittedDiameterPx: number | undefined;
  let fittedLatitude: number | undefined;
  let pendingRefitId: number | undefined;
  let latest: { position: LatLon; rangeNm: AisRadarRangeNm; diameterPx: number } | undefined;

  function cancelPendingRefit(): void {
    if (pendingRefitId === undefined) return;
    scheduler.cancel(pendingRefitId);
    pendingRefitId = undefined;
  }

  function recordFittedPosition(
    position: LatLon,
    rangeNm: AisRadarRangeNm,
    diameterPx: number,
  ): void {
    positionGate.reset();
    positionGate.shouldRender(position, {
      minDistanceMeters: aisRadarPositionRenderMeters(rangeNm, diameterPx),
      maxIntervalMs: AIS_RADAR_POSITION_MAX_INTERVAL_MS,
      minTrailingDistanceMeters: POSITION_RENDER_DEADBAND_METERS,
    });
  }

  function refit(input: NonNullable<typeof latest>): void {
    cancelPendingRefit();
    fitAisRadarSeascape(map, input.position, input.rangeNm);
    fittedRangeNm = input.rangeNm;
    fittedDiameterPx = input.diameterPx;
    fittedLatitude = input.position.latitude;
    recordFittedPosition(input.position, input.rangeNm, input.diameterPx);
  }

  function scheduleRefit(): void {
    cancelPendingRefit();
    pendingRefitId = scheduler.request(() => {
      pendingRefitId = undefined;
      if (latest) refit(latest);
    }, AIS_RADAR_LAYOUT_REFIT_DELAY_MS);
    if (pendingRefitId === undefined && latest) refit(latest);
  }

  return {
    sync(position, rangeNm, diameterPx) {
      const normalizedDiameterPx = normalizedRadarDiameter(diameterPx);
      latest = { position, rangeNm, diameterPx: normalizedDiameterPx };
      if (fittedRangeNm === undefined || fittedRangeNm !== rangeNm) {
        refit(latest);
        return;
      }
      if (
        fittedLatitude === undefined ||
        radarScaleDriftPx(fittedLatitude, position.latitude, normalizedDiameterPx) >=
          AIS_RADAR_SCALE_REFIT_DRIFT_PX
      ) {
        refit(latest);
        return;
      }
      if (fittedDiameterPx !== normalizedDiameterPx) scheduleRefit();
      if (shouldMoveAisRadarSeascape(positionGate, position, rangeNm, normalizedDiameterPx)) {
        centerAisRadarSeascape(map, position);
      }
    },
    destroy() {
      cancelPendingRefit();
    },
  };
}
