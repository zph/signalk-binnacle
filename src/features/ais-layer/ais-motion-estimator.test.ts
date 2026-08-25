import { describe, expect, it } from 'vitest';

import type { AisTargetView } from '$entities/ais';
import { geodesicDestination } from '$shared/nav';
import { AisMotionEstimator, type AisMotionSelection } from './ais-motion-estimator';

function target(
  position: AisTargetView['position'],
  overrides: Partial<AisTargetView> = {},
): AisTargetView {
  return {
    id: 'target-1',
    position,
    cogRad: 0,
    sogMps: 5,
    ...overrides,
  };
}

function positionAfter(
  origin: AisTargetView['position'],
  cogRad: number,
  sogMps: number,
  seconds: number,
): AisTargetView['position'] {
  const [longitude, latitude] = geodesicDestination(
    origin.latitude,
    origin.longitude,
    cogRad,
    sogMps * seconds,
  );
  return { latitude, longitude };
}

describe('AisMotionEstimator', () => {
  it('uses reported COG and SOG while observation history is short', () => {
    const estimator = new AisMotionEstimator();
    const origin = { latitude: 10, longitude: 20 };
    let selection = estimator.update([target(origin)], 0).get('target-1');
    for (let seconds = 10; seconds < 60; seconds += 10) {
      selection = estimator
        .update([target(positionAfter(origin, Math.PI / 2, 8, seconds))], seconds * 1000)
        .get('target-1');
    }

    expect(selection).toEqual({ primary: { cogRad: 0, sogMps: 5 }, basis: 'reported' });
  });

  it('prefers sustained observed motion and retains reported motion for comparison', () => {
    const estimator = new AisMotionEstimator();
    const origin = { latitude: 10, longitude: 20 };
    let selection: AisMotionSelection | undefined;
    for (let seconds = 0; seconds <= 70; seconds += 10) {
      selection = estimator
        .update([target(positionAfter(origin, Math.PI / 2, 8, seconds))], seconds * 1000)
        .get('target-1');
    }

    expect(selection?.basis).toBe('observed');
    expect(selection?.primary.sogMps).toBeCloseTo(8, 1);
    expect(selection?.primary.cogRad).toBeCloseTo(Math.PI / 2, 2);
    expect(selection?.reportedComparison).toEqual({ cogRad: 0, sogMps: 5 });
  });

  it('keeps reported motion when observations agree within the tolerance', () => {
    const estimator = new AisMotionEstimator();
    const origin = { latitude: 10, longitude: 20 };
    let selection: AisMotionSelection | undefined;
    for (let seconds = 0; seconds <= 70; seconds += 10) {
      selection = estimator
        .update([target(positionAfter(origin, 0.1, 5.2, seconds))], seconds * 1000)
        .get('target-1');
    }

    expect(selection).toEqual({ primary: { cogRad: 0, sogMps: 5 }, basis: 'reported' });
  });

  it('can infer a stopped target from repeated unchanged positions', () => {
    const estimator = new AisMotionEstimator();
    const origin = { latitude: 10, longitude: 20 };
    let selection: AisMotionSelection | undefined;
    for (let seconds = 0; seconds <= 70; seconds += 10) {
      selection = estimator.update([target({ ...origin })], seconds * 1000).get('target-1');
    }

    expect(selection?.basis).toBe('observed');
    expect(selection?.primary.sogMps).toBe(0);
    expect(selection?.reportedComparison).toEqual({ cogRad: 0, sogMps: 5 });
  });

  it('rejects a position history with a large outlier', () => {
    const estimator = new AisMotionEstimator();
    const origin = { latitude: 10, longitude: 20 };
    let selection: AisMotionSelection | undefined;
    for (let seconds = 0; seconds <= 70; seconds += 10) {
      const position =
        seconds === 30
          ? { latitude: 11, longitude: 21 }
          : positionAfter(origin, Math.PI / 2, 8, seconds);
      selection = estimator.update([target(position)], seconds * 1000).get('target-1');
    }

    expect(selection?.basis).toBe('reported');
  });

  it('does not qualify sparse observations as repeated measurements', () => {
    const estimator = new AisMotionEstimator();
    const origin = { latitude: 10, longitude: 20 };
    estimator.update([target(origin)], 0);
    estimator.update([target(positionAfter(origin, Math.PI / 2, 8, 10))], 10_000);
    estimator.update([target(positionAfter(origin, Math.PI / 2, 8, 70))], 70_000);
    const selection = estimator
      .update([target(positionAfter(origin, Math.PI / 2, 8, 80))], 80_000)
      .get('target-1');

    expect(selection?.basis).toBe('reported');
  });

  it('uses qualified observed motion when reported motion is unavailable', () => {
    const estimator = new AisMotionEstimator();
    const origin = { latitude: 0, longitude: 179.99 };
    let selection: AisMotionSelection | undefined;
    for (let seconds = 0; seconds <= 70; seconds += 10) {
      selection = estimator
        .update(
          [
            target(positionAfter(origin, Math.PI / 2, 8, seconds), {
              cogRad: undefined,
              sogMps: undefined,
            }),
          ],
          seconds * 1000,
        )
        .get('target-1');
    }

    expect(selection?.basis).toBe('observed');
    expect(selection?.primary.sogMps).toBeCloseTo(8, 1);
    expect(selection?.primary.cogRad).toBeCloseTo(Math.PI / 2, 2);
    expect(selection?.reportedComparison).toBeUndefined();
  });

  it('forgets removed targets and starts their history over', () => {
    const estimator = new AisMotionEstimator();
    const origin = { latitude: 10, longitude: 20 };
    for (let seconds = 0; seconds <= 70; seconds += 10) {
      estimator.update([target(positionAfter(origin, Math.PI / 2, 8, seconds))], seconds * 1000);
    }
    estimator.update([], 80_000);

    const selection = estimator
      .update([target(positionAfter(origin, Math.PI / 2, 8, 90))], 90_000)
      .get('target-1');
    expect(selection?.basis).toBe('reported');
  });

  it('starts history over when the clock moves backward', () => {
    const estimator = new AisMotionEstimator();
    const origin = { latitude: 10, longitude: 20 };
    for (let seconds = 100; seconds <= 170; seconds += 10) {
      estimator.update(
        [target(positionAfter(origin, Math.PI / 2, 8, seconds - 100))],
        seconds * 1000,
      );
    }

    const selection = estimator.update([target(origin)], 10_000).get('target-1');
    expect(selection?.basis).toBe('reported');
  });
});
