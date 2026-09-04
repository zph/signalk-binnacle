import { isLatLon, type LatLon } from '$shared/geo';
import { cleanBoundedText, isRecord } from '$shared/lib';

export type MooringOccupancy = 'likely-occupied' | 'possible' | 'unknown';
export type MooringAisSource = 'onboard' | 'destination';
export type MooringScaleBand =
  | 'overview'
  | 'general'
  | 'coastal'
  | 'approach'
  | 'harbour'
  | 'berthing';

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
  scaleBand: MooringScaleBand;
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

const MOORING_SCALE_BANDS = new Set<MooringScaleBand>([
  'overview',
  'general',
  'coastal',
  'approach',
  'harbour',
  'berthing',
]);

export function mooringFromGeoJson(
  value: unknown,
  fallbackScaleBand: MooringScaleBand = 'general',
): MooringPoint | undefined {
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
  const providedScaleBand = text(properties.BINNACLE_SCALE_BAND, 16);
  const scaleBand = MOORING_SCALE_BANDS.has(providedScaleBand as MooringScaleBand)
    ? (providedScaleBand as MooringScaleBand)
    : fallbackScaleBand;
  const encCell = text(properties.DSNM, 12);
  const id = `noaa-enc:${scaleBand}:${encCell ?? 'unknown'}:${objectId}`;
  return {
    id,
    name: text(properties.OBJNAM, 254) ?? text(properties.CATMOR, 25) ?? `Mooring ${objectId}`,
    position,
    category: text(properties.CATMOR, 25),
    information: text(properties.INFORM, 254),
    sourceDate: text(properties.SORDAT, 254),
    sourceIndication: text(properties.SORIND, 254),
    encCell,
    scaleBand,
    buoyShape:
      typeof properties.BOYSHP === 'number' && Number.isFinite(properties.BOYSHP)
        ? properties.BOYSHP
        : undefined,
    colors: text(properties.COLOUR, 254),
    colorPattern: text(properties.COLPAT, 254),
    assessment: UNKNOWN_ASSESSMENT,
  };
}
