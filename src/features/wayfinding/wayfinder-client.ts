// Sail Wayfinder HTTP contract parsing and authenticated transport.

import type { Route } from '$entities/route';
import { isRecord } from '$shared/lib';

export const WAYFINDER_PLUGIN_ID = 'signalk-wayfinder';
export const WAYFINDER_API_PATH = `/plugins/${WAYFINDER_PLUGIN_ID}`;

export interface WayfinderCapabilities {
  apiVersion: string;
  ready: boolean;
  unavailableReason?: string;
  objectives: readonly 'fastest'[];
  passageConstraints: readonly ('daylightOnly' | 'maxHoursPerDay')[];
  navigationConstraints: readonly (
    | 'minimumDepthM'
    | 'minimumShoreDistanceNm'
    | 'maximumOffshoreDistanceNm'
  )[];
  depthSource?: string;
}

export interface WayfinderStatus {
  state: 'idle' | 'calculating' | 'complete' | 'failed';
  progress: number;
  message?: string;
}

export interface WayfinderConstraints {
  daylightOnly: boolean;
  maxHoursPerDay: number;
  minimumDepthM: number;
  minimumShoreDistanceNm: number;
  maximumOffshoreDistanceNm: number;
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
  if (!objectives?.every((item) => item === 'fastest')) return undefined;
  const passageConstraints = stringArray(value.passageConstraints) ?? [];
  if (!passageConstraints.every((item) => item === 'daylightOnly' || item === 'maxHoursPerDay'))
    return undefined;
  const navigationConstraints = stringArray(value.navigationConstraints) ?? [];
  if (
    !navigationConstraints.every(
      (item) =>
        item === 'minimumDepthM' ||
        item === 'minimumShoreDistanceNm' ||
        item === 'maximumOffshoreDistanceNm',
    )
  ) {
    return undefined;
  }
  return {
    apiVersion: value.apiVersion,
    ready: value.ready,
    unavailableReason:
      typeof value.unavailableReason === 'string' ? value.unavailableReason : undefined,
    objectives,
    passageConstraints,
    navigationConstraints,
    depthSource: typeof value.depthSource === 'string' ? value.depthSource : undefined,
  };
}

export function parseStatus(value: unknown): WayfinderStatus | undefined {
  if (!isRecord(value) || typeof value.status !== 'string') return undefined;
  const progress =
    typeof value.progress === 'number' ? Math.max(0, Math.min(100, value.progress)) : 0;
  if (value.status === 'idle') return { state: 'idle', progress };
  if (value.status === 'calculating') return { state: 'calculating', progress };
  if (value.status === 'done' || value.status === 'warning') {
    return {
      state: 'complete',
      progress: 100,
      message: typeof value.warning === 'string' ? value.warning : undefined,
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
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<WayfinderCapabilities | undefined> {
  return parseCapabilities(
    await jsonRequest(origin, '/api/v1/capabilities', token, undefined, fetchFn),
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
      minimumDepthM: constraints.minimumDepthM,
      minimumShoreDistanceNm: constraints.minimumShoreDistanceNm,
      maximumOffshoreDistanceNm: constraints.maximumOffshoreDistanceNm,
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
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<string | undefined> {
  const value = await jsonRequest(
    origin,
    '/save-route',
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
    fetchFn,
  );
  return isRecord(value) && typeof value.routeId === 'string' ? value.routeId : undefined;
}
