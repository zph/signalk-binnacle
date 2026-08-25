import type { AisTargetView } from '$entities/ais';
import { DEG_TO_RAD } from '$shared/lib';
import { METERS_PER_DEG, normalizeLonDeltaDeg } from '$shared/nav';

const HISTORY_MS = 120_000;
const MIN_OBSERVATION_MS = 60_000;
const MAX_SAMPLE_GAP_MS = 45_000;
const MIN_SAMPLES = 4;
const MIN_COURSE_SPEED_MPS = 0.5;
const MIN_SPEED_DIFFERENCE_MPS = 0.5;
const MIN_SPEED_DIFFERENCE_RATIO = 0.25;
const MIN_COURSE_DIFFERENCE_RAD = 15 * DEG_TO_RAD;
const MIN_RESIDUAL_TOLERANCE_METERS = 15;
const RESIDUAL_TRAVEL_RATIO = 0.25;

interface PositionSample {
  at: number;
  latitude: number;
  longitude: number;
}

interface TargetHistory {
  lastView?: AisTargetView;
  samples: PositionSample[];
}

export interface AisMotion {
  cogRad: number;
  sogMps: number;
}

export interface AisMotionSelection {
  primary: AisMotion;
  basis: 'reported' | 'observed';
  reportedComparison?: AisMotion;
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

function observedMotion(samples: PositionSample[]): AisMotion | undefined {
  if (samples.length < MIN_SAMPLES) return undefined;
  const first = samples[0];
  const last = samples.at(-1);
  if (!last || last.at - first.at < MIN_OBSERVATION_MS) return undefined;
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
      history.samples = history.samples.filter((sample) => now - sample.at <= HISTORY_MS);

      const reported = reportedMotion(target);
      const observed = observedMotion(history.samples);
      if (observed && (!reported || materiallyDifferent(reported, observed))) {
        selections.set(target.id, {
          primary: observed,
          basis: 'observed',
          reportedComparison: reported,
        });
      } else if (reported) {
        selections.set(target.id, { primary: reported, basis: 'reported' });
      }
    }
    for (const id of this.#history.keys()) {
      if (!activeIds.has(id)) this.#history.delete(id);
    }
    return selections;
  }
}
