import { AIS_MOTION_STALE_TTL_MS, type AisTargetView, shortVesselId } from '$entities/ais';
import { haversineMeters } from '$shared/nav';
import type {
  AisHistorySummary,
  MooringAisTarget,
  MooringAssessment,
  MooringPoint,
} from './moorings-types';

const HISTORY_MS = 30 * 60 * 1000;
const FULL_PROXIMITY_METERS = 35;
const MATCH_METERS = 75;
const MAX_PROXIMITY_SCORE = 30;
const LOW_SPEED_MPS = 0.5 * 0.514444;
const DWELL_MS = 15 * 60 * 1000;
const BOUNDED_RADIUS_METERS = 60;
const PIVOT_METERS = 30;

interface Sample {
  at: number;
  position: { latitude: number; longitude: number };
  sogMps?: number;
}

interface LocalHistory {
  lastReportAtMs: number;
  samples: Sample[];
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function summarize(samples: readonly Sample[]): AisHistorySummary {
  const center = {
    latitude: samples.reduce((sum, sample) => sum + sample.position.latitude, 0) / samples.length,
    longitude: samples.reduce((sum, sample) => sum + sample.position.longitude, 0) / samples.length,
  };
  return {
    firstSeenAtMs: samples[0].at,
    sampleCount: samples.length,
    medianSogMps: median(
      samples.flatMap((sample) => (sample.sogMps === undefined ? [] : [sample.sogMps])),
    ),
    center,
    maxRadiusMeters: samples.reduce(
      (largest, sample) =>
        Math.max(
          largest,
          haversineMeters(
            center.latitude,
            center.longitude,
            sample.position.latitude,
            sample.position.longitude,
          ),
        ),
      0,
    ),
  };
}

export class OnboardAisHistory {
  #histories = new Map<string, LocalHistory>();

  observe(targets: readonly AisTargetView[], now: number): MooringAisTarget[] {
    const result: MooringAisTarget[] = [];
    for (const target of targets) {
      const at = target.lastReportAtMs;
      if (target.stale || at === undefined || now - at > AIS_MOTION_STALE_TTL_MS) continue;
      const history = this.#histories.get(target.id) ?? { lastReportAtMs: -1, samples: [] };
      if (at > history.lastReportAtMs) {
        history.samples.push({ at, position: target.position, sogMps: target.sogMps });
        history.lastReportAtMs = at;
      }
      while (history.samples[0] && now - history.samples[0].at > HISTORY_MS) {
        history.samples.shift();
      }
      if (history.samples.length === 0) continue;
      this.#histories.set(target.id, history);
      const mmsi = shortVesselId(target.id);
      result.push({
        id: target.id,
        mmsi: /^\d{9}$/u.test(mmsi) ? mmsi : undefined,
        name: target.name,
        position: target.position,
        sogMps: target.sogMps,
        navigationState: target.navigationState,
        lastReportAtMs: at,
        source: target.id.startsWith('aisstream:') ? 'destination' : 'onboard',
        history: summarize(history.samples),
      });
    }
    for (const [id, history] of this.#histories) {
      if (now - history.lastReportAtMs > HISTORY_MS) this.#histories.delete(id);
    }
    return result;
  }

  clear(): void {
    this.#histories.clear();
  }
}

function combinedTargets(
  onboard: readonly MooringAisTarget[],
  destination: readonly MooringAisTarget[],
): MooringAisTarget[] {
  const byIdentity = new Map<string, MooringAisTarget>();
  for (const target of destination) byIdentity.set(target.mmsi ?? target.id, target);
  for (const target of onboard) {
    const key = target.mmsi ?? target.id;
    const remote = byIdentity.get(key);
    if (!remote || target.lastReportAtMs >= remote.lastReportAtMs) byIdentity.set(key, target);
  }
  return [...byIdentity.values()];
}

function assessment(
  mooring: MooringPoint,
  target: MooringAisTarget,
  distanceMeters: number,
  now: number,
): MooringAssessment {
  const proximityScore =
    distanceMeters <= FULL_PROXIMITY_METERS
      ? MAX_PROXIMITY_SCORE
      : Math.max(
          0,
          Math.round(
            (MAX_PROXIMITY_SCORE * (MATCH_METERS - distanceMeters)) /
              (MATCH_METERS - FULL_PROXIMITY_METERS),
          ),
        );
  let score = proximityScore;
  const evidence = [
    `AIS target ${Math.round(distanceMeters)} m from the charted position: ${proximityScore} of ${MAX_PROXIMITY_SCORE} proximity points`,
  ];
  const medianSog = target.history.medianSogMps ?? target.sogMps;
  if (medianSog !== undefined && medianSog < LOW_SPEED_MPS) {
    score += 20;
    evidence.push('Median speed below 0.5 kn');
  }
  const observedMs = Math.max(0, now - target.history.firstSeenAtMs);
  if (observedMs >= DWELL_MS) {
    score += 20;
    evidence.push('Observed in the area for at least 15 minutes');
  }
  if (target.history.sampleCount >= 3 && target.history.maxRadiusMeters <= BOUNDED_RADIUS_METERS) {
    score += 10;
    evidence.push('Position history stays bounded');
  }
  if (
    target.history.sampleCount >= 3 &&
    haversineMeters(
      target.history.center.latitude,
      target.history.center.longitude,
      mooring.position.latitude,
      mooring.position.longitude,
    ) <= PIVOT_METERS
  ) {
    score += 20;
    evidence.push('Position-cloud center is near the mooring');
  }
  if (target.navigationState?.toLocaleLowerCase('en').includes('moored')) {
    score += 10;
    evidence.push('AIS navigation state reports moored');
  }
  return {
    status: score >= 70 ? 'likely-occupied' : score >= 40 ? 'possible' : 'unknown',
    score: Math.min(score, 100),
    vesselId: target.id,
    vesselName: target.name ?? target.mmsi,
    source: target.source,
    distanceMeters,
    observedMinutes: Math.floor(observedMs / 60_000),
    evidence,
  };
}

export function assessMoorings(
  moorings: readonly MooringPoint[],
  onboard: readonly MooringAisTarget[],
  destination: readonly MooringAisTarget[],
  now: number,
): MooringPoint[] {
  const pairs: Array<{ mooring: MooringPoint; target: MooringAisTarget; distanceMeters: number }> =
    [];
  const targets = combinedTargets(onboard, destination).filter(
    (target) => now - target.lastReportAtMs <= AIS_MOTION_STALE_TTL_MS,
  );
  const nearestByMooring = new Map<string, { target: MooringAisTarget; distanceMeters: number }>();
  for (const mooring of moorings) {
    for (const target of targets) {
      const distanceMeters = haversineMeters(
        mooring.position.latitude,
        mooring.position.longitude,
        target.position.latitude,
        target.position.longitude,
      );
      const nearest = nearestByMooring.get(mooring.id);
      if (!nearest || distanceMeters < nearest.distanceMeters) {
        nearestByMooring.set(mooring.id, { target, distanceMeters });
      }
      if (distanceMeters <= MATCH_METERS) pairs.push({ mooring, target, distanceMeters });
    }
  }
  pairs.sort((left, right) => left.distanceMeters - right.distanceMeters);
  const byMooring = new Map<string, MooringAssessment>();
  const usedTargets = new Set<string>();
  for (const pair of pairs) {
    const targetKey = pair.target.mmsi ?? pair.target.id;
    if (byMooring.has(pair.mooring.id) || usedTargets.has(targetKey)) continue;
    byMooring.set(pair.mooring.id, assessment(pair.mooring, pair.target, pair.distanceMeters, now));
    usedTargets.add(targetKey);
  }
  return moorings.map((mooring) => {
    const assigned = byMooring.get(mooring.id);
    if (assigned) return { ...mooring, assessment: assigned };
    const nearest = nearestByMooring.get(mooring.id);
    const evidence = nearest
      ? nearest.distanceMeters > MATCH_METERS
        ? [
            `Nearest current AIS target is ${Math.round(nearest.distanceMeters)} m away, beyond the ${MATCH_METERS} m matching limit`,
          ]
        : [
            `Nearest current AIS target is ${Math.round(nearest.distanceMeters)} m away, but it is assigned to a closer charted mooring`,
          ]
      : ['No current AIS targets were observed in this chart area'];
    return { ...mooring, assessment: { status: 'unknown' as const, score: 0, evidence } };
  });
}
