export type WindSectorReference = 'true' | 'apparent';

export const WIND_SECTOR_WINDOW_MS = 4_000;

interface AngleSample {
  angleRad: number;
  epochMs: number;
}

export interface WindSectorTracker {
  push(angleRad: number, epochMs: number, reference: WindSectorReference): number;
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
// are keyed by their Signal K receipt epoch, so SOG, depth, and other tile updates do not give an
// unchanged wind sample extra weight.
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
