import { describe, expect, it } from 'vitest';
import { AIS_MOTION_STALE_TTL_MS, type AisTargetView } from '$entities/ais';
import { AIS_ICON_IDS } from './ais-icon';
import { buildAisPositionProjectionFeatures } from './ais-position-projection';

function movingTarget(overrides: Partial<AisTargetView> = {}): AisTargetView {
  return {
    id: 'vessels.target',
    position: { latitude: 0, longitude: 0 },
    cogRad: Math.PI / 2,
    sogMps: 5,
    ...overrides,
  };
}

// Around the equator one longitude degree is about 111,320 m. Parameterizing pixels per meter
// lets each test state the apparent displacement it wants without depending on a MapLibre map.
function projectAt(pixelsPerMeter: number) {
  return ([longitude, latitude]: [number, number]) => ({
    x: longitude * 111_320 * pixelsPerMeter,
    y: latitude * -111_320 * pixelsPerMeter,
  });
}

function build(
  target: AisTargetView,
  options: { ageMs?: number; pixelsPerMeter?: number; epoch?: number | undefined } = {},
) {
  const ageMs = options.ageMs ?? 2_000;
  const pixelsPerMeter = options.pixelsPerMeter ?? 0.6;
  const epoch = Object.hasOwn(options, 'epoch') ? options.epoch : 10_000;
  return buildAisPositionProjectionFeatures([target], {
    kindMode: 'type-specific',
    now: 10_000 + ageMs,
    positionEpochMs: () => epoch,
    project: projectAt(pixelsPerMeter),
  });
}

describe('AIS between-fix position projection', () => {
  it('fades in around the six-pixel significance point', () => {
    // 5 m/s for two seconds is 10 m; 0.6 px/m makes the apparent displacement about 6 px.
    const features = build(movingTarget());

    expect(features).toHaveLength(2);
    expect(features[0].properties?.projectionPart).toBe('connector');
    expect(features[1].properties?.projectionPart).toBe('ghost');
    expect(features[1].properties?.confidence).toBeCloseTo(1 / 3, 1);
  });

  it('omits a projection that is visually indistinguishable from the received fix', () => {
    expect(build(movingTarget(), { pixelsPerMeter: 0.3 })).toEqual([]);
  });

  it('reaches full faint weight at ten pixels and preserves icon type and scale', () => {
    const features = build(movingTarget({ shipTypeId: 83, lengthMeters: 250 }), {
      pixelsPerMeter: 1,
    });
    const ghost = features[1];

    expect(ghost.properties).toMatchObject({
      confidence: 1,
      iconImage: AIS_ICON_IDS.tanker,
      iconScale: 1.8,
    });
    expect((ghost.geometry as GeoJSON.Point).coordinates[0]).toBeGreaterThan(0);
  });

  it('suppresses stationary, missing-epoch, future, and stale projections', () => {
    expect(build(movingTarget({ sogMps: 0.2 }))).toEqual([]);
    expect(build(movingTarget(), { epoch: undefined })).toEqual([]);
    expect(build(movingTarget(), { ageMs: -1 })).toEqual([]);
    expect(build(movingTarget(), { ageMs: AIS_MOTION_STALE_TTL_MS + 1 })).toEqual([]);
  });
});
