import type { Bbox4 } from '$shared/geo';
import { fetchAcrossSeam } from '$shared/geo';
import { isRecord, readBoundedJson, withTimeout } from '$shared/lib';
import { authInit } from '$shared/signalk';
import {
  type DestinationAisState,
  destinationTarget,
  type MooringAisTarget,
  type MooringPoint,
  mooringFromGeoJson,
} from './moorings-types';

const NOAA_URL =
  'https://encdirect.noaa.gov/arcgis/rest/services/encdirect/enc_general/MapServer/40/query';
const NOAA_FIELDS = 'OBJECTID,BOYSHP,CATMOR,COLOUR,COLPAT,OBJNAM,INFORM,SORDAT,SORIND,DSNM';
const MAX_MOORINGS = 5_000;
const NOAA_PAGE_SIZE = 1_000;
const MAX_DESTINATION_TARGETS = 1_000;

async function readMoorings(response: Response): Promise<MooringPoint[] | undefined> {
  if (!response.ok) return undefined;
  const body = await readBoundedJson<unknown>(response);
  if (!isRecord(body) || !Array.isArray(body.features)) return undefined;
  const moorings: MooringPoint[] = [];
  const seen = new Set<string>();
  for (const value of body.features.slice(0, MAX_MOORINGS)) {
    const mooring = mooringFromGeoJson(value);
    if (!mooring || seen.has(mooring.id)) continue;
    seen.add(mooring.id);
    moorings.push(mooring);
  }
  return moorings;
}

async function fetchNoaaDirect(bbox: Bbox4): Promise<MooringPoint[] | undefined> {
  try {
    const moorings: MooringPoint[] = [];
    const seen = new Set<string>();
    for (let offset = 0; offset < MAX_MOORINGS; offset += NOAA_PAGE_SIZE) {
      const params = new URLSearchParams({
        where: '1=1',
        geometry: bbox.join(','),
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: NOAA_FIELDS,
        returnGeometry: 'true',
        outSR: '4326',
        orderByFields: 'OBJECTID',
        resultOffset: String(offset),
        resultRecordCount: String(NOAA_PAGE_SIZE),
        f: 'geojson',
      });
      const page = await readMoorings(
        await fetch(`${NOAA_URL}?${params}`, withTimeout(undefined, 12_000)),
      );
      if (!page) return undefined;
      for (const mooring of page) {
        if (seen.has(mooring.id)) continue;
        seen.add(mooring.id);
        moorings.push(mooring);
      }
      if (page.length < NOAA_PAGE_SIZE) break;
    }
    return moorings;
  } catch {
    return undefined;
  }
}

export function fetchMoorings(
  origin: string,
  token: string | undefined,
  bbox: Bbox4,
): Promise<MooringPoint[] | undefined> {
  return fetchAcrossSeam(
    bbox,
    async (box) => {
      const query = new URLSearchParams({ bbox: JSON.stringify(box) });
      try {
        const response = await fetch(
          `${origin}/plugins/binnacle-custom/api/moorings?${query}`,
          withTimeout(authInit(token), 12_000),
        );
        const provided = await readMoorings(response);
        if (provided) return provided;
      } catch {
        // A standalone Binnacle build has no companion route. NOAA supports GeoJSON directly.
      }
      return fetchNoaaDirect(box);
    },
    (mooring) => mooring.id,
  );
}

export interface DestinationAisSnapshot {
  state: DestinationAisState;
  targets: MooringAisTarget[];
}

export async function fetchDestinationAis(
  origin: string,
  token: string | undefined,
  bbox: Bbox4,
): Promise<DestinationAisSnapshot> {
  const query = new URLSearchParams({ bbox: JSON.stringify(bbox) });
  try {
    const response = await fetch(
      `${origin}/plugins/signalk-aisstream/api/destination?${query}`,
      withTimeout(authInit(token, { cache: 'no-store' }), 5_000),
    );
    if (response.status === 404 || response.status === 503) {
      return { state: 'unavailable', targets: [] };
    }
    if (!response.ok) return { state: 'error', targets: [] };
    const body = await readBoundedJson<unknown>(response);
    if (!isRecord(body) || !Array.isArray(body.targets)) {
      return { state: 'error', targets: [] };
    }
    const providerState = body.state;
    const state: DestinationAisState =
      providerState === 'live' ||
      providerState === 'connecting' ||
      providerState === 'disconnected' ||
      providerState === 'error'
        ? providerState
        : 'error';
    const targets = body.targets
      .slice(0, MAX_DESTINATION_TARGETS)
      .map(destinationTarget)
      .filter((target): target is MooringAisTarget => target !== undefined);
    return { state, targets };
  } catch {
    return { state: 'error', targets: [] };
  }
}
