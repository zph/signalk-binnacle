import type { Bbox4 } from '$shared/geo';
import { fetchAcrossSeam } from '$shared/geo';
import { isRecord, readBoundedJson, withTimeout } from '$shared/lib';
import { authInit } from '$shared/signalk';
import { type MooringPoint, type MooringScaleBand, mooringFromGeoJson } from './moorings-types';

const NOAA_SOURCES: readonly { scaleBand: MooringScaleBand; layer: number }[] = [
  { scaleBand: 'overview', layer: 34 },
  { scaleBand: 'general', layer: 40 },
  { scaleBand: 'coastal', layer: 46 },
  { scaleBand: 'approach', layer: 60 },
  { scaleBand: 'harbour', layer: 56 },
  { scaleBand: 'berthing', layer: 27 },
];
const NOAA_FIELDS = 'OBJECTID,BOYSHP,CATMOR,COLOUR,COLPAT,OBJNAM,INFORM,SORDAT,SORIND,DSNM';
const MAX_MOORINGS = 5_000;
const NOAA_PAGE_SIZE = 1_000;

async function readMoorings(
  response: Response,
  fallbackScaleBand?: MooringScaleBand,
): Promise<MooringPoint[] | undefined> {
  if (!response.ok) return undefined;
  const body = await readBoundedJson<unknown>(response);
  if (!isRecord(body) || !Array.isArray(body.features)) return undefined;
  const moorings: MooringPoint[] = [];
  const seen = new Set<string>();
  for (const value of body.features.slice(0, MAX_MOORINGS)) {
    const mooring = mooringFromGeoJson(value, fallbackScaleBand);
    if (!mooring || seen.has(mooring.id)) continue;
    seen.add(mooring.id);
    moorings.push(mooring);
  }
  return moorings;
}

async function fetchNoaaSource(
  source: (typeof NOAA_SOURCES)[number],
  bbox: Bbox4,
): Promise<MooringPoint[] | undefined> {
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
        await fetch(
          `https://encdirect.noaa.gov/arcgis/rest/services/encdirect/enc_${source.scaleBand}/MapServer/${source.layer}/query?${params}`,
          withTimeout(undefined, 12_000),
        ),
        source.scaleBand,
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

function mergeScaleBands(results: readonly PromiseSettledResult<MooringPoint[] | undefined>[]) {
  if (results.some((result) => result.status !== 'fulfilled' || result.value === undefined)) {
    return undefined;
  }
  const byPosition = new Map<string, MooringPoint>();
  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    for (const mooring of result.value) {
      const positionKey = `${mooring.position.longitude.toFixed(6)},${mooring.position.latitude.toFixed(6)}`;
      byPosition.set(positionKey, mooring);
    }
  }
  return [...byPosition.values()].slice(0, MAX_MOORINGS);
}

async function fetchNoaaDirect(bbox: Bbox4): Promise<MooringPoint[] | undefined> {
  return mergeScaleBands(
    await Promise.allSettled(NOAA_SOURCES.map((source) => fetchNoaaSource(source, bbox))),
  );
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
        // A reachable companion route owns NOAA access. Do not multiply a transient upstream
        // failure into six more browser requests; the overlay retries it with bounded backoff.
        if (response.status !== 404) return undefined;
      } catch {
        // A standalone Binnacle build has no companion route. NOAA supports GeoJSON directly.
      }
      return fetchNoaaDirect(box);
    },
    (mooring) => mooring.id,
  );
}
