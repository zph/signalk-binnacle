import { isRecord } from '$shared/lib';
import { ALARM_LOCATIONS, type AlarmLocation } from '$shared/settings';
import {
  fetchAuthedJsonOutcome,
  putResourceOutcome,
  type ResourceMutationResult,
} from '$shared/signalk';

export type AlarmLocationSettingsLoad =
  | { state: 'configured'; location: AlarmLocation }
  | { state: 'empty' | 'failed' | 'unavailable' };

const PATH = '/plugins/binnacle-custom/api/settings/alarm-location';
const locations = new Set<string>(ALARM_LOCATIONS);

function isAlarmLocation(value: unknown): value is AlarmLocation {
  return typeof value === 'string' && locations.has(value);
}

export async function loadAlarmLocationSettings(
  origin: string,
  token: string | undefined,
): Promise<AlarmLocationSettingsLoad> {
  const outcome = await fetchAuthedJsonOutcome<unknown>(`${origin}${PATH}`, token);
  if (outcome.state === 'not-found') return { state: 'unavailable' };
  if (outcome.state !== 'ok' || !isRecord(outcome.value)) return { state: 'failed' };
  if (outcome.value.location === null) return { state: 'empty' };
  return isAlarmLocation(outcome.value.location)
    ? { state: 'configured', location: outcome.value.location }
    : { state: 'failed' };
}

export function saveAlarmLocationSettings(
  origin: string,
  token: string | undefined,
  location: AlarmLocation,
): Promise<ResourceMutationResult> {
  return putResourceOutcome(`${origin}${PATH}`, token, { location });
}
