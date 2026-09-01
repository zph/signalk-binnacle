import { isRecord } from '$shared/lib';

export const WAYFINDER_PLUGIN_ID = 'signalk-wayfinder';
export const WAYFINDER_API_PATH = `/plugins/${WAYFINDER_PLUGIN_ID}/api/v1`;

export interface WayfinderCapabilities {
  apiVersion: string;
  ready: boolean;
  unavailableReason?: string;
  objectives: readonly ('fastest' | 'leastMotoring')[];
}

export interface WayfinderJob {
  id: string;
  state:
    | 'validating'
    | 'acquiring'
    | 'indexing'
    | 'calculating'
    | 'validatingSafety'
    | 'complete'
    | 'noRoute'
    | 'failed'
    | 'cancelled';
  message?: string;
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
  if (!objectives?.every((item) => item === 'fastest' || item === 'leastMotoring')) {
    return undefined;
  }
  return {
    apiVersion: value.apiVersion,
    ready: value.ready,
    unavailableReason:
      typeof value.unavailableReason === 'string' ? value.unavailableReason : undefined,
    objectives,
  };
}

export function parseJob(value: unknown): WayfinderJob | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.state !== 'string')
    return undefined;
  const states = new Set<WayfinderJob['state']>([
    'validating',
    'acquiring',
    'indexing',
    'calculating',
    'validatingSafety',
    'complete',
    'noRoute',
    'failed',
    'cancelled',
  ]);
  if (!states.has(value.state as WayfinderJob['state'])) return undefined;
  return {
    id: value.id,
    state: value.state as WayfinderJob['state'],
    message: typeof value.message === 'string' ? value.message : undefined,
  };
}

function authInit(token: string | undefined, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    credentials: 'include',
  };
}

export async function fetchWayfinderCapabilities(
  origin: string,
  token: string | undefined,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<WayfinderCapabilities | undefined> {
  try {
    const response = await fetchFn(`${origin}${WAYFINDER_API_PATH}/capabilities`, authInit(token));
    if (!response.ok) return undefined;
    return parseCapabilities(await response.json());
  } catch {
    return undefined;
  }
}
