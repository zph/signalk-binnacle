export type WindSectorReference = 'true' | 'apparent';

const WIND_SECTOR_WINDOW_MS = 4_000;
const WIND_DIRECTION_RANGE_WINDOW_MS = 60_000;
const MIN_WIND_DIRECTION_RANGE_RAD = Math.PI / 180;

interface AngleSample {
  angleRad: number;
  epochMs: number;
}

interface WindSectorTracker {
  push(angleRad: number, epochMs: number, reference: WindSectorReference): number;
  reset(): void;
}

export interface WindDirectionRange {
  portRad: number;
  starboardRad: number;
}

interface WindDirectionRangeTracker {
  push(angleRad: number, epochMs: number): void;
  rangeAround(centerRad: number): WindDirectionRange;
  reset(): void;
}

function circularMean(samples: readonly AngleSample[]): number {
  let sine = 0;
  let cosine = 0;
  for (const sample of samples) {
    sine += Math.sin(sample.angleRad);
    cosine += Math.cos(sample.angleRad);
  }
  if (Math.hypot(sine, cosine) < 1e-9) return samples.at(-1)?.angleRad ?? 0;
  return Math.atan2(sine, cosine);
}

// A short circular rolling mean damps vane chatter without breaking at the -180/180 seam. Samples
// are keyed by their Signal K receipt epoch, so unrelated updates do not give an unchanged wind
// sample extra weight.
export function createWindSectorTracker(windowMs = WIND_SECTOR_WINDOW_MS): WindSectorTracker {
  const spanMs = Math.max(1, windowMs);
  let reference: WindSectorReference | undefined;
  let samples: AngleSample[] = [];

  return {
    push(angleRad, epochMs, nextReference) {
      if (!Number.isFinite(angleRad) || !Number.isFinite(epochMs)) {
        return samples.at(-1)?.angleRad ?? 0;
      }
      const newestEpoch = samples.at(-1)?.epochMs;
      if (reference !== nextReference || (newestEpoch !== undefined && epochMs < newestEpoch)) {
        samples = [];
      }
      reference = nextReference;

      const existingIndex = samples.findIndex((sample) => sample.epochMs === epochMs);
      if (existingIndex >= 0) samples[existingIndex] = { angleRad, epochMs };
      else samples.push({ angleRad, epochMs });

      const cutoff = epochMs - spanMs;
      samples = samples.filter((sample) => sample.epochMs >= cutoff);
      return circularMean(samples);
    },
    reset() {
      reference = undefined;
      samples = [];
    },
  };
}

function signedAngleDelta(fromRad: number, toRad: number): number {
  return Math.atan2(Math.sin(toRad - fromRad), Math.cos(toRad - fromRad));
}

// The perimeter bands are an honest rolling envelope, rather than a standard-deviation guess:
// every true-wind direction received in the last minute remains inside the band. Keeping separate
// portward and starboard extents also avoids mirroring a one-sided shift onto the quiet side.
export function createWindDirectionRangeTracker(
  windowMs = WIND_DIRECTION_RANGE_WINDOW_MS,
  minimumRangeRad = MIN_WIND_DIRECTION_RANGE_RAD,
): WindDirectionRangeTracker {
  const spanMs = Math.max(1, windowMs);
  const minimum = Math.max(0, minimumRangeRad);
  let samples: AngleSample[] = [];

  return {
    push(angleRad, epochMs) {
      if (!Number.isFinite(angleRad) || !Number.isFinite(epochMs)) return;
      const newestEpoch = samples.at(-1)?.epochMs;
      if (newestEpoch !== undefined && epochMs < newestEpoch) samples = [];

      const existingIndex = samples.findIndex((sample) => sample.epochMs === epochMs);
      if (existingIndex >= 0) samples[existingIndex] = { angleRad, epochMs };
      else samples.push({ angleRad, epochMs });

      const cutoff = epochMs - spanMs;
      samples = samples.filter((sample) => sample.epochMs >= cutoff);
    },
    rangeAround(centerRad) {
      let portRad = minimum;
      let starboardRad = minimum;
      for (const sample of samples) {
        const delta = signedAngleDelta(centerRad, sample.angleRad);
        if (delta < 0) portRad = Math.max(portRad, -delta);
        else starboardRad = Math.max(starboardRad, delta);
      }
      return { portRad, starboardRad };
    },
    reset() {
      samples = [];
    },
  };
}
