import { knotsToMetersPerSecond } from '$shared/lib';

export const CURRENT_VECTOR_UPDATE_INTERVAL_MS = 60_000;
export const CURRENT_VECTOR_STALE_MS = 90_000;
const MIN_VISIBLE_DRIFT_MPS = knotsToMetersPerSecond(0.1);
const FULL_OPACITY_DRIFT_MPS = knotsToMetersPerSecond(2);

export interface CurrentVectorSample {
  setTrueRad: number;
  driftMps: number;
  epochMs: number;
}

export interface CurrentVectorTracker {
  push(setTrueRad: number, driftMps: number, epochMs: number): CurrentVectorSample | undefined;
  reset(): void;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

export function currentVectorOpacity(driftMps: number | undefined): number {
  if (driftMps === undefined || !finite(driftMps) || driftMps <= MIN_VISIBLE_DRIFT_MPS) return 0;
  return Math.min(
    1,
    Math.max(
      0,
      (driftMps - MIN_VISIBLE_DRIFT_MPS) / (FULL_OPACITY_DRIFT_MPS - MIN_VISIBLE_DRIFT_MPS),
    ),
  );
}

export function createCurrentVectorTracker(
  updateIntervalMs = CURRENT_VECTOR_UPDATE_INTERVAL_MS,
): CurrentVectorTracker {
  let accepted: CurrentVectorSample | undefined;

  return {
    push(setTrueRad, driftMps, epochMs) {
      if (!finite(setTrueRad) || !finite(driftMps) || !finite(epochMs) || driftMps < 0) {
        return accepted;
      }
      if (
        !accepted ||
        epochMs < accepted.epochMs ||
        epochMs - accepted.epochMs >= updateIntervalMs
      ) {
        accepted = { setTrueRad, driftMps, epochMs };
      }
      return accepted;
    },
    reset() {
      accepted = undefined;
    },
  };
}
