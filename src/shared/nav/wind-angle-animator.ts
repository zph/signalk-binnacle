import { clamp, DEG_TO_RAD } from '$shared/lib';

const WIND_ANGLE_DEADBAND_RAD = DEG_TO_RAD;
export const WIND_ANGLE_MIN_DURATION_MS = 250;
export const WIND_ANGLE_MAX_DURATION_MS = 1_200;
// Wind data itself arrives at no more than 5 Hz. Committing transforms at 4 Hz preserves that
// instrument response without running four independent display-rate render loops per wind rose.
export const WIND_ANGLE_RENDER_INTERVAL_MS = 250;
const WIND_ANGLE_DEFAULT_DURATION_MS = 750;

interface FrameScheduler {
  now(): number;
  request(callback: (nowMs: number) => void, delayMs: number): number | undefined;
  cancel(id: number): void;
}

interface WindAngleAnimatorOptions {
  scheduler?: FrameScheduler;
  reducedMotion?: () => boolean;
  deadbandRad?: number;
}

interface WindAngleAnimator {
  push(angleRad: number, epochMs: number): void;
  reset(angleRad?: number): void;
  destroy(): void;
}

const defaultScheduler: FrameScheduler = {
  now: () => globalThis.performance?.now() ?? Date.now(),
  request(callback, delayMs) {
    if (typeof window === 'undefined') return undefined;
    return window.setTimeout(() => callback(defaultScheduler.now()), delayMs);
  },
  cancel(id) {
    if (typeof window !== 'undefined') window.clearTimeout(id);
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
  let animation:
    | { startRad: number; targetRad: number; startedAt: number; durationMs: number }
    | undefined;

  function cancelFrame(): void {
    if (frameId === undefined) return;
    scheduler.cancel(frameId);
    frameId = undefined;
  }

  function setImmediate(angleRad: number | undefined): void {
    cancelFrame();
    animation = undefined;
    if (displayedRad === angleRad && acceptedRad === angleRad) return;
    displayedRad = angleRad;
    acceptedRad = angleRad;
    onChange(angleRad);
  }

  function animationValue(nowMs: number): number | undefined {
    if (!animation) return displayedRad;
    const progress = clamp((nowMs - animation.startedAt) / animation.durationMs, 0, 1);
    return animation.startRad + (animation.targetRad - animation.startRad) * progress;
  }

  function scheduleStep(): void {
    if (frameId !== undefined) return;
    frameId = scheduler.request(step, WIND_ANGLE_RENDER_INTERVAL_MS);
    if (frameId === undefined && animation) setImmediate(animation.targetRad);
  }

  function step(nowMs: number): void {
    frameId = undefined;
    if (!animation) return;
    const progress = clamp((nowMs - animation.startedAt) / animation.durationMs, 0, 1);
    displayedRad = animation.startRad + (animation.targetRad - animation.startRad) * progress;
    onChange(displayedRad);
    if (progress >= 1) {
      animation = undefined;
      return;
    }
    scheduleStep();
  }

  function animate(targetRad: number, durationMs: number): void {
    const nowMs = scheduler.now();
    const startRad = animationValue(nowMs) ?? targetRad;
    const unwrappedTargetRad = startRad + shortestDelta(startRad, targetRad);
    displayedRad = startRad;
    animation = { startRad, targetRad: unwrappedTargetRad, startedAt: nowMs, durationMs };
    scheduleStep();
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
