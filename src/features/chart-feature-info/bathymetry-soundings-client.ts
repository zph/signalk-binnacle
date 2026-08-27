import { isBbox4, isLatLon, isLonLat, type LonLat } from '$shared/geo';
import { cleanBoundedText, isFiniteNumber, isRecord } from '$shared/lib';
import { fetchAuthedJson } from '$shared/signalk';

const PLUGIN_PATH = '/plugins/signalk-bathymetry';
const MAX_SOUNDINGS = 10_000;

export interface BathymetrySounding {
  id: number;
  observedAt: string;
  position: { latitude: number; longitude: number };
  rawDepthM: number;
  datumDepthM: number;
  tideHeightM: number;
  verticalSigmaM: number;
  sampleCount: number;
  qcState: 'accepted' | 'quarantined' | 'rejected';
  depthSource: string;
  passId: string;
  aggregationKind: string;
}

interface CellLookup {
  bounds: [number, number, number, number];
  polygon: LonLat[];
}

export async function fetchBathymetrySoundings(
  serverBase: string,
  token: string | undefined,
  latitude: number,
  longitude: number,
): Promise<BathymetrySounding[] | undefined> {
  const lookupUrl = pluginUrl(serverBase, '/cells/lookup');
  lookupUrl.searchParams.set('latitude', String(latitude));
  lookupUrl.searchParams.set('longitude', String(longitude));
  const lookup = parseCellLookup(await fetchAuthedJson<unknown>(lookupUrl.toString(), token));
  if (!lookup) return undefined;

  const soundingsUrl = pluginUrl(serverBase, '/soundings');
  soundingsUrl.searchParams.set('bbox', lookup.bounds.join(','));
  soundingsUrl.searchParams.set('limit', String(MAX_SOUNDINGS));
  const body = await fetchAuthedJson<unknown>(soundingsUrl.toString(), token);
  if (!isRecord(body) || !Array.isArray(body.soundings)) return undefined;

  return body.soundings
    .slice(0, MAX_SOUNDINGS)
    .map(parseSounding)
    .filter((row): row is BathymetrySounding => row !== undefined)
    .filter((row) =>
      polygonContains(lookup.polygon, row.position.longitude, row.position.latitude),
    );
}

function pluginUrl(serverBase: string, path: string): URL {
  return new URL(`${PLUGIN_PATH}${path}`, serverBase.endsWith('/') ? serverBase : `${serverBase}/`);
}

function parseCellLookup(value: unknown): CellLookup | undefined {
  if (!isRecord(value) || !isBbox4(value.bounds) || !isRecord(value.geometry)) return undefined;
  const coordinates = value.geometry.coordinates;
  if (value.geometry.type !== 'Polygon' || !Array.isArray(coordinates)) return undefined;
  const ring = coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > 64) return undefined;
  const polygon = ring.filter(isLonLat);
  if (polygon.length !== ring.length) return undefined;
  return { bounds: value.bounds, polygon };
}

function parseSounding(value: unknown): BathymetrySounding | undefined {
  if (!isRecord(value) || !isLatLon(value.position)) return undefined;
  const id = value.id;
  const observedAt = cleanBoundedText(value.observedAt, 64);
  const rawDepthM = value.rawDepthM;
  const datumDepthM = value.datumDepthM;
  const tideHeightM = value.tideHeightM;
  const verticalSigmaM = value.verticalSigmaM;
  const sampleCount = value.sampleCount;
  const qcState = value.qcState;
  const depthSource = cleanBoundedText(value.depthSource, 256);
  const passId = cleanBoundedText(value.passId, 256);
  const aggregationKind = cleanBoundedText(value.aggregationKind, 64);
  if (
    !Number.isSafeInteger(id) ||
    (id as number) < 0 ||
    !observedAt ||
    Number.isNaN(Date.parse(observedAt)) ||
    !isFiniteNumber(rawDepthM) ||
    !isFiniteNumber(datumDepthM) ||
    !isFiniteNumber(tideHeightM) ||
    !isFiniteNumber(verticalSigmaM) ||
    !Number.isSafeInteger(sampleCount) ||
    (sampleCount as number) < 0 ||
    (qcState !== 'accepted' && qcState !== 'quarantined' && qcState !== 'rejected') ||
    !depthSource ||
    !passId ||
    !aggregationKind
  ) {
    return undefined;
  }
  return {
    id: id as number,
    observedAt,
    position: value.position,
    rawDepthM,
    datumDepthM,
    tideHeightM,
    verticalSigmaM,
    sampleCount: sampleCount as number,
    qcState,
    depthSource,
    passId,
    aggregationKind,
  };
}

function polygonContains(polygon: readonly LonLat[], longitude: number, latitude: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i] as LonLat;
    const [xj, yj] = polygon[j] as LonLat;
    const crosses = yi > latitude !== yj > latitude;
    if (crosses && longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
