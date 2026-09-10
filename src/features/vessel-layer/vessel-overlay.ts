import type { LineLayerSpecification } from 'maplibre-gl';

import type { OwnVessel } from '$entities/vessel';
import { latLonToLonLat } from '$shared/geo';
import { headingDegrees, knotsToMetersPerSecond } from '$shared/lib';
import {
  antimeridianLineGeometry,
  createSymbolOverlay,
  emptyFeatureCollection,
  ensureGeoJsonSource,
  featureCollection,
  mapThemePaint,
  type Rgba,
  removeLayersAndSources,
  rgbaCss,
  type SymbolOverlay,
  setLayersVisibility,
  setMapImage,
  setPaintProp,
  setSourceData,
} from '$shared/map';
import { geodesicDestination, haversineMeters, POSITION_RENDER_DEADBAND_METERS } from '$shared/nav';
import { staleVesselBadgeImage, VESSEL_ICON_ID, vesselIconImage } from './vessel-icon';

const SOURCE_ID = 'binnacle-own-vessel';
const LAYER_ID = 'binnacle-own-vessel-symbol';
const STALE_LAYER_ID = 'binnacle-own-vessel-stale';
const VECTOR_SOURCE_ID = 'binnacle-own-vessel-vector';
const VECTOR_FAR_LAYER_ID = 'binnacle-own-vessel-vector-10-minute';
const VECTOR_MIDDLE_LAYER_ID = 'binnacle-own-vessel-vector-5-minute';
const VECTOR_NEAR_LAYER_ID = 'binnacle-own-vessel-vector-2-5-minute';
const VECTOR_LAYER_IDS = [VECTOR_FAR_LAYER_ID, VECTOR_MIDDLE_LAYER_ID, VECTOR_NEAR_LAYER_ID];
const VECTOR_MIN_SOG_MPS = knotsToMetersPerSecond(0.15);
const VECTOR_WIDTH = 2;
const VECTOR_OPACITY = 0.8;
const SECONDS_PER_MINUTE = 60;
const STALE_ICON_ID = 'binnacle-vessel-stale-badge';
// MapLibre reparses a GeoJSON source and schedules a full map render after setData(). Ignore sensor
// noise that cannot move the marker or vector meaningfully on screen. Navigation calculations keep
// consuming the unfiltered Signal K values; these thresholds affect display invalidation only.
const HEADING_REDRAW_DEGREES = 1;
const VECTOR_SOG_REDRAW_MPS = knotsToMetersPerSecond(0.1);
const VECTOR_COG_REDRAW_RADIANS = Math.PI / 180;
// The transient color shown for the single frame before the first recolor; taken from the day theme
// so there is one source for the day own-vessel color rather than a literal that could drift.
const DEFAULT_COLOR: Rgba = mapThemePaint('day').ownVessel;
const DEFAULT_STALE_COLOR = mapThemePaint('day').warning;

// The overlay id. The chart pins this on top so a chart or traffic can never hide the boat; exported
// so the pinned list references the same constant instead of a literal that could drift on a rename.
export const OWN_VESSEL_OVERLAY_ID = 'own-vessel';
const REVIEW_DIM_OPACITY = 0.35;

type VectorHorizon = '10-minute' | '5-minute' | '2.5-minute';

function circularDifference(value: number, prior: number, fullTurn: number): number {
  const delta = Math.abs(value - prior) % fullTurn;
  return Math.min(delta, fullTurn - delta);
}

function positionChanged(
  latitude: number | undefined,
  longitude: number | undefined,
  priorLatitude: number | undefined,
  priorLongitude: number | undefined,
): boolean {
  if (
    latitude === undefined ||
    longitude === undefined ||
    priorLatitude === undefined ||
    priorLongitude === undefined
  ) {
    return latitude !== priorLatitude || longitude !== priorLongitude;
  }
  return (
    haversineMeters(priorLatitude, priorLongitude, latitude, longitude) >=
    POSITION_RENDER_DEADBAND_METERS
  );
}

function valueChanged(
  value: number | undefined,
  prior: number | undefined,
  deadband: number,
): boolean {
  if (value === undefined || prior === undefined) return value !== prior;
  return Math.abs(value - prior) >= deadband;
}

function angleChanged(
  value: number | undefined,
  prior: number | undefined,
  fullTurn: number,
  deadband: number,
): boolean {
  if (value === undefined || prior === undefined) return value !== prior;
  return circularDifference(value, prior, fullTurn) >= deadband;
}

function darker(color: Rgba, factor: number): Rgba {
  return {
    r: Math.round(color.r * factor),
    g: Math.round(color.g * factor),
    b: Math.round(color.b * factor),
    a: color.a,
  };
}

function vectorColor(paint: Rgba, horizon: VectorHorizon): string {
  if (horizon === '2.5-minute') return rgbaCss(darker(paint, 0.7));
  if (horizon === '5-minute') return rgbaCss(darker(paint, 0.84));
  return rgbaCss(paint);
}

export function buildOwnVesselVectorFeatures(vessel: OwnVessel): GeoJSON.FeatureCollection {
  const position = vessel.position;
  const sogMps = vessel.sogMps;
  const cogRad = vessel.cogRad;
  if (
    !position ||
    sogMps === undefined ||
    cogRad === undefined ||
    sogMps <= VECTOR_MIN_SOG_MPS ||
    vessel.positionStale ||
    vessel.sogStale ||
    vessel.cogStale
  ) {
    return emptyFeatureCollection();
  }

  const origin = latLonToLonLat(position);
  const feature = (minutes: number, horizon: VectorHorizon): GeoJSON.Feature => ({
    type: 'Feature',
    geometry: antimeridianLineGeometry([
      origin,
      geodesicDestination(
        position.latitude,
        position.longitude,
        cogRad,
        sogMps * minutes * SECONDS_PER_MINUTE,
      ),
    ]),
    properties: { horizon },
  });

  // Draw the 10-minute AIS-colored vector first, then progressively darker 5- and 2.5-minute
  // vectors on top. The overlap makes the three arrival horizons read from the boat outward.
  return featureCollection([
    feature(10, '10-minute'),
    feature(5, '5-minute'),
    feature(2.5, '2.5-minute'),
  ]);
}

export function createVesselOverlay(
  vessel: OwnVessel,
  reviewActive: () => boolean = () => false,
): SymbolOverlay {
  let lastLon: number | undefined;
  let lastLat: number | undefined;
  let lastHeading: number | undefined;
  let lastStale: boolean | undefined;
  let lastVectorLon: number | undefined;
  let lastVectorLat: number | undefined;
  let lastVectorSog: number | undefined;
  let lastVectorCog: number | undefined;
  let lastVectorStale: boolean | undefined;
  let lastVectorVisible: boolean | undefined;

  // Heading drives icon-rotate (degrees), falling back to course over ground, then north.
  const resolveHeading = (): number => headingDegrees(vessel.headingRad, vessel.cogRad);

  function buildFeatures(): GeoJSON.FeatureCollection {
    const position = vessel.position;
    if (!position) return emptyFeatureCollection();
    return featureCollection([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: latLonToLonLat(position) },
        properties: { heading: resolveHeading(), stale: vessel.positionStale },
      },
    ]);
  }

  function shouldRefresh(): boolean {
    const position = vessel.position;
    const lon = position?.longitude;
    const lat = position?.latitude;
    const heading = position ? resolveHeading() : undefined;
    const stale = vessel.positionStale;
    if (
      !positionChanged(lat, lon, lastLat, lastLon) &&
      !angleChanged(heading, lastHeading, 360, HEADING_REDRAW_DEGREES) &&
      stale === lastStale
    ) {
      return false;
    }
    lastLon = lon;
    lastLat = lat;
    lastHeading = heading;
    lastStale = stale;
    return true;
  }

  function shouldRefreshVector(): boolean {
    const position = vessel.position;
    const lon = position?.longitude;
    const lat = position?.latitude;
    const sog = vessel.sogMps;
    const cog = vessel.cogRad;
    const stale = vessel.positionStale || vessel.sogStale || vessel.cogStale;
    const vectorVisible =
      position !== undefined &&
      sog !== undefined &&
      cog !== undefined &&
      sog > VECTOR_MIN_SOG_MPS &&
      !stale;
    // Below the vector's minimum speed, position, speed, and course noise all produce the same
    // empty feature collection. Upload it once on the visible-to-hidden edge, not on every fix.
    if (!vectorVisible && lastVectorVisible === false) return false;
    if (
      vectorVisible === lastVectorVisible &&
      !positionChanged(lat, lon, lastVectorLat, lastVectorLon) &&
      !valueChanged(sog, lastVectorSog, VECTOR_SOG_REDRAW_MPS) &&
      !angleChanged(cog, lastVectorCog, Math.PI * 2, VECTOR_COG_REDRAW_RADIANS) &&
      stale === lastVectorStale
    ) {
      return false;
    }
    lastVectorLon = lon;
    lastVectorLat = lat;
    lastVectorSog = sog;
    lastVectorCog = cog;
    lastVectorStale = stale;
    lastVectorVisible = vectorVisible;
    return true;
  }

  const overlay = createSymbolOverlay({
    id: OWN_VESSEL_OVERLAY_ID,
    title: 'Own vessel',
    description:
      'Boat marker and 10-minute course-over-ground vector, with darker 2.5- and 5-minute arrival horizons.',
    band: 'vessel',
    sourceId: SOURCE_ID,
    layerId: LAYER_ID,
    iconId: VESSEL_ICON_ID,
    iconImage: vesselIconImage,
    pixelRatio: 2,
    defaultColor: DEFAULT_COLOR,
    paintColor: (paint) => paint.ownVessel,
    features: buildFeatures,
    shouldRefresh,
  });
  let acceptedOpacity = 1;
  let lastReviewActive: boolean | undefined;

  function applyOpacity(ctx: Parameters<NonNullable<SymbolOverlay['setOpacity']>>[0]): void {
    const opacity = acceptedOpacity * (reviewActive() ? REVIEW_DIM_OPACITY : 1);
    overlay.setOpacity?.(ctx, opacity);
    for (const layerId of VECTOR_LAYER_IDS) {
      setPaintProp(ctx.map, layerId, 'line-opacity', opacity * VECTOR_OPACITY);
    }
    if (ctx.map.getLayer(STALE_LAYER_ID)) {
      ctx.map.setPaintProperty(STALE_LAYER_ID, 'icon-opacity', opacity);
    }
  }

  return {
    ...overlay,
    layerIds: [...VECTOR_LAYER_IDS, LAYER_ID, STALE_LAYER_ID],
    async add(ctx) {
      ensureGeoJsonSource(ctx.map, VECTOR_SOURCE_ID);
      setSourceData(ctx.map, VECTOR_SOURCE_ID, buildOwnVesselVectorFeatures(vessel));
      const before = ctx.beforeIdFor('vessel');
      const vectorPaint = mapThemePaint('day').aisTarget;
      const layers: Array<[string, VectorHorizon]> = [
        [VECTOR_FAR_LAYER_ID, '10-minute'],
        [VECTOR_MIDDLE_LAYER_ID, '5-minute'],
        [VECTOR_NEAR_LAYER_ID, '2.5-minute'],
      ];
      for (const [id, horizon] of layers) {
        if (ctx.map.getLayer(id)) continue;
        const layer: LineLayerSpecification = {
          id,
          type: 'line',
          source: VECTOR_SOURCE_ID,
          filter: ['==', ['get', 'horizon'], horizon],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': vectorColor(vectorPaint, horizon),
            'line-width': VECTOR_WIDTH,
            'line-opacity': VECTOR_OPACITY,
          },
        };
        ctx.map.addLayer(layer, before);
      }
      await overlay.add(ctx);
      setMapImage(ctx.map, STALE_ICON_ID, staleVesselBadgeImage(DEFAULT_STALE_COLOR), 2);
      if (!ctx.map.getLayer(STALE_LAYER_ID)) {
        ctx.map.addLayer(
          {
            id: STALE_LAYER_ID,
            type: 'symbol',
            source: SOURCE_ID,
            filter: ['==', ['get', 'stale'], true],
            layout: {
              'icon-image': STALE_ICON_ID,
              'icon-rotation-alignment': 'viewport',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            },
          },
          ctx.beforeIdFor('vessel'),
        );
      }
    },
    sync(ctx) {
      overlay.sync(ctx);
      if (shouldRefreshVector()) {
        setSourceData(ctx.map, VECTOR_SOURCE_ID, buildOwnVesselVectorFeatures(vessel));
      }
      const reviewing = reviewActive();
      if (reviewing === lastReviewActive) return;
      lastReviewActive = reviewing;
      applyOpacity(ctx);
    },
    setOpacity(ctx, opacity) {
      acceptedOpacity = opacity;
      applyOpacity(ctx);
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, [...VECTOR_LAYER_IDS, LAYER_ID, STALE_LAYER_ID], visible);
    },
    applyTheme(ctx, paint) {
      overlay.applyTheme?.(ctx, paint);
      setMapImage(ctx.map, STALE_ICON_ID, staleVesselBadgeImage(paint.warning), 2);
      setPaintProp(
        ctx.map,
        VECTOR_FAR_LAYER_ID,
        'line-color',
        vectorColor(paint.aisTarget, '10-minute'),
      );
      setPaintProp(
        ctx.map,
        VECTOR_MIDDLE_LAYER_ID,
        'line-color',
        vectorColor(paint.aisTarget, '5-minute'),
      );
      setPaintProp(
        ctx.map,
        VECTOR_NEAR_LAYER_ID,
        'line-color',
        vectorColor(paint.aisTarget, '2.5-minute'),
      );
    },
    remove(ctx) {
      if (ctx.map.getLayer(STALE_LAYER_ID)) ctx.map.removeLayer(STALE_LAYER_ID);
      if (ctx.map.hasImage(STALE_ICON_ID)) ctx.map.removeImage(STALE_ICON_ID);
      overlay.remove(ctx);
      removeLayersAndSources(ctx.map, VECTOR_LAYER_IDS, [VECTOR_SOURCE_ID]);
    },
    reset() {
      lastStale = undefined;
      lastReviewActive = undefined;
      lastVectorLon = undefined;
      lastVectorLat = undefined;
      lastVectorSog = undefined;
      lastVectorCog = undefined;
      lastVectorStale = undefined;
      overlay.reset?.();
    },
  };
}
