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

    expect(selection).toEqual({
      primary: { cogRad: 0, sogMps: 5 },
      basis: 'reported',
      sampleCount: 6,
      newestSampleAt: 50_000,
    });
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
    expect(selection?.observed?.sogMps).toBeCloseTo(8, 1);
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

    expect(selection?.basis).toBe('reported');
    expect(selection?.primary).toEqual({ cogRad: 0, sogMps: 5 });
    expect(selection?.observed?.sogMps).toBeCloseTo(5.2, 1);
  });

  it('follows a sustained turn after the preceding minute leaves the window', () => {
    const estimator = new AisMotionEstimator();
    const origin = { latitude: 10, longitude: 20 };
    for (let seconds = 0; seconds <= 60; seconds += 10) {
      estimator.update([target(positionAfter(origin, Math.PI / 2, 8, seconds))], seconds * 1000);
    }
    const turnPosition = positionAfter(origin, Math.PI / 2, 8, 60);
    let selection: AisMotionSelection | undefined;
    for (let seconds = 70; seconds <= 130; seconds += 10) {
      selection = estimator
        .update([target(positionAfter(turnPosition, 0, 8, seconds - 60))], seconds * 1000)
        .get('target-1');
    }

    expect(selection?.basis).toBe('observed');
    expect(selection?.primary.cogRad).toBeCloseTo(0, 2);
    expect(selection?.primary.sogMps).toBeCloseTo(8, 1);
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
    expect(selection?.observed?.sogMps).toBe(0);
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
    expect(selection?.observed?.sogMps).toBeCloseTo(8, 1);
    expect(selection?.reportedComparison).toBeUndefined();
  });

  it('merges recent history so observed motion is available without waiting a minute', () => {
    const estimator = new AisMotionEstimator();
    const origin = { latitude: 10, longitude: 20 };
    const now = 60_000;
    estimator.update([target(positionAfter(origin, Math.PI / 2, 8, 60))], now);
    estimator.seed(
      'target-1',
      Array.from({ length: 12 }, (_, index) => {
        const seconds = index * 5;
        return {
          at: seconds * 1000,
          ...positionAfter(origin, Math.PI / 2, 8, seconds),
        };
      }),
      now,
    );

    const selection = estimator
      .update([target(positionAfter(origin, Math.PI / 2, 8, 60))], now)
      .get('target-1');
    expect(selection?.basis).toBe('observed');
    expect(selection?.observed?.sogMps).toBeCloseTo(8, 1);
    expect(selection?.sampleCount).toBe(13);
    expect(selection?.newestSampleAt).toBe(now);
  });

  it('ignores malformed, future, and stale seed samples', () => {
    const estimator = new AisMotionEstimator();
    estimator.seed(
      'target-1',
      [
        { at: 39_999, latitude: 10, longitude: 20 },
        { at: 100_001, latitude: 10, longitude: 20 },
        { at: 100_000, latitude: 91, longitude: 20 },
      ],
      100_000,
    );
    const selection = estimator
      .update([target({ latitude: 10, longitude: 20 })], 100_000)
      .get('target-1');
    expect(selection?.sampleCount).toBe(1);
    expect(selection?.newestSampleAt).toBe(100_000);
  });

  it('reports sample evidence before a target has usable motion', () => {
    const estimator = new AisMotionEstimator();
    const selection = estimator
      .update(
        [target({ latitude: 10, longitude: 20 }, { cogRad: undefined, sogMps: undefined })],
        0,
      )
      .get('target-1');
    expect(selection).toEqual({ sampleCount: 1, newestSampleAt: 0 });
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
