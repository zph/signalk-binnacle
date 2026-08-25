import type { AisTargetView, AisVesselKind } from '$entities/ais';
import { AIS_MOTION_STALE_TTL_MS, aisVesselKind } from '$entities/ais';
import { latLonToLonLat } from '$shared/geo';
import { headingDegrees } from '$shared/lib';
import { antimeridianLineGeometry } from '$shared/map';
import { geodesicDestination } from '$shared/nav';
import { AIS_ICON_IDS, aisVesselIconScale } from './ais-icon';

// Below roughly 0.5 knots, small GPS wander is more likely than meaningful between-packet travel.
const MIN_SPEED_MPS = 0.25;
// Four pixels is visually indistinguishable from the authoritative icon. The projection fades in
// through the nominal six-pixel significance point and reaches its full faint weight at ten.
const FADE_START_PX = 4;
const FADE_FULL_PX = 10;

export interface AisPositionProjectionOptions {
  kindMode: 'type-specific' | 'generic';
  now: number;
  positionEpochMs: (id: string) => number | undefined;
  project: (coordinate: [number, number]) => { x: number; y: number };
}

function confidenceForPixels(pixels: number): number {
  return Math.max(0, Math.min(1, (pixels - FADE_START_PX) / (FADE_FULL_PX - FADE_START_PX)));
}

function iconKind(
  target: AisTargetView,
  mode: AisPositionProjectionOptions['kindMode'],
): AisVesselKind {
  return mode === 'generic' ? 'ship' : aisVesselKind(target.shipTypeId);
}

export function buildAisPositionProjectionFeatures(
  targets: readonly AisTargetView[],
  options: AisPositionProjectionOptions,
): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = [];
  for (const target of targets) {
    if (
      target.cogRad === undefined ||
      target.sogMps === undefined ||
      target.sogMps < MIN_SPEED_MPS
    ) {
      continue;
    }
    const positionEpoch = options.positionEpochMs(target.id);
    if (positionEpoch === undefined) continue;
    const ageMs = options.now - positionEpoch;
    if (ageMs <= 0 || ageMs > AIS_MOTION_STALE_TTL_MS) continue;

    const origin = latLonToLonLat(target.position);
    const tip = geodesicDestination(
      target.position.latitude,
      target.position.longitude,
      target.cogRad,
      target.sogMps * (ageMs / 1000),
    );
    const originPixel = options.project(origin);
    const tipPixel = options.project(tip);
    const confidence = confidenceForPixels(
      Math.hypot(tipPixel.x - originPixel.x, tipPixel.y - originPixel.y),
    );
    if (confidence === 0) continue;

    const kind = iconKind(target, options.kindMode);
    const shared = { id: target.id, confidence };
    features.push({
      type: 'Feature',
      geometry: antimeridianLineGeometry([origin, tip]),
      properties: { ...shared, projectionPart: 'connector' },
    });
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: tip },
      properties: {
        ...shared,
        projectionPart: 'ghost',
        heading: headingDegrees(target.headingRad, target.cogRad),
        iconImage: AIS_ICON_IDS[kind],
        iconScale: aisVesselIconScale(target.lengthMeters),
      },
    });
  }
  return features;
}
