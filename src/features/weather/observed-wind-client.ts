import { SignalKResourceClient } from '$shared/signalk';

export interface ObservedWindStation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  observedAt: string;
  speedMps: number;
  directionDeg: number;
  gustMps?: number;
  source?: string;
}

export interface ObservedWindResponse {
  provider: string;
  refreshedAt?: string;
  stations: ObservedWindStation[];
}

const PATH = '/plugins/signalk-weather-stations/stations';
const CACHE_MS = 60_000;
let cached: { at: number; value: ObservedWindResponse } | undefined;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validStation(value: unknown): value is ObservedWindStation {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    finite(s.latitude) &&
    s.latitude >= -90 &&
    s.latitude <= 90 &&
    finite(s.longitude) &&
    s.longitude >= -180 &&
    s.longitude <= 180 &&
    typeof s.observedAt === 'string' &&
    Number.isFinite(Date.parse(s.observedAt)) &&
    finite(s.speedMps) &&
    s.speedMps >= 0 &&
    finite(s.directionDeg) &&
    s.directionDeg >= 0 &&
    s.directionDeg < 360 &&
    (s.gustMps === undefined || (finite(s.gustMps) && s.gustMps >= 0))
  );
}

export function parseObservedWindResponse(value: unknown): ObservedWindResponse | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const response = value as Record<string, unknown>;
  if (typeof response.provider !== 'string' || !Array.isArray(response.stations)) return undefined;
  const stations = response.stations.filter(validStation);
  if (stations.length !== response.stations.length) return undefined;
  return {
    provider: response.provider,
    refreshedAt: typeof response.refreshedAt === 'string' ? response.refreshedAt : undefined,
    stations,
  };
}

export async function fetchObservedWindStations(
  origin: string,
  getToken: () => string | undefined,
): Promise<ObservedWindResponse | undefined> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  try {
    const value = await new SignalKResourceClient({
      getToken,
      timeoutMs: 8_000,
    }).fetchJson<unknown>(`${origin}${PATH}`);
    const parsed = parseObservedWindResponse(value);
    if (parsed) cached = { at: Date.now(), value: parsed };
    return parsed;
  } catch {
    return cached?.value;
  }
}
