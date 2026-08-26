import { clamp, DEG_TO_RAD } from '$shared/lib';

export const WIND_ANGLE_DEADBAND_RAD = DEG_TO_RAD;
export const WIND_ANGLE_MIN_DURATION_MS = 250;
export const WIND_ANGLE_MAX_DURATION_MS = 1_200;
export const WIND_ANGLE_DEFAULT_DURATION_MS = 750;

interface FrameScheduler {
  now(): number;
  request(callback: (nowMs: number) => void): number | undefined;
  cancel(id: number): void;
}

interface WindAngleAnimatorOptions {
  scheduler?: FrameScheduler;
  reducedMotion?: () => boolean;
  deadbandRad?: number;
}

export interface WindAngleAnimator {
  push(angleRad: number, epochMs: number): void;
  reset(angleRad?: number): void;
  destroy(): void;
}

const defaultScheduler: FrameScheduler = {
  now: () => globalThis.performance?.now() ?? Date.now(),
  request(callback) {
    if (typeof requestAnimationFrame !== 'function') return undefined;
    return requestAnimationFrame(callback);
  },
  cancel(id) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  },
};

function shortestDelta(fromRad: number, toRad: number): number {
  return Math.atan2(Math.sin(toRad - fromRad), Math.cos(toRad - fromRad));
}

// Wind vanes can chatter by fractions of a degree, then jump at the -180/180 seam. Keep the last
// accepted target until the vane moves by a visible degree, and interpolate each accepted sample
// through the shortest arc over its observed update cadence.
export function createWindAngleAnimator(
  onChange: (angleRad: number | undefined) => void,
  options: WindAngleAnimatorOptions = {},
): WindAngleAnimator {
  const scheduler = options.scheduler ?? defaultScheduler;
  const reducedMotion = options.reducedMotion ?? (() => false);
  const deadbandRad = Math.max(0, options.deadbandRad ?? WIND_ANGLE_DEADBAND_RAD);
  let displayedRad: number | undefined;
  let acceptedRad: number | undefined;
  let lastEpochMs: number | undefined;
  let frameId: number | undefined;

  function cancelFrame(): void {
    if (frameId === undefined) return;
    scheduler.cancel(frameId);
    frameId = undefined;
  }

  function setImmediate(angleRad: number | undefined): void {
    cancelFrame();
    displayedRad = angleRad;
    acceptedRad = angleRad;
    onChange(angleRad);
  }

  function animate(targetRad: number, durationMs: number): void {
    cancelFrame();
    const startRad = displayedRad ?? targetRad;
    const unwrappedTargetRad = startRad + shortestDelta(startRad, targetRad);
    const startedAt = scheduler.now();

    const step = (nowMs: number): void => {
      const progress = clamp((nowMs - startedAt) / durationMs, 0, 1);
      displayedRad = startRad + (unwrappedTargetRad - startRad) * progress;
      onChange(displayedRad);
      if (progress >= 1) {
        frameId = undefined;
        return;
      }
      frameId = scheduler.request(step);
      if (frameId === undefined) setImmediate(targetRad);
    };

    frameId = scheduler.request(step);
    if (frameId === undefined) setImmediate(targetRad);
  }

  return {
    push(angleRad, epochMs) {
      if (!Number.isFinite(angleRad) || !Number.isFinite(epochMs)) return;
      const previousEpochMs = lastEpochMs;
      lastEpochMs = epochMs;

      if (
        displayedRad === undefined ||
        acceptedRad === undefined ||
        (previousEpochMs !== undefined && epochMs < previousEpochMs)
      ) {
        setImmediate(angleRad);
        return;
      }

      if (Math.abs(shortestDelta(acceptedRad, angleRad)) < deadbandRad) return;
      acceptedRad = angleRad;

      if (reducedMotion()) {
        setImmediate(angleRad);
        return;
      }

      const sampleIntervalMs =
        previousEpochMs === undefined ? WIND_ANGLE_DEFAULT_DURATION_MS : epochMs - previousEpochMs;
      const durationMs = clamp(
        sampleIntervalMs > 0 ? sampleIntervalMs : WIND_ANGLE_DEFAULT_DURATION_MS,
        WIND_ANGLE_MIN_DURATION_MS,
        WIND_ANGLE_MAX_DURATION_MS,
      );
      animate(angleRad, durationMs);
    },
    reset(angleRad) {
      lastEpochMs = undefined;
      setImmediate(Number.isFinite(angleRad) ? angleRad : undefined);
    },
    destroy() {
      cancelFrame();
    },
  };
}
