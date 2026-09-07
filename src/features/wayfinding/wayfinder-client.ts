// Sail Wayfinder HTTP contract parsing and authenticated transport.

import type { Route } from '$entities/route';
import { isRecord } from '$shared/lib';

export const WAYFINDER_PLUGIN_ID = 'signalk-wayfinder';
export const WAYFINDER_API_PATH = `/plugins/${WAYFINDER_PLUGIN_ID}`;

export interface WayfinderCapabilities {
  apiVersion: string;
  ready: boolean;
  unavailableReason?: string;
  objectives: readonly WayfinderObjective[];
  maximumAlternatives: number;
  passageConstraints: readonly ('daylightOnly' | 'maxHoursPerDay')[];
  navigationConstraints: readonly ('minimumShoreDistanceNm' | 'maximumOffshoreDistanceNm')[];
  vesselDraft?: { valueM: number; path: string };
  configuredDraftPath: string;
}

export type WayfinderObjective = 'fastest' | 'leastMotoring' | 'allMotoring' | 'bestWeather';

export interface WayfinderAlternative {
  index: number;
  complete: boolean;
  durationHours: number;
  distanceNm: number;
  motorHours: number;
  averageWaveHeightM: number | null;
  maximumWaveHeightM: number | null;
  averageWindKn: number;
  maximumWindKn: number;
  warning?: string;
}

export interface WayfinderStatus {
  state: 'idle' | 'calculating' | 'complete' | 'failed';
  progress: number;
  message?: string;
  alternatives?: WayfinderAlternative[];
}

export interface WayfinderConstraints {
  daylightOnly: boolean;
  maxHoursPerDay: number;
  minimumShoreDistanceNm: number;
  maximumOffshoreDistanceNm: number;
  objective: WayfinderObjective;
  alternativeCount: number;
  motorSpeedKn: number;
  motorBelowKn: number;
  vesselDraftM: number;
}

export interface WayfinderPlanStartResult {
  started: boolean;
  error?: string;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined;
}

export function parseCapabilities(value: unknown): WayfinderCapabilities | undefined {
  if (
    !isRecord(value) ||
    typeof value.apiVersion !== 'string' ||
    typeof value.ready !== 'boolean'
  ) {
    return undefined;
  }
  const objectives = stringArray(value.objectives);
  if (
    !objectives?.every((item) =>
      ['fastest', 'leastMotoring', 'allMotoring', 'bestWeather'].includes(item),
    )
  )
    return undefined;
  const passageConstraints = stringArray(value.passageConstraints) ?? [];
  if (!passageConstraints.every((item) => item === 'daylightOnly' || item === 'maxHoursPerDay'))
    return undefined;
  const navigationConstraints = stringArray(value.navigationConstraints) ?? [];
  if (
    !navigationConstraints.every(
      (item) => item === 'minimumShoreDistanceNm' || item === 'maximumOffshoreDistanceNm',
    )
  ) {
    return undefined;
  }
  return {
    apiVersion: value.apiVersion,
    ready: value.ready,
    unavailableReason:
      typeof value.unavailableReason === 'string' ? value.unavailableReason : undefined,
    objectives: objectives as WayfinderObjective[],
    maximumAlternatives:
      typeof value.maximumAlternatives === 'number' ? value.maximumAlternatives : 1,
    passageConstraints,
    navigationConstraints,
    vesselDraft:
      isRecord(value.vesselDraft) &&
      typeof value.vesselDraft.valueM === 'number' &&
      typeof value.vesselDraft.path === 'string'
        ? { valueM: value.vesselDraft.valueM, path: value.vesselDraft.path }
        : undefined,
    configuredDraftPath:
      typeof value.configuredDraftPath === 'string'
        ? value.configuredDraftPath
        : 'design.draft.current',
  };
}

export function parseStatus(value: unknown): WayfinderStatus | undefined {
  if (!isRecord(value) || typeof value.status !== 'string') return undefined;
  const progress =
    typeof value.progress === 'number' ? Math.max(0, Math.min(100, value.progress)) : 0;
  if (value.status === 'idle') return { state: 'idle', progress };
  if (value.status === 'calculating') return { state: 'calculating', progress };
  if (value.status === 'done' || value.status === 'warning') {
    const alternatives = parseAlternatives(value.alternatives);
    return {
      state: 'complete',
      progress: 100,
      message: typeof value.warning === 'string' ? value.warning : undefined,
      ...(alternatives ? { alternatives } : {}),
    };
  }
  if (value.status === 'error') {
    return {
      state: 'failed',
      progress,
      message:
        typeof value.error === 'string' ? value.error : 'Wayfinder could not calculate a route.',
    };
  }
  return undefined;
}

function parseAlternatives(value: unknown): WayfinderAlternative[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const alternatives: WayfinderAlternative[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.index !== 'number' ||
      typeof item.complete !== 'boolean' ||
      typeof item.durationHours !== 'number' ||
      typeof item.distanceNm !== 'number' ||
      typeof item.motorHours !== 'number' ||
      typeof item.averageWindKn !== 'number' ||
      typeof item.maximumWindKn !== 'number'
    )
      return undefined;
    alternatives.push({
      index: item.index,
      complete: item.complete,
      durationHours: item.durationHours,
      distanceNm: item.distanceNm,
      motorHours: item.motorHours,
      averageWaveHeightM:
        typeof item.averageWaveHeightM === 'number' ? item.averageWaveHeightM : null,
      maximumWaveHeightM:
        typeof item.maximumWaveHeightM === 'number' ? item.maximumWaveHeightM : null,
      averageWindKn: item.averageWindKn,
      maximumWindKn: item.maximumWindKn,
      ...(typeof item.warning === 'string' ? { warning: item.warning } : {}),
    });
  }
  return alternatives;
}

function authInit(token: string | undefined, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    credentials: 'include',
  };
}

async function jsonRequest(
  origin: string,
  path: string,
  token: string | undefined,
  init?: RequestInit,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<unknown> {
  try {
    const response = await fetchFn(`${origin}${WAYFINDER_API_PATH}${path}`, authInit(token, init));
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function fetchWayfinderCapabilities(
  origin: string,
  token: string | undefined,
  draftPath?: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<WayfinderCapabilities | undefined> {
  return parseCapabilities(
    await jsonRequest(
      origin,
      `/api/v1/capabilities${draftPath ? `?draftPath=${encodeURIComponent(draftPath)}` : ''}`,
      token,
      undefined,
      fetchFn,
    ),
  );
}

export async function startWayfinderPlan(
  origin: string,
  token: string | undefined,
  route: Route,
  departureTime: string,
  constraints: WayfinderConstraints,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<WayfinderPlanStartResult> {
  const [start, ...rest] = route.waypoints;
  const end = rest.at(-1);
  if (!start || !end) return { started: false };
  const body = {
    start: { lat: start.position.latitude, lon: start.position.longitude },
    end: { lat: end.position.latitude, lon: end.position.longitude },
    waypoints: rest.slice(0, -1).map(({ position }) => ({
      lat: position.latitude,
      lon: position.longitude,
    })),
    departureTime,
    useLandAvoidance: true,
    useSafetyMargin: true,
    options: {
      daylightOnly: constraints.daylightOnly,
      maxHoursPerDay: constraints.maxHoursPerDay,
      minimumShoreDistanceNm: constraints.minimumShoreDistanceNm,
      maximumOffshoreDistanceNm: constraints.maximumOffshoreDistanceNm,
      objective: constraints.objective,
      alternativeCount: constraints.alternativeCount,
      motorSpeedKn: constraints.motorSpeedKn,
      motorBelowKn: constraints.motorBelowKn,
      vesselDraftM: constraints.vesselDraftM,
    },
  };
  try {
    const response = await fetchFn(
      `${origin}${WAYFINDER_API_PATH}/calculate`,
      authInit(token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    if (response.ok) return { started: true };
    const payload: unknown = await response.json().catch(() => undefined);
    return {
      started: false,
      error: isRecord(payload) && typeof payload.error === 'string' ? payload.error : undefined,
    };
  } catch {
    return { started: false };
  }
}

export async function fetchWayfinderStatus(
  origin: string,
  token: string | undefined,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<WayfinderStatus | undefined> {
  return parseStatus(await jsonRequest(origin, '/status', token, undefined, fetchFn));
}

export async function cancelWayfinderPlan(
  origin: string,
  token: string | undefined,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<boolean> {
  return (await jsonRequest(origin, '/cancel', token, { method: 'POST' }, fetchFn)) !== undefined;
}

export async function saveWayfinderPlan(
  origin: string,
  token: string | undefined,
  name: string,
  alternativeIndex = 0,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<string | undefined> {
  const value = await jsonRequest(
    origin,
    '/save-route',
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, alternativeIndex }),
    },
    fetchFn,
  );
  return isRecord(value) && typeof value.routeId === 'string' ? value.routeId : undefined;
}
