import { isRecord } from '$shared/lib';
import { isThresholds, type Thresholds } from '$shared/settings';
import {
  fetchAuthedJsonOutcome,
  putResourceOutcome,
  type ResourceMutationResult,
} from '$shared/signalk';

export type CollisionThresholdSettings = Pick<
  Thresholds,
  'dangerCpaMeters' | 'dangerTcpaSeconds' | 'warningCpaMeters' | 'warningTcpaSeconds'
>;

export type CollisionSettingsLoad =
  | { state: 'configured'; thresholds: CollisionThresholdSettings }
  | { state: 'empty' | 'failed' | 'unavailable' };

const PATH = '/plugins/binnacle-custom/api/settings/collision';

function parseThresholds(value: unknown): CollisionThresholdSettings | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = {
    dangerCpaMeters: value.dangerCpaMeters,
    dangerTcpaSeconds: value.dangerTcpaSeconds,
    warningCpaMeters: value.warningCpaMeters,
    warningTcpaSeconds: value.warningTcpaSeconds,
  };
  return isThresholds(candidate) ? candidate : undefined;
}

export function collisionThresholdSettings(value: Thresholds): CollisionThresholdSettings {
  return {
    dangerCpaMeters: value.dangerCpaMeters,
    dangerTcpaSeconds: value.dangerTcpaSeconds,
    warningCpaMeters: value.warningCpaMeters,
    warningTcpaSeconds: value.warningTcpaSeconds,
  };
}

export function mergeCollisionThresholdSettings(
  current: Thresholds,
  collision: CollisionThresholdSettings,
): Thresholds {
  return { ...current, ...collision };
}

export async function loadCollisionSettings(
  origin: string,
  token: string | undefined,
): Promise<CollisionSettingsLoad> {
  const outcome = await fetchAuthedJsonOutcome<unknown>(`${origin}${PATH}`, token);
  if (outcome.state === 'not-found') return { state: 'unavailable' };
  if (outcome.state !== 'ok' || !isRecord(outcome.value)) return { state: 'failed' };
  if (outcome.value.thresholds === null) return { state: 'empty' };
  const thresholds = parseThresholds(outcome.value.thresholds);
  return thresholds ? { state: 'configured', thresholds } : { state: 'failed' };
}

export function saveCollisionSettings(
  origin: string,
  token: string | undefined,
  thresholds: CollisionThresholdSettings,
): Promise<ResourceMutationResult> {
  return putResourceOutcome(`${origin}${PATH}`, token, { thresholds });
}
