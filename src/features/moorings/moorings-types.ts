import { isLatLon, type LatLon } from '$shared/geo';
import { cleanBoundedText, isRecord } from '$shared/lib';

export type MooringOccupancy = 'likely-occupied' | 'possible' | 'unknown';
export type MooringAisSource = 'onboard' | 'destination';

export interface MooringAssessment {
  status: MooringOccupancy;
  score: number;
  vesselId?: string;
  vesselName?: string;
  source?: MooringAisSource;
  distanceMeters?: number;
  observedMinutes?: number;
  evidence: string[];
}

export interface MooringPoint {
  id: string;
  name: string;
  position: LatLon;
  category?: string;
  information?: string;
  sourceDate?: string;
  sourceIndication?: string;
  encCell?: string;
  buoyShape?: number;
  colors?: string;
  colorPattern?: string;
  assessment: MooringAssessment;
}

export type MooringViewPhase = 'idle' | 'hidden' | 'zoomed-out' | 'loading' | 'ready' | 'error';

export type DestinationAisState =
  | 'checking'
  | 'unavailable'
  | 'connecting'
  | 'live'
  | 'disconnected'
  | 'error';

export interface MooringViewState {
  phase: MooringViewPhase;
  destinationAis: DestinationAisState;
}

export interface AisHistorySummary {
  firstSeenAtMs: number;
  sampleCount: number;
  medianSogMps?: number;
  center: LatLon;
  maxRadiusMeters: number;
}

export interface MooringAisTarget {
  id: string;
  mmsi?: string;
  name?: string;
  position: LatLon;
  sogMps?: number;
  navigationState?: string;
  lastReportAtMs: number;
  source: MooringAisSource;
  history: AisHistorySummary;
}

const UNKNOWN_ASSESSMENT: MooringAssessment = {
  status: 'unknown',
  score: 0,
  evidence: [],
};

function text(value: unknown, maxLength: number): string | undefined {
  return cleanBoundedText(value, maxLength);
}

export function mooringFromGeoJson(value: unknown): MooringPoint | undefined {
  if (!isRecord(value) || !isRecord(value.geometry) || value.geometry.type !== 'Point') {
    return undefined;
  }
  const coordinates = value.geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return undefined;
  const position = { longitude: coordinates[0], latitude: coordinates[1] };
  if (!isLatLon(position) || !isRecord(value.properties)) return undefined;
  const properties = value.properties;
  const objectId = properties.OBJECTID;
  if (!Number.isSafeInteger(objectId) || Number(objectId) < 0) return undefined;
  const id = `noaa-enc:${objectId}`;
  return {
    id,
    name: text(properties.OBJNAM, 254) ?? text(properties.CATMOR, 25) ?? `Mooring ${objectId}`,
    position,
    category: text(properties.CATMOR, 25),
    information: text(properties.INFORM, 254),
    sourceDate: text(properties.SORDAT, 254),
    sourceIndication: text(properties.SORIND, 254),
    encCell: text(properties.DSNM, 12),
    buoyShape:
      typeof properties.BOYSHP === 'number' && Number.isFinite(properties.BOYSHP)
        ? properties.BOYSHP
        : undefined,
    colors: text(properties.COLOUR, 254),
    colorPattern: text(properties.COLPAT, 254),
    assessment: UNKNOWN_ASSESSMENT,
  };
}

export function destinationTarget(value: unknown): MooringAisTarget | undefined {
  if (!isRecord(value) || !isRecord(value.position) || !isRecord(value.history)) return undefined;
  if (!isLatLon(value.position) || !isLatLon(value.history.center)) return undefined;
  const id = text(value.id, 256);
  const mmsi = text(value.mmsi, 9);
  const lastReportAtMs = value.lastReportAtMs;
  const firstSeenAtMs = value.history.firstSeenAtMs;
  const sampleCount = value.history.sampleCount;
  const maxRadiusMeters = value.history.maxRadiusMeters;
  if (
    !id ||
    !mmsi ||
    !/^\d{9}$/u.test(mmsi) ||
    typeof lastReportAtMs !== 'number' ||
    !Number.isFinite(lastReportAtMs) ||
    typeof firstSeenAtMs !== 'number' ||
    !Number.isFinite(firstSeenAtMs) ||
    !Number.isSafeInteger(sampleCount) ||
    Number(sampleCount) < 1 ||
    Number(sampleCount) > 100_000 ||
    typeof maxRadiusMeters !== 'number' ||
    !Number.isFinite(maxRadiusMeters) ||
    maxRadiusMeters < 0 ||
    maxRadiusMeters > 100_000
  ) {
    return undefined;
  }
  const sogMps = value.sogMps;
  const medianSogMps = value.history.medianSogMps;
  return {
    id,
    mmsi,
    name: text(value.name, 256),
    position: value.position,
    sogMps:
      typeof sogMps === 'number' && Number.isFinite(sogMps) && sogMps >= 0 && sogMps <= 103
        ? sogMps
        : undefined,
    navigationState: text(value.navigationState, 64),
    lastReportAtMs,
    source: 'destination',
    history: {
      firstSeenAtMs,
      sampleCount: Number(sampleCount),
      medianSogMps:
        typeof medianSogMps === 'number' &&
        Number.isFinite(medianSogMps) &&
        medianSogMps >= 0 &&
        medianSogMps <= 103
          ? medianSogMps
          : undefined,
      center: value.history.center,
      maxRadiusMeters,
    },
  };
}
