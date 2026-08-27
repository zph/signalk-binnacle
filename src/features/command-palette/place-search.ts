import type { LatLon } from '$shared/geo';
import { cleanBoundedText, isRecord, readBoundedJson, withTimeout } from '$shared/lib';

const PHOTON_ENDPOINT = 'https://photon.komoot.io/api/';
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_RESULTS = 8;

export interface PlaceSearchItem {
  id: string;
  name: string;
  detail?: string;
  position: LatLon;
  source: 'AIS' | 'Chart layer' | 'OpenStreetMap' | 'Waypoint';
}

export interface PlaceSearchResponse {
  items: PlaceSearchItem[];
  onlineUnavailable: boolean;
}

interface SearchPlacesOptions {
  localItems: PlaceSearchItem[];
  signal: AbortSignal;
  bias?: LatLon;
  fetcher?: typeof fetch;
}

function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase();
}

function localMatches(query: string, items: PlaceSearchItem[]): PlaceSearchItem[] {
  const needle = normalized(query);
  return items
    .filter((item) =>
      normalized(`${item.name} ${item.detail ?? ''} ${item.source}`).includes(needle),
    )
    .slice(0, MAX_RESULTS);
}

function photonLabel(
  properties: Record<string, unknown>,
): { name: string; detail?: string } | undefined {
  const name =
    cleanBoundedText(properties.name, 256) ??
    cleanBoundedText(properties.street, 256) ??
    cleanBoundedText(properties.city, 256) ??
    cleanBoundedText(properties.country, 256);
  if (!name) return undefined;
  const context = [properties.city, properties.state, properties.country]
    .map((value) => cleanBoundedText(value, 256))
    .filter((value): value is string => value !== undefined && value !== name);
  return { name, detail: context.length > 0 ? [...new Set(context)].join(', ') : undefined };
}

function parsePhotonFeature(value: unknown, index: number): PlaceSearchItem | undefined {
  if (!isRecord(value) || !isRecord(value.geometry) || !isRecord(value.properties))
    return undefined;
  if (value.geometry.type !== 'Point' || !Array.isArray(value.geometry.coordinates))
    return undefined;
  const [longitude, latitude] = value.geometry.coordinates;
  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return undefined;
  }
  const label = photonLabel(value.properties);
  if (!label) return undefined;
  const osmId = cleanBoundedText(value.properties.osm_id, 128) ?? String(index);
  const osmType = cleanBoundedText(value.properties.osm_type, 32) ?? 'place';
  return {
    id: `osm:${osmType}:${osmId}:${latitude}:${longitude}`,
    name: label.name,
    detail: label.detail,
    position: { latitude, longitude },
    source: 'OpenStreetMap',
  };
}

export async function searchPlaces(
  query: string,
  { localItems, signal, bias, fetcher = fetch }: SearchPlacesOptions,
): Promise<PlaceSearchResponse> {
  const cleanQuery = query.trim();
  const local = localMatches(cleanQuery, localItems);
  if (cleanQuery.length < 3) return { items: local, onlineUnavailable: false };

  const url = new URL(PHOTON_ENDPOINT);
  url.searchParams.set('q', cleanQuery);
  url.searchParams.set('limit', String(MAX_RESULTS));
  if (bias) {
    url.searchParams.set('lat', String(bias.latitude));
    url.searchParams.set('lon', String(bias.longitude));
  }
  try {
    const response = await fetcher(
      url,
      withTimeout({ signal, headers: { Accept: 'application/json' } }, 5_000),
    );
    if (!response.ok) return { items: local, onlineUnavailable: true };
    const body = await readBoundedJson<unknown>(response, MAX_RESPONSE_BYTES);
    if (!isRecord(body) || !Array.isArray(body.features)) {
      return { items: local, onlineUnavailable: true };
    }
    const remote = body.features
      .slice(0, MAX_RESULTS)
      .map(parsePhotonFeature)
      .filter((item): item is PlaceSearchItem => item !== undefined);
    const seen = new Set(
      local.map(
        (item) => `${normalized(item.name)}:${item.position.latitude}:${item.position.longitude}`,
      ),
    );
    return {
      items: [
        ...local,
        ...remote.filter((item) => {
          const key = `${normalized(item.name)}:${item.position.latitude}:${item.position.longitude}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      ].slice(0, MAX_RESULTS),
      onlineUnavailable: false,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return { items: local, onlineUnavailable: true };
  }
}
