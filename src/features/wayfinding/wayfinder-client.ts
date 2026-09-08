// Sail Wayfinder HTTP contract parsing and authenticated transport.

import type { Route } from '$entities/route';
import type { LatLon } from '$shared/geo';
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
  frontier?: LatLon[];
}

export interface WayfinderRouteGeometry {
  index: number;
  points: LatLon[];
}

export interface WayfinderConstraints {
  useLandAvoidance: boolean;
  useCurrentGrib: boolean;
  waitForWind: boolean;
  maxWindKn: number;
  maxWaveM: number;
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

export function normalizePropulsionOptions(constraints: WayfinderConstraints): {
  motorSpeedKn: number;
  motorBelowKn: number;
  waitForWind: boolean;
} {
  if (constraints.objective === 'leastMotoring') {
    return { motorSpeedKn: 0, motorBelowKn: 0, waitForWind: true };
  }
  if (constraints.objective === 'allMotoring') {
    return { motorSpeedKn: constraints.motorSpeedKn, motorBelowKn: 0, waitForWind: false };
  }
  if (constraints.objective === 'bestWeather') {
    return { motorSpeedKn: 0, motorBelowKn: 0, waitForWind: constraints.waitForWind };
  }
  return {
    motorSpeedKn: constraints.motorSpeedKn,
    motorBelowKn: constraints.motorBelowKn,
    waitForWind:
      constraints.waitForWind && !(constraints.motorSpeedKn > 0 && constraints.motorBelowKn > 0),
  };
}

export function normalizeShorelineConstraints(
  useLandAvoidance: boolean,
  minimumShoreDistanceNm: number,
): {
  useLandAvoidance: boolean;
  useSafetyMargin: boolean;
  minimumShoreDistanceNm: number;
} {
  return {
    useLandAvoidance: useLandAvoidance || minimumShoreDistanceNm > 0,
    useSafetyMargin: minimumShoreDistanceNm === 0.5,
    minimumShoreDistanceNm: minimumShoreDistanceNm === 0.5 ? 0 : minimumShoreDistanceNm,
  };
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
  if (value.status === 'calculating') {
    const frontier = parseFrontier(value.frontier);
    return { state: 'calculating', progress, ...(frontier ? { frontier } : {}) };
  }
  if (value.status === 'done' || value.status === 'warning') {
    const alternatives = parseAlternatives(value.alternatives);
    const message = typeof value.warning === 'string' ? value.warning : undefined;
    if (alternatives?.length && alternatives.every((alternative) => !alternative.complete)) {
      return {
        state: 'failed',
        progress: 100,
        message: message ?? 'Wayfinder did not reach the destination within forecast coverage.',
        alternatives,
      };
    }
    return {
      state: 'complete',
      progress: 100,
      message,
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

function parseFrontier(value: unknown): LatLon[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const points: LatLon[] = [];
  for (const point of value) {
    if (
      !Array.isArray(point) ||
      point.length < 2 ||
      typeof point[0] !== 'number' ||
      typeof point[1] !== 'number'
    ) {
      return undefined;
    }
    points.push({ latitude: point[0], longitude: point[1] });
  }
  return points;
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
  const shoreline = normalizeShorelineConstraints(
    constraints.useLandAvoidance,
    constraints.minimumShoreDistanceNm,
  );
  const propulsion = normalizePropulsionOptions(constraints);
  const body = {
    start: { lat: start.position.latitude, lon: start.position.longitude },
    end: { lat: end.position.latitude, lon: end.position.longitude },
    waypoints: rest.slice(0, -1).map(({ position }) => ({
      lat: position.latitude,
      lon: position.longitude,
    })),
    departureTime,
    useLandAvoidance: shoreline.useLandAvoidance,
    useSafetyMargin: shoreline.useSafetyMargin,
    useCurrentGrib: constraints.useCurrentGrib,
    options: {
      waitForWind: propulsion.waitForWind,
      maxWindKn: constraints.maxWindKn,
      maxWaveM: constraints.maxWaveM,
      daylightOnly: constraints.daylightOnly,
      maxHoursPerDay: constraints.maxHoursPerDay,
      minimumShoreDistanceNm: shoreline.minimumShoreDistanceNm,
      maximumOffshoreDistanceNm: constraints.maximumOffshoreDistanceNm,
      objective: constraints.objective,
      alternativeCount: constraints.alternativeCount,
      motorSpeedKn: propulsion.motorSpeedKn,
      motorBelowKn: propulsion.motorBelowKn,
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

export async function fetchWayfinderRouteGeometry(
  origin: string,
  token: string | undefined,
  index: number,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<WayfinderRouteGeometry | undefined> {
  const value = await jsonRequest(
    origin,
    `/pending-route?index=${encodeURIComponent(index)}`,
    token,
    undefined,
    fetchFn,
  );
  if (!isRecord(value) || !isRecord(value.feature) || !isRecord(value.feature.geometry))
    return undefined;
  const geometry = value.feature.geometry;
  if (geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates)) return undefined;
  const points: LatLon[] = [];
  for (const coordinate of geometry.coordinates) {
    if (
      !Array.isArray(coordinate) ||
      coordinate.length < 2 ||
      typeof coordinate[0] !== 'number' ||
      typeof coordinate[1] !== 'number'
    ) {
      return undefined;
    }
    points.push({ latitude: coordinate[1], longitude: coordinate[0] });
  }
  return points.length >= 2 ? { index, points } : undefined;
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
