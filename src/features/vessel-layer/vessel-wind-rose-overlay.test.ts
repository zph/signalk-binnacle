import { describe, expect, it } from 'vitest';

import {
  createVesselWindRoseOverlay,
  resolveVesselWindRoseAngles,
} from './vessel-wind-rose-overlay';

function vessel(
  values: Partial<Parameters<typeof resolveVesselWindRoseAngles>[0]> = {},
): Parameters<typeof resolveVesselWindRoseAngles>[0] {
  return {
    position: { latitude: 38, longitude: -122 },
    positionStale: false,
    headingRad: Math.PI / 2,
    headingStale: false,
    cogRad: Math.PI / 3,
    cogStale: false,
    windAngleApparentRad: -Math.PI / 6,
    windAngleApparentStale: false,
    windAngleTrueRad: Math.PI / 4,
    windAngleTrueStale: false,
    windDirectionTrueRad: undefined,
    windDirectionTrueStale: false,
    ...values,
  };
}

describe('resolveVesselWindRoseAngles', () => {
  it('aligns boat and bow-relative wind to a north-up chart', () => {
    expect(resolveVesselWindRoseAngles(vessel(), 0)).toEqual({
      headingDeg: 90,
      boatDeg: 90,
      apparentDeg: 60,
      trueDeg: 135,
      sectorDeg: 135,
    });
  });

  it('becomes the normal bow-up rose when the map follows heading', () => {
    expect(resolveVesselWindRoseAngles(vessel(), 90)).toEqual({
      headingDeg: 90,
      boatDeg: 0,
      apparentDeg: 330,
      trueDeg: 45,
      sectorDeg: 45,
    });
  });

  it('uses absolute true-wind direction and falls back from stale heading to fresh COG', () => {
    expect(
      resolveVesselWindRoseAngles(
        vessel({
          headingStale: true,
          cogRad: Math.PI,
          windDirectionTrueRad: Math.PI / 2,
        }),
        30,
      ),
    ).toEqual({
      headingDeg: 180,
      boatDeg: 150,
      apparentDeg: 120,
      trueDeg: 60,
      sectorDeg: 60,
    });
  });

  it('suppresses stale wind pointers without hiding a fresh boat reference', () => {
    expect(
      resolveVesselWindRoseAngles(
        vessel({
          windAngleApparentStale: true,
          windAngleTrueStale: true,
          windDirectionTrueStale: true,
        }),
        0,
      ),
    ).toEqual({
      headingDeg: 90,
      boatDeg: 90,
      apparentDeg: undefined,
      trueDeg: undefined,
      sectorDeg: undefined,
    });
  });
});

describe('vessel wind rose layer defaults', () => {
  it('is an opt-in layer that can be enabled from the Layers panel', () => {
    const overlay = createVesselWindRoseOverlay(vessel());

    expect(overlay.listed).toBe(true);
    expect(overlay.defaultVisible).toBe(false);
  });
});
