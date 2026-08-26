import type { AisTargetView } from '$entities/ais';
import { DEG_TO_RAD } from '$shared/lib';
import { METERS_PER_DEG, normalizeLonDeltaDeg } from '$shared/nav';

const OBSERVATION_WINDOW_MS = 60_000;
// Five-second history buckets rarely land on both exact ends of a rolling minute. Accepting 55
// seconds preserves the live estimator's minute cadence while allowing a recent history query to
// qualify immediately.
const MIN_OBSERVATION_SPAN_MS = 55_000;
const MAX_SAMPLE_GAP_MS = 45_000;
const MIN_SAMPLES = 4;
const MIN_COURSE_SPEED_MPS = 0.5;
const MIN_SPEED_DIFFERENCE_MPS = 0.5;
const MIN_SPEED_DIFFERENCE_RATIO = 0.25;
const MIN_COURSE_DIFFERENCE_RAD = 15 * DEG_TO_RAD;
const MIN_RESIDUAL_TOLERANCE_METERS = 15;
const RESIDUAL_TRAVEL_RATIO = 0.25;

export interface AisPositionSample {
  at: number;
  latitude: number;
  longitude: number;
}

interface TargetHistory {
  lastView?: AisTargetView;
  samples: AisPositionSample[];
}

export interface AisMotion {
  cogRad: number;
  sogMps: number;
}

export interface AisMotionSelection {
  primary?: AisMotion;
  basis?: 'reported' | 'observed';
  // The qualified position-derived motion, retained even when it agrees with the AIS report and
  // therefore does not replace the reported projection.
  observed?: AisMotion;
  reportedComparison?: AisMotion;
  sampleCount: number;
  newestSampleAt?: number;
}

function reportedMotion(target: AisTargetView): AisMotion | undefined {
  if (
    target.cogRad === undefined ||
    target.sogMps === undefined ||
    !Number.isFinite(target.cogRad) ||
    !Number.isFinite(target.sogMps) ||
    target.sogMps < 0
  ) {
    return undefined;
  }
  return { cogRad: target.cogRad, sogMps: target.sogMps };
}

function angleDifferenceRad(a: number, b: number): number {
  const wrapped = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(wrapped, 2 * Math.PI - wrapped);
}

function materiallyDifferent(reported: AisMotion, observed: AisMotion): boolean {
  const speedDifference = Math.abs(reported.sogMps - observed.sogMps);
  const speedThreshold = Math.max(
    MIN_SPEED_DIFFERENCE_MPS,
    Math.max(reported.sogMps, observed.sogMps) * MIN_SPEED_DIFFERENCE_RATIO,
  );
  if (speedDifference >= speedThreshold) return true;
  return (
    reported.sogMps >= MIN_COURSE_SPEED_MPS &&
    observed.sogMps >= MIN_COURSE_SPEED_MPS &&
    angleDifferenceRad(reported.cogRad, observed.cogRad) >= MIN_COURSE_DIFFERENCE_RAD
  );
}

function linearSlope(values: number[], times: number[], meanTime: number): number {
  const meanValue = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < values.length; i += 1) {
    const timeDelta = times[i] - meanTime;
    numerator += timeDelta * (values[i] - meanValue);
    denominator += timeDelta * timeDelta;
  }
  return denominator > 0 ? numerator / denominator : 0;
}

function observedMotion(samples: AisPositionSample[]): AisMotion | undefined {
  if (samples.length < MIN_SAMPLES) return undefined;
  const first = samples[0];
  const last = samples.at(-1);
  if (!last || last.at - first.at < MIN_OBSERVATION_SPAN_MS) return undefined;
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i].at - samples[i - 1].at > MAX_SAMPLE_GAP_MS) return undefined;
  }

  const referenceLatRad = first.latitude * DEG_TO_RAD;
  const times = samples.map((sample) => (sample.at - first.at) / 1000);
  const east = samples.map(
    (sample) =>
      normalizeLonDeltaDeg(sample.longitude - first.longitude) *
      METERS_PER_DEG *
      Math.cos(referenceLatRad),
  );
  const north = samples.map((sample) => (sample.latitude - first.latitude) * METERS_PER_DEG);
  const meanTime = times.reduce((sum, value) => sum + value, 0) / times.length;
  const eastMps = linearSlope(east, times, meanTime);
  const northMps = linearSlope(north, times, meanTime);
  const sogMps = Math.hypot(eastMps, northMps);
  const cogRad = (Math.atan2(eastMps, northMps) + 2 * Math.PI) % (2 * Math.PI);

  const meanEast = east.reduce((sum, value) => sum + value, 0) / east.length;
  const meanNorth = north.reduce((sum, value) => sum + value, 0) / north.length;
  const residualSquared = times.reduce((sum, time, index) => {
    const expectedEast = meanEast + eastMps * (time - meanTime);
    const expectedNorth = meanNorth + northMps * (time - meanTime);
    return sum + (east[index] - expectedEast) ** 2 + (north[index] - expectedNorth) ** 2;
  }, 0);
  const residualMeters = Math.sqrt(residualSquared / samples.length);
  const travelMeters = sogMps * ((last.at - first.at) / 1000);
  if (
    residualMeters > Math.max(MIN_RESIDUAL_TOLERANCE_METERS, travelMeters * RESIDUAL_TRAVEL_RATIO)
  ) {
    return undefined;
  }
  return { cogRad, sogMps };
}

export class AisMotionEstimator {
  #history = new Map<string, TargetHistory>();

  reset(): void {
    this.#history.clear();
  }

  seed(id: string, samples: readonly AisPositionSample[], now: number): void {
    const history = this.#history.get(id) ?? { samples: [] };
    const byTimestamp = new Map<number, AisPositionSample>();
    for (const sample of [...samples, ...history.samples]) {
      if (
        !Number.isFinite(sample.at) ||
        sample.at > now ||
        now - sample.at > OBSERVATION_WINDOW_MS ||
        !Number.isFinite(sample.latitude) ||
        sample.latitude < -90 ||
        sample.latitude > 90 ||
        !Number.isFinite(sample.longitude) ||
        sample.longitude < -180 ||
        sample.longitude > 180
      ) {
        continue;
      }
      // Existing live samples follow the history samples in the merge and win at equal timestamps.
      byTimestamp.set(sample.at, sample);
    }
    history.samples = [...byTimestamp.values()].sort((a, b) => a.at - b.at);
    this.#history.set(id, history);
  }

  update(targets: AisTargetView[], now: number): Map<string, AisMotionSelection> {
    const selections = new Map<string, AisMotionSelection>();
    const activeIds = new Set<string>();
    for (const target of targets) {
      activeIds.add(target.id);
      let history = this.#history.get(target.id);
      if (!history) {
        history = { samples: [] };
        this.#history.set(target.id, history);
      }
      let latest = history.samples.at(-1);
      if (latest && now < latest.at) {
        history.samples = [];
        latest = undefined;
      }
      if (history.lastView !== target && (!latest || now > latest.at)) {
        history.samples.push({
          at: now,
          latitude: target.position.latitude,
          longitude: target.position.longitude,
        });
      }
      history.lastView = target;
      history.samples = history.samples.filter(
        (sample) => now - sample.at <= OBSERVATION_WINDOW_MS,
      );

      const reported = reportedMotion(target);
      const observed = observedMotion(history.samples);
      const sampleCount = history.samples.length;
      const newestSampleAt = history.samples.at(-1)?.at;
      if (observed && (!reported || materiallyDifferent(reported, observed))) {
        selections.set(target.id, {
          primary: observed,
          basis: 'observed',
          observed,
          reportedComparison: reported,
          sampleCount,
          newestSampleAt,
        });
      } else if (reported) {
        selections.set(target.id, {
          primary: reported,
          basis: 'reported',
          observed,
          sampleCount,
          newestSampleAt,
        });
      } else {
        selections.set(target.id, { sampleCount, newestSampleAt });
      }
    }
    for (const id of this.#history.keys()) {
      if (!activeIds.has(id)) this.#history.delete(id);
    }
    return selections;
  }
}
